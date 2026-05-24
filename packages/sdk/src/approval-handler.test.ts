import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { TraceEvent } from "@krynix/core";
import type { Policy } from "@krynix/policy";
import type { ApprovalOutcome, ApprovalPoller } from "./approval-poller.js";
import { ApprovalDenied, ApprovalUnavailable } from "./errors.js";
import {
  denyAllApprovalHandler,
  resolveApproval,
  webhookApprovalHandler,
  type ApprovalDecision,
  type ApprovalHandler,
  type ApprovalHandlerEvent,
} from "./approval-handler.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeHandlerEvent(overrides: Partial<ApprovalHandlerEvent> = {}): ApprovalHandlerEvent {
  return {
    sessionId: "sess-1",
    agentId: "test-agent",
    ruleId: "test-rule",
    message: "approval required for tests",
    onTimeout: "deny",
    body: { foo: "bar" },
    decisionEvent: {} as TraceEvent,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Built-in: denyAllApprovalHandler
// ---------------------------------------------------------------------------

describe("denyAllApprovalHandler", () => {
  test("returns deny with a reason mentioning the ruleId", async () => {
    const decision = await denyAllApprovalHandler(makeHandlerEvent({ ruleId: "block-payments" }));
    expect(decision.action).toBe("deny");
    if (decision.action === "deny") {
      expect(decision.reason).toContain("block-payments");
    }
  });
});

// ---------------------------------------------------------------------------
// Built-in: webhookApprovalHandler
// ---------------------------------------------------------------------------

describe("webhookApprovalHandler", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(impl: (input: string, init: RequestInit | undefined) => Promise<Response>) {
    globalThis.fetch = vi.fn(impl as typeof fetch) as typeof fetch;
  }

  test("POSTs the expected shape and parses an `approve` response", async () => {
    let received: { url: string; body: unknown } | null = null;
    mockFetch(async (url, init) => {
      received = {
        url: url as string,
        body: JSON.parse((init?.body as string) ?? "null"),
      };
      return new Response(JSON.stringify({ action: "approve" }), { status: 200 });
    });

    const handler = webhookApprovalHandler({
      url: "https://example.test/hook",
      headers: { "x-token": "abc" },
    });
    const decision = await handler(
      makeHandlerEvent({
        sessionId: "S1",
        agentId: "A1",
        ruleId: "R1",
        message: "review me",
        body: { hello: "world" },
      }),
    );

    expect(decision).toEqual({ action: "approve" });
    expect(received).not.toBeNull();
    const r = received as unknown as { url: string; body: unknown };
    expect(r.url).toBe("https://example.test/hook");
    expect(r.body).toEqual({
      session_id: "S1",
      agent_id: "A1",
      rule_id: "R1",
      message: "review me",
      on_timeout: "deny",
      body: { hello: "world" },
    });
  });

  test("parses an `approve_with_redactions` response", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            action: "approve_with_redactions",
            redactions: [{ path: "messages[0].content", replacement: "<X>" }],
          }),
          { status: 200 },
        ),
    );

    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    const decision = await handler(makeHandlerEvent());
    expect(decision.action).toBe("approve_with_redactions");
    if (decision.action === "approve_with_redactions") {
      expect(decision.redactions).toHaveLength(1);
    }
  });

  test("parses a `deny` response with reason", async () => {
    mockFetch(
      async () =>
        new Response(JSON.stringify({ action: "deny", reason: "policy violation" }), {
          status: 200,
        }),
    );
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    const decision = await handler(makeHandlerEvent());
    expect(decision).toEqual({ action: "deny", reason: "policy violation" });
  });

  test("throws on non-200 response", async () => {
    mockFetch(async () => new Response("nope", { status: 500 }));
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(/HTTP 500/);
  });

  test("throws on non-JSON response", async () => {
    mockFetch(async () => new Response("not-json", { status: 200 }));
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(/non-JSON/);
  });

  test("throws on unknown action", async () => {
    mockFetch(async () => new Response(JSON.stringify({ action: "maybe" }), { status: 200 }));
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(/unknown action/);
  });

  test("rejects approve_with_redactions whose redactions[] is not an array", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({ action: "approve_with_redactions", redactions: "not an array" }),
          { status: 200 },
        ),
    );
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(/not an array/);
  });

  test("rejects redaction missing the required `path` field", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            action: "approve_with_redactions",
            redactions: [{ pattern: "x", replacement: "<X>" }],
          }),
          { status: 200 },
        ),
    );
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(
      /redactions\[0\]\.path must be a non-empty string/,
    );
  });

  test("rejects redaction with non-string `path`", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            action: "approve_with_redactions",
            redactions: [{ path: 42 }],
          }),
          { status: 200 },
        ),
    );
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(
      /redactions\[0\]\.path must be a non-empty string/,
    );
  });

  test("rejects redaction with non-string `pattern`", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            action: "approve_with_redactions",
            redactions: [{ path: "a.b", pattern: 99 }],
          }),
          { status: 200 },
        ),
    );
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(
      /redactions\[0\]\.pattern must be a string/,
    );
  });

  test("rejects redaction with non-string `replacement`", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            action: "approve_with_redactions",
            redactions: [{ path: "a.b", replacement: { x: 1 } }],
          }),
          { status: 200 },
        ),
    );
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(
      /redactions\[0\]\.replacement must be a string/,
    );
  });

  test("rejects non-object redaction entry (e.g. a string in the array)", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            action: "approve_with_redactions",
            redactions: ["messages[0].content"],
          }),
          { status: 200 },
        ),
    );
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(/redactions\[0\] is not an object/);
  });

  test("circular `body` doesn't crash the handler — falls back to a placeholder via the outer try/catch", async () => {
    let received: string | null = null;
    mockFetch(async (_url, init) => {
      received = (init?.body as string) ?? null;
      return new Response(JSON.stringify({ action: "approve" }), { status: 200 });
    });
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });

    type Circular = { name: string; self?: Circular };
    const circular: Circular = { name: "loop" };
    circular.self = circular;

    await expect(handler(makeHandlerEvent({ body: circular }))).resolves.toEqual({
      action: "approve",
    });
    expect(received).not.toBeNull();
    expect(received).toContain("unserialisable body");
  });

  test("timeout surfaces as a clear error mentioning timeoutMs (not a bare AbortError)", async () => {
    // Simulate a fetch that never resolves so the AbortController fires.
    // The handler MUST surface this as a clear timeout error rather than
    // leaking the underlying AbortError / DOMException.
    mockFetch((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });

    const handler = webhookApprovalHandler({
      url: "https://example.test/hook",
      timeoutMs: 25,
    });
    await expect(handler(makeHandlerEvent())).rejects.toThrow(/timed out after 25ms/);
  });

  test("BigInt in `body` is serialised as a string instead of throwing", async () => {
    let received: string | null = null;
    mockFetch(async (_url, init) => {
      received = (init?.body as string) ?? null;
      return new Response(JSON.stringify({ action: "approve" }), { status: 200 });
    });
    const handler = webhookApprovalHandler({ url: "https://example.test/hook" });
    await expect(handler(makeHandlerEvent({ body: { amount: BigInt(999) } }))).resolves.toEqual({
      action: "approve",
    });
    expect(received).toContain('"amount":"999n"');
  });
});

