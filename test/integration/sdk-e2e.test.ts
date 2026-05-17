/**
 * End-to-end integration test for `@krynix/sdk`.
 *
 * **Goal:** prove the SDK's pieces compose into a working runtime
 * pipeline, not just that each piece works against stubs.
 *
 * **Why this matters:** the package's 50 unit tests cover the verdict
 * pipeline, buffer, poller, redactor, and constructor validation in
 * isolation. They do NOT prove the whole thing produces correct
 * end-to-end behaviour when a real HTTP transport sits between the
 * SDK and ingest, or when a real (stubbed-LLM-side) adapter is
 * registered and a `wrap(client).chat.completions.create()` call
 * flows through. This test fills that gap.
 *
 * **Layout:**
 *
 * 1. Boot a Node `http.createServer` instance that mimics the Krynix
 *    API contract for `POST /v1/sessions/:id/events`,
 *    `POST /v1/sessions/:id/approvals`, and
 *    `GET /v1/sessions/:id/approvals/:approval_id`. Records every
 *    request body so the test can assert wire-shape correctness.
 * 2. Define a minimal "stub LLM" adapter that:
 *    - Detects a plain `{ __stubLLM: true, chat: { completions: { create: ... } } }`.
 *    - Wraps `chat.completions.create` through the verdict pipeline.
 *    - Forwards to the stub LLM on `forward`; throws on `deny`; calls
 *      the approval poller on `require-approval`.
 *    - Emits trace events via `ctx.buffer` for every call.
 * 3. Run all four verdicts and assert outcomes + wire contents.
 *
 * **Scope cut on purpose:**
 * - We don't speak the real OpenAI / Anthropic / LangChain shapes
 *   here. The first-party adapters do that. This test is about the
 *   SDK's own composition.
 * - We don't test concurrency / retry under transport failure —
 *   the unit tests already exercise the buffer's retry logic.
 *   Adding network-failure scenarios here would duplicate them.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION, type TraceEvent } from "../../packages/core/src/index.js";
import { parsePolicy } from "../../packages/policy/src/index.js";
import {
  ApprovalDenied,
  ApprovalTimeout,
  Krynix,
  NoAdapterError,
  PolicyDenied,
  runPipeline,
  type KrynixAdapter,
  type KrynixContext,
} from "../../packages/sdk/src/index.js";

// ---------------------------------------------------------------------------
// Stub LLM client + adapter
// ---------------------------------------------------------------------------

/**
 * Minimal LLM-client shape that mimics OpenAI's `client.chat.completions.create(opts)`.
 * The stub's `create()` returns a fixed assistant message and records what
 * body it was called with so the test can verify redactions reached the
 * outbound call.
 */
interface StubLlmClient {
  __stubLLM: true;
  chat: {
    completions: {
      create: (
        body: { model: string; messages: { role: string; content: string }[] },
      ) => Promise<{ content: string }>;
    };
  };
  /** Captured request bodies — each `create()` call appends here. */
  readonly captured: Array<{ model: string; messages: { role: string; content: string }[] }>;
}

function makeStubLlmClient(): StubLlmClient {
  const captured: StubLlmClient["captured"] = [];
  return {
    __stubLLM: true,
    chat: {
      completions: {
        create: async (body) => {
          captured.push(body);
          return { content: "ok" };
        },
      },
    },
    captured,
  };
}

/**
 * Stub adapter. Implements the full `KrynixAdapter` contract so the
 * registry, dispatch, and verdict pipeline are exercised through the
 * exact same path a real first-party OpenAI adapter would use.
 */
const stubAdapter: KrynixAdapter<StubLlmClient> = {
  name: "stub-llm",
  detect: (client): client is StubLlmClient =>
    typeof client === "object" && client !== null && (client as StubLlmClient).__stubLLM === true,
  wrap: (client, ctx): StubLlmClient => {
    const originalCreate = client.chat.completions.create.bind(client.chat.completions);
    client.chat.completions.create = async (body) => {
      // Build a partial TraceEvent for the policy pipeline. The test
      // factory returns a structurally-shaped object; the SDK's
      // strict `TraceEvent` discriminated union requires a literal
      // event_type, so the cast is the standard test-fixture pattern.
      const event = makeLlmRequestEvent(ctx, body) as unknown as TraceEvent;

      const outcome = runPipeline(event, body, ctx.policy, ctx.redactionMode);

      switch (outcome.action) {
        case "forward": {
          const callBody = outcome.body as typeof body;
          const response = await originalCreate(callBody);
          // Emit a policy_decision event for the audit trail.
          ctx.buffer.enqueue(
            makeDecisionEvent(
              ctx,
              event,
              outcome.verdict,
              outcome.ruleId,
              outcome.appliedRedactions,
            ) as unknown as TraceEvent,
          );
          return response;
        }
        case "deny":
          ctx.buffer.enqueue(
            makeDecisionEvent(ctx, event, "fail", outcome.ruleId, []) as unknown as TraceEvent,
          );
          throw new PolicyDenied(outcome.message, outcome.ruleId);
        case "require-approval": {
          if (ctx.approvalPoller === null) {
            throw new Error("approval-poller unavailable (offline mode)");
          }
          // Submit + poll. Throws ApprovalDenied / ApprovalTimeout on
          // the deny / timeout-deny paths; returns on approve / timeout-allow.
          const decisionEvent = makeDecisionEvent(
            ctx,
            event,
            "require-approval",
            outcome.ruleId,
            [],
          ) as unknown as TraceEvent;
          ctx.buffer.enqueue(decisionEvent);
          await ctx.approvalPoller.waitForApproval(
            decisionEvent,
            outcome.ruleId,
            outcome.onTimeout,
          );
          return originalCreate(body);
        }
      }
    };
    return client;
  },
};

// `Krynix.registerAdapter` mutates a class-level array. Capture the
// pre-test snapshot so the afterAll hook can restore it — otherwise
// the stub adapter would leak into other integration test files that
// share the same vitest worker, making their `wrap()` calls
// order-dependent (the stub would match arbitrary `__stubLLM` clients
// elsewhere). Same escape-hatch pattern used by
// `packages/sdk/src/krynix.test.ts`.
const initialAdapterNames = new Set(Krynix.listAdapters());
Krynix.registerAdapter(stubAdapter);

// ---------------------------------------------------------------------------
// TraceEvent factories (matching the krynix-core 1.1.0 schema)
// ---------------------------------------------------------------------------

interface AnyEvent {
  event_id: string;
  session_id: string;
  sequence_num: number;
  timestamp: string;
  parent_id: string | null;
  agent_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  redacted: boolean;
  prev_hash: string;
  event_hash: string;
  metadata: null;
  schema_version: string;
}

function makeLlmRequestEvent(
  ctx: KrynixContext,
  body: { model: string; messages: { role: string; content: string }[] },
): AnyEvent {
  return {
    event_id: randomUUID(),
    session_id: ctx.sessionId,
    sequence_num: 0,
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: ctx.agentId,
    event_type: "llm_request",
    payload: { model: body.model, messages: body.messages, parameters: {} },
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION,
  };
}

/**
 * Map a verdict to the matched rule's action.
 *
 * `DecisionPayload.action` mirrors the rule's action string (`allow` /
 * `redact` / `deny` / `require-approval`), while
 * `policy_decision.verdict` carries the outcome (`pass` / `redact` /
 * `fail` / `require-approval`). The two are not the same field — a
 * verdict of `pass` is produced by a rule with `action: "allow"`, and
 * a verdict of `fail` is produced by a rule with `action: "deny"`.
 * Adapter authors keying off `payload.action` need the rule string,
 * not the verdict.
 */
function actionForVerdict(
  verdict: "pass" | "fail" | "redact" | "require-approval",
): "allow" | "deny" | "redact" | "require-approval" {
  switch (verdict) {
    case "pass":
      return "allow";
    case "fail":
      return "deny";
    case "redact":
      return "redact";
    case "require-approval":
      return "require-approval";
  }
}