// ---------------------------------------------------------------------------
// resolveApproval — the unified router adapters call.
// ---------------------------------------------------------------------------

describe("resolveApproval — routing precedence", () => {
  test("uses poller when configured (poller wins over handler)", async () => {
    const pollerOutcome: ApprovalOutcome = { action: "approve", approvalId: "appr-1" };
    const fakePoller = {
      waitForApproval: vi.fn(async () => pollerOutcome),
    } as unknown as ApprovalPoller;

    const handler = vi.fn(async () => ({ action: "approve" as const }));

    const result = await resolveApproval({
      poller: fakePoller,
      handler,
      handlerEvent: makeHandlerEvent({ ruleId: "r1", onTimeout: "deny" }),
    });

    expect(result).toEqual({ action: "approve", source: "poller", approvalId: "appr-1" });
    expect(fakePoller.waitForApproval).toHaveBeenCalledTimes(1);
    // Confirm the poller saw the values from handlerEvent (the single source of truth).
    expect(fakePoller.waitForApproval).toHaveBeenCalledWith(expect.anything(), "r1", "deny");
    expect(handler).not.toHaveBeenCalled();
  });

  test("handlerEvent is the single source of truth — poller receives its decisionEvent", async () => {
    // Pre-fix, resolveApproval took ruleId / onTimeout / policyDecisionEvent
    // as parallel parameters alongside handlerEvent, which let adapters
    // accidentally pass mismatched values. Post-fix, those three values
    // are derived from handlerEvent exclusively. Lock that in.
    const ownDecisionEvent = { _marker: "owned-by-handler-event" } as unknown as TraceEvent;
    const pollerOutcome: ApprovalOutcome = { action: "approve", approvalId: "appr-derived" };
    const seen: { event: unknown; ruleId: unknown; onTimeout: unknown } = {
      event: null,
      ruleId: null,
      onTimeout: null,
    };
    const fakePoller = {
      waitForApproval: vi.fn(
        async (event: TraceEvent, ruleId: string, onTimeout: "allow" | "deny" | undefined) => {
          seen.event = event;
          seen.ruleId = ruleId;
          seen.onTimeout = onTimeout;
          return pollerOutcome;
        },
      ),
    } as unknown as ApprovalPoller;

    await resolveApproval({
      poller: fakePoller,
      handler: null,
      handlerEvent: makeHandlerEvent({
        ruleId: "rule-from-event",
        onTimeout: "allow",
        decisionEvent: ownDecisionEvent,
      }),
    });

    expect(seen.event).toBe(ownDecisionEvent);
    expect(seen.ruleId).toBe("rule-from-event");
    expect(seen.onTimeout).toBe("allow");
  });

  test("poller soft-timeout (on_timeout=allow) returns approve_after_timeout, not approve", async () => {
    // Critical distinction: a human did NOT approve. The agent forwards
    // because the rule's on_timeout was "allow", but adapters need to
    // record that no human acted. Pre-alpha.2 this collapsed silently to
    // `action: "approve"` via the pollerOutcome inspection requirement —
    // easy to miss.
    const timeoutOutcome: ApprovalOutcome = {
      action: "timeout",
      approvalId: "appr-2",
      onTimeout: "allow",
    };
    const fakePoller = {
      waitForApproval: vi.fn(async () => timeoutOutcome),
    } as unknown as ApprovalPoller;

    const result = await resolveApproval({
      poller: fakePoller,
      handler: null,
      handlerEvent: makeHandlerEvent({ ruleId: "r-timeout", onTimeout: "allow" }),
    });

    expect(result).toEqual({
      action: "approve_after_timeout",
      source: "poller",
      approvalId: "appr-2",
    });
  });

  test("falls back to handler when poller is null", async () => {
    const handler: ApprovalHandler = vi.fn(
      async (): Promise<ApprovalDecision> => ({ action: "approve" }),
    );
    const result = await resolveApproval({
      poller: null,
      handler,
      handlerEvent: makeHandlerEvent({ ruleId: "r-local", onTimeout: undefined }),
    });
    expect(result).toEqual({ action: "approve", source: "handler" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("forwards approve_with_redactions from the handler", async () => {
    const redactions = [{ path: "messages[0].content", replacement: "<X>" }];
    const handler: ApprovalHandler = vi.fn(
      async (): Promise<ApprovalDecision> => ({
        action: "approve_with_redactions",
        redactions,
      }),
    );
    const result = await resolveApproval({
      poller: null,
      handler,
      handlerEvent: makeHandlerEvent({ ruleId: "r", onTimeout: undefined }),
    });
    expect(result.action).toBe("approve_with_redactions");
    if (result.action === "approve_with_redactions") {
      expect(result.source).toBe("handler");
      expect(result.redactions).toEqual(redactions);
    }
  });

  test("handler deny throws ApprovalDenied carrying rule id + reason", async () => {
    const handler: ApprovalHandler = vi.fn(
      async (): Promise<ApprovalDecision> => ({
        action: "deny",
        reason: "operator declined",
      }),
    );
    await expect(
      resolveApproval({
        poller: null,
        handler,
        handlerEvent: makeHandlerEvent({ ruleId: "r-deny", onTimeout: undefined }),
      }),
    ).rejects.toMatchObject({
      name: "ApprovalDenied",
      ruleId: "r-deny",
      notes: "operator declined",
    });
  });

  test("neither poller nor handler → ApprovalUnavailable carries the rule id", async () => {
    const promise = resolveApproval({
      poller: null,
      handler: null,
      handlerEvent: makeHandlerEvent({ ruleId: "r-no-transport", onTimeout: undefined }),
    });
    await expect(promise).rejects.toBeInstanceOf(ApprovalUnavailable);
    await expect(promise).rejects.toMatchObject({ ruleId: "r-no-transport" });
  });
});

// ---------------------------------------------------------------------------
// Integration with Krynix constructor — context wiring
// ---------------------------------------------------------------------------

describe("Krynix constructor wires approvalHandler into ctx", () => {
  // Lazy-import Krynix to avoid pulling adapter side effects in unrelated tests.
  beforeEach(() => {
    vi.resetModules();
  });

  test("ctx.approvalHandler is null when no handler is configured", async () => {
    const { Krynix } = await import("./krynix.js");
    const k = new Krynix({
      policy: stubPolicy(),
      agentId: "a",
      sessionId: "s",
    });
    expect(k.ctx.approvalHandler).toBeNull();
  });

  test("ctx.approvalHandler is set when configured", async () => {
    const { Krynix } = await import("./krynix.js");
    const handler: ApprovalHandler = async () => ({ action: "approve" });
    const k = new Krynix({
      policy: stubPolicy(),
      agentId: "a",
      sessionId: "s",
      approvalHandler: handler,
    });
    expect(k.ctx.approvalHandler).toBe(handler);
  });
});

// Minimal stub Policy — Krynix's constructor doesn't validate the policy
// structure (it just stashes the reference); a stub is enough.
function stubPolicy(): Policy {
  return {
    apiVersion: "krynix.dev/v1",
    kind: "Policy",
    metadata: { name: "t", version: "1", description: "" },
    spec: { scope: { agents: ["*"], event_types: ["*"] }, rules: [] },
  } as unknown as Policy;
}

// `ApprovalDenied` is also exported; this asserts the symbol exists at
// runtime so consumers who instanceof it don't get a stale build.
test("ApprovalDenied symbol is exported", () => {
  expect(typeof ApprovalDenied).toBe("function");
});