function makeDecisionEvent(
  ctx: KrynixContext,
  source: { event_id: string },
  verdict: "pass" | "fail" | "redact" | "require-approval",
  ruleId: string | undefined,
  redactions: { path: string; value_redacted: string }[],
): AnyEvent {
  const policyDecision: Record<string, unknown> = { verdict, latency_ms: 0 };
  if (ruleId !== undefined) policyDecision.rule_id = ruleId;
  if (verdict === "redact") policyDecision.redactions = redactions;
  return {
    event_id: randomUUID(),
    session_id: ctx.sessionId,
    sequence_num: 0,
    timestamp: new Date().toISOString(),
    parent_id: source.event_id,
    agent_id: ctx.agentId,
    event_type: "decision",
    payload: {
      action: actionForVerdict(verdict),
      reasoning: "stub adapter audit entry",
      policy_decision: policyDecision,
    },
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Fake ingest server
// ---------------------------------------------------------------------------

interface CapturedRequest {
  method: string;
  path: string;
  authorization?: string;
  body: unknown;
}

interface ApprovalRow {
  approval_id: string;
  status: "pending" | "approved" | "denied" | "expired";
  resolved_by?: string;
  notes?: string;
}

interface FakeIngest {
  url: string;
  close: () => Promise<void>;
  requests: CapturedRequest[];
  /** Allows the test to seed the next approval submission's response. */
  setNextApprovalSubmitStatus: (status: ApprovalRow["status"]) => void;
  /** Allows the test to flip an approval row's status while the SDK polls. */
  resolveApproval: (id: string, row: Omit<ApprovalRow, "approval_id">) => void;
}

async function startFakeIngest(): Promise<FakeIngest> {
  const requests: CapturedRequest[] = [];
  const approvals = new Map<string, ApprovalRow>();
  let nextApprovalSubmitStatus: ApprovalRow["status"] = "pending";

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString("utf-8");
    const body: unknown = raw.length > 0 ? JSON.parse(raw) : undefined;
    requests.push({
      method: req.method ?? "?",
      path: req.url ?? "?",
      authorization: req.headers["authorization"],
      body,
    });

    const url = req.url ?? "";

    // POST /v1/sessions/:id/events
    if (req.method === "POST" && /^\/v1\/sessions\/[^/]+\/events$/.test(url)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end();
      return;
    }

    // POST /v1/sessions/:id/approvals
    if (req.method === "POST" && /^\/v1\/sessions\/[^/]+\/approvals$/.test(url)) {
      const approvalId = `appr-${String(approvals.size + 1)}`;
      const row: ApprovalRow = { approval_id: approvalId, status: nextApprovalSubmitStatus };
      approvals.set(approvalId, row);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          approval_id: approvalId,
          status: row.status,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30000).toISOString(),
        }),
      );
      return;
    }

    // GET /v1/sessions/:id/approvals/:approval_id
    const getMatch = /^\/v1\/sessions\/[^/]+\/approvals\/([^/]+)$/.exec(url);
    if (req.method === "GET" && getMatch !== null) {
      const approvalId = getMatch[1] ?? "";
      const row = approvals.get(approvalId);
      if (row === undefined) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(row));
      return;
    }

    res.writeHead(404);
    res.end();
  }

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${String(addr.port)}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err !== undefined ? reject(err) : resolve())),
      ),
    requests,
    setNextApprovalSubmitStatus: (status) => {
      nextApprovalSubmitStatus = status;
    },
    resolveApproval: (id, row) => {
      const existing = approvals.get(id);
      if (existing === undefined) throw new Error(`approval ${id} not seeded yet`);
      approvals.set(id, { ...existing, ...row });
    },
  };
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const POLICY_PASS = parsePolicy(`
apiVersion: krynix.dev/v1
metadata:
  name: e2e-pass
  version: "1.0.0"
  description: Allow everything
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: allow-all
      description: allow everything
      match:
        payload: []
      action: allow
      severity: info
      message: "ok"
`);

const POLICY_REDACT_EMAIL = parsePolicy(`
apiVersion: krynix.dev/v1
metadata:
  name: e2e-redact
  version: "1.0.0"
  description: Redact emails in messages
spec:
  scope:
    agents: ["*"]
    event_types: ["llm_request"]
  rules:
    - id: redact-email
      description: scrub emails
      match:
        event_type: llm_request
        payload: []
      action: redact
      severity: info
      message: "email scrubbed"
      redactions:
        - path: "messages[*].content"
          pattern: "[^\\\\s]+@[^\\\\s]+"
          replacement: "<EMAIL>"
`);

const POLICY_DENY_DELETE = parsePolicy(`
apiVersion: krynix.dev/v1
metadata:
  name: e2e-deny
  version: "1.0.0"
  description: Deny tools containing 'delete'
spec:
  scope:
    agents: ["*"]
    event_types: ["llm_request"]
  rules:
    - id: deny-on-bad-prompt
      description: deny on dangerous-instruction prompts
      match:
        event_type: llm_request
        payload:
          - field: messages
            operator: contains
            value: "delete the database"
      action: deny
      severity: critical
      message: "destructive prompt rejected"
`);

const POLICY_REQUIRE_APPROVAL = parsePolicy(`
apiVersion: krynix.dev/v1
metadata:
  name: e2e-approval
  version: "1.0.0"
  description: Require approval for sensitive prompts
spec:
  scope:
    agents: ["*"]
    event_types: ["llm_request"]
  rules:
    - id: approve-financial
      description: needs sign-off
      match:
        event_type: llm_request
        payload:
          - field: messages
            operator: contains
            value: "transfer funds"
      action: require-approval
      severity: warning
      message: "needs human approval"
      on_timeout: deny
`);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("@krynix/sdk — end-to-end integration", () => {
  let ingest: FakeIngest;

  beforeEach(async () => {
    ingest = await startFakeIngest();
  });

  afterEach(async () => {
    await ingest.close();
  });

  afterAll(() => {
    // Remove the stub adapter we registered at module top so the
    // class-level registry returns to its pre-test snapshot. Without
    // this, other integration tests sharing the worker would see the
    // stub `__stubLLM` adapter in `Krynix.listAdapters()`.
    const arr = (Krynix as unknown as { adapters: { name: string }[] }).adapters;
    for (let i = arr.length - 1; i >= 0; i--) {
      const adapter = arr[i];
      if (adapter !== undefined && !initialAdapterNames.has(adapter.name)) arr.splice(i, 1);
    }
  });

  test("registry: no adapter for a non-matching client throws NoAdapterError", () => {
    const krynix = new Krynix({
      policy: POLICY_PASS,
      agentId: "agent-1",
      sessionId: randomUUID(),
    });
    expect(() => krynix.wrap({})).toThrow(NoAdapterError);
  });

  test("pass verdict: call forwards unchanged + decision event lands in ingest", async () => {
    const krynix = new Krynix({
      policy: POLICY_PASS,
      agentId: "agent-1",
      sessionId: randomUUID(),
      ingest: { url: ingest.url, apiKey: "test-key", flushIntervalMs: 50 },
    });

    const client = krynix.wrap(makeStubLlmClient());
    const response = await client.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(response.content).toBe("ok");
    expect(client.captured).toHaveLength(1);
    // Body reached the LLM unchanged.
    expect(client.captured[0]?.messages[0]?.content).toBe("hello");

    await krynix.close(); // drain the buffer

    const eventPosts = ingest.requests.filter(
      (r) => r.method === "POST" && /\/events$/.test(r.path),
    );
    expect(eventPosts.length).toBeGreaterThan(0);
    // Inspect what landed.
    const lastBatch = eventPosts.at(-1)?.body as { events: { event_type: string; payload: Record<string, unknown> }[] };
    expect(lastBatch.events.some((e) => e.event_type === "decision")).toBe(true);
    expect(eventPosts[0]?.authorization).toBe("Bearer test-key");
  });

  test("redact verdict: the email is scrubbed in the request body the LLM sees", async () => {
    const krynix = new Krynix({
      policy: POLICY_REDACT_EMAIL,
      agentId: "agent-1",
      sessionId: randomUUID(),
      ingest: { url: ingest.url, apiKey: "test-key", flushIntervalMs: 50 },
    });

    const client = krynix.wrap(makeStubLlmClient());
    await client.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "user", content: "my email is alice@example.com — please ignore it" },
      ],
    });

    expect(client.captured).toHaveLength(1);
    const sentContent = client.captured[0]?.messages[0]?.content ?? "";
    // The body that reached the LLM has the email replaced.
    expect(sentContent).toContain("<EMAIL>");
    expect(sentContent).not.toContain("alice@example.com");

    await krynix.close();

    const eventPosts = ingest.requests.filter(
      (r) => r.method === "POST" && /\/events$/.test(r.path),
    );
    const allEvents = eventPosts.flatMap(
      (r) => (r.body as { events: { event_type: string; payload: Record<string, unknown> }[] }).events,
    );
    const decisionEvent = allEvents.find((e) => e.event_type === "decision");
    expect(decisionEvent).toBeDefined();
    const policyDecision = (decisionEvent?.payload as { policy_decision: { verdict: string; redactions: { path: string; value_redacted: string }[] } }).policy_decision;
    expect(policyDecision.verdict).toBe("redact");
    expect(policyDecision.redactions).toHaveLength(1);
    expect(policyDecision.redactions[0]?.value_redacted).toBe("<EMAIL>");
  });

  test("deny verdict: throws PolicyDenied + LLM is never called", async () => {
    const krynix = new Krynix({
      policy: POLICY_DENY_DELETE,
      agentId: "agent-1",
      sessionId: randomUUID(),
      ingest: { url: ingest.url, apiKey: "test-key", flushIntervalMs: 50 },
    });

    const stub = makeStubLlmClient();
    const client = krynix.wrap(stub);

    await expect(
      client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "please delete the database" }],
      }),
    ).rejects.toBeInstanceOf(PolicyDenied);

    // The deny path must not reach the LLM.
    expect(stub.captured).toHaveLength(0);

    await krynix.close();
  });

  test("require-approval verdict: approved by human → call forwards", async () => {
    const krynix = new Krynix({
      policy: POLICY_REQUIRE_APPROVAL,
      agentId: "agent-1",
      sessionId: randomUUID(),
      ingest: { url: ingest.url, apiKey: "test-key", flushIntervalMs: 50 },
      approval: { mode: "soft", timeoutMs: 2_000, pollIntervalMs: 30, maxPollIntervalMs: 30 },
    });

    const client = krynix.wrap(makeStubLlmClient());

    // Resolve the next approval to "approved" after a tick so the SDK
    // sees one pending poll and then a terminal status.
    setTimeout(() => {
      ingest.resolveApproval("appr-1", { status: "approved", resolved_by: "alice" });
    }, 100);

    const response = await client.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "transfer funds to acme corp" }],
    });

    expect(response.content).toBe("ok");

    // Verify the SDK actually went through the approval flow.
    const approvalSubmits = ingest.requests.filter(
      (r) => r.method === "POST" && /\/approvals$/.test(r.path),
    );
    const approvalPolls = ingest.requests.filter(
      (r) => r.method === "GET" && /\/approvals\/appr-1$/.test(r.path),
    );
    expect(approvalSubmits).toHaveLength(1);
    expect(approvalPolls.length).toBeGreaterThan(0);

    await krynix.close();
  });

  test("require-approval verdict: denied by human → throws ApprovalDenied", async () => {
    const krynix = new Krynix({
      policy: POLICY_REQUIRE_APPROVAL,
      agentId: "agent-1",
      sessionId: randomUUID(),
      ingest: { url: ingest.url, apiKey: "test-key", flushIntervalMs: 50 },
      approval: { mode: "soft", timeoutMs: 2_000, pollIntervalMs: 30, maxPollIntervalMs: 30 },
    });

    const client = krynix.wrap(makeStubLlmClient());

    setTimeout(() => {
      ingest.resolveApproval("appr-1", { status: "denied", resolved_by: "alice", notes: "no" });
    }, 100);

    await expect(
      client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "transfer funds to acme corp" }],
      }),
    ).rejects.toBeInstanceOf(ApprovalDenied);

    await krynix.close();
  });

  test("require-approval verdict: timeout with on_timeout=deny → throws ApprovalTimeout", async () => {
    const krynix = new Krynix({
      policy: POLICY_REQUIRE_APPROVAL,
      agentId: "agent-1",
      sessionId: randomUUID(),
      ingest: { url: ingest.url, apiKey: "test-key", flushIntervalMs: 50 },
      approval: { mode: "soft", timeoutMs: 200, pollIntervalMs: 30, maxPollIntervalMs: 30 },
    });

    const client = krynix.wrap(makeStubLlmClient());

    // No resolution — let the SDK poll until its soft-timeout fires.
    await expect(
      client.chat.completions.create({
        model: "gpt-4",
        messages: [{ role: "user", content: "transfer funds to acme corp" }],
      }),
    ).rejects.toBeInstanceOf(ApprovalTimeout);

    await krynix.close();
  });

  test("ingest wire shape: events POST body includes session-scoped events with hash-chain fields stripped", async () => {
    const sessionId = randomUUID();
    const krynix = new Krynix({
      policy: POLICY_PASS,
      agentId: "agent-1",
      sessionId,
      ingest: { url: ingest.url, apiKey: "test-key", flushIntervalMs: 30 },
    });

    const client = krynix.wrap(makeStubLlmClient());
    await client.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: "hi" }],
    });

    await krynix.close();

    const eventPosts = ingest.requests.filter(
      (r) => r.method === "POST" && /\/events$/.test(r.path),
    );
    expect(eventPosts.length).toBeGreaterThan(0);
    expect(eventPosts[0]?.path).toBe(`/v1/sessions/${sessionId}/events`);

    const events = (eventPosts[0]?.body as { events: Record<string, unknown>[] }).events;
    expect(events.length).toBeGreaterThan(0);
    for (const ev of events) {
      // The IngestClient strips these fields per the documented
      // contract — ingest computes them server-side.
      expect("prev_hash" in ev).toBe(false);
      expect("event_hash" in ev).toBe(false);
      expect("sequence_num" in ev).toBe(false);
      // session_id, agent_id, event_type, payload, timestamp survive.
      expect(ev["session_id"]).toBe(sessionId);
      expect(ev["agent_id"]).toBe("agent-1");
    }
  });
});
