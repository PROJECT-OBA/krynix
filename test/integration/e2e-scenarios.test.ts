/**
 * Adapter-Agnostic Pipeline E2E Tests (CI-Safe)
 *
 * Wires real @krynix/policy evaluate() and real @krynix/replay verifyTrace()
 * into runEvaluationPipeline() — replacing mocked passDeps() with real
 * dependencies. Proves the pipeline orchestration works end-to-end.
 *
 * Runs in CI without OpenClaw. Uses Krynix session manager directly to
 * generate traces — any adapter could produce these events.
 *
 * @module
 */

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  runEvaluationPipeline,
} from "../../packages/core/src/index.js";
import type {
  TraceEvent,
  Session,
  EvaluationPipelineDeps,
} from "../../packages/core/src/index.js";
import {
  parsePolicy,
  evaluate,
  resolvePolicy,
} from "../../packages/policy/src/index.js";
import type { Policy, PolicyResolver } from "../../packages/policy/src/index.js";
import { verifyTrace } from "../../packages/replay/src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-e2e-"));
  return tempDir;
}

/** Build real pipeline deps wired to @krynix/policy + @krynix/replay. */
function createRealDeps(tracePath: string): EvaluationPipelineDeps {
  return {
    evaluatePolicy: async (events: readonly TraceEvent[], policy: unknown) => {
      const p = policy as Policy;
      const result = evaluate([...events], p);
      return {
        policyName: p.metadata.name,
        verdict: result.verdict,
        exitCode: result.exitCode,
        violations: result.violations,
      };
    },
    verifyReplay: async (_events: readonly TraceEvent[]) => {
      const result = await verifyTrace(tracePath);
      return {
        valid: result.status === "pass",
        exitCode: result.status === "pass" ? 0 : 1,
        details: result,
      };
    },
  };
}

/** Record a tool_call event (file_read) — always allowed by openclaw-default policy. */
async function recordFileRead(session: Session): Promise<void> {
  await recordEvent(session, {
    event_type: "tool_call",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: session.agentId,
    payload: { tool_name: "file_read", arguments: { path: "/src/index.ts" } },
    metadata: { _adapter: "test" },
  });
}

/** Record a tool_call event (shell_exec) — denied by openclaw-default policy. */
async function recordShellExec(session: Session): Promise<void> {
  await recordEvent(session, {
    event_type: "tool_call",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: session.agentId,
    payload: { tool_name: "shell_exec", arguments: { command: "rm -rf /" } },
    metadata: { _adapter: "test" },
  });
}

/** Record a tool_call event (file_write) — requires approval by openclaw-default policy. */
async function recordFileWrite(session: Session): Promise<void> {
  await recordEvent(session, {
    event_type: "tool_call",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: session.agentId,
    payload: { tool_name: "file_write", arguments: { path: "/tmp/output.txt", content: "data" } },
    metadata: { _adapter: "test" },
  });
}

/** Record an llm_request event. */
async function recordLlmRequest(session: Session): Promise<void> {
  await recordEvent(session, {
    event_type: "llm_request",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: session.agentId,
    payload: { model: "gpt-4", messages: [], parameters: { provider: "openai" } },
    metadata: null,
  });
}

/** Record an llm_response event. */
async function recordLlmResponse(session: Session): Promise<void> {
  await recordEvent(session, {
    event_type: "llm_response",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: session.agentId,
    payload: {
      model: "gpt-4",
      content: "Hello!",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      finish_reason: "stop",
    },
    metadata: null,
  });
}

/** Load the real openclaw-default policy. */
async function loadDefaultPolicy(): Promise<Policy> {
  const yaml = await readFile(
    join(import.meta.dirname, "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml"),
    "utf-8",
  );
  return parsePolicy(yaml);
}

// ---------------------------------------------------------------------------
// Scenario tests
// ---------------------------------------------------------------------------

describe("E2E Pipeline Scenarios", () => {
  test("e2e: happy path → pass verdict, replay verified", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "happy.trace.jsonl");

    // Generate trace with only allowed events
    const session = await startSession({
      agentId: "e2e-test",
      replaySeed: 42,
      outputPath: tracePath,
    });
    await recordFileRead(session);
    await recordLlmRequest(session);
    await recordLlmResponse(session);
    await endSession(session);

    // Run pipeline with real deps
    const policy = await loadDefaultPolicy();
    const deps = createRealDeps(tracePath);
    const result = await runEvaluationPipeline(
      { tracePath, policies: [policy] },
      deps,
    );

    expect(result.exitCode).toBe(0);
    expect(result.hashChain.valid).toBe(true);
    expect(result.policyResults[0]?.verdict).toBe("pass");
    expect(result.replayResult?.valid).toBe(true);
    expect(result.stats.event_count).toBe(5); // session_start + 3 events + session_end
  });

  test("e2e: policy denial → critical fail", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "denied.trace.jsonl");

    const session = await startSession({
      agentId: "e2e-test",
      replaySeed: 100,
      outputPath: tracePath,
    });
    await recordFileRead(session);
    await recordShellExec(session);
    await endSession(session);

    const policy = await loadDefaultPolicy();
    const deps = createRealDeps(tracePath);
    const result = await runEvaluationPipeline(
      { tracePath, policies: [policy] },
      deps,
    );

    // shell_exec triggers critical deny → exit 2
    expect(result.exitCode).toBe(2);
    expect(result.policyResults[0]?.verdict).toBe("fail");
    const violations = result.policyResults[0]?.violations as Array<{ ruleId: string }>;
    expect(violations.some((v) => v.ruleId === "deny-shell-exec")).toBe(true);
  });

  test("e2e: multi-policy → most-restrictive-wins", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "multi.trace.jsonl");

    const session = await startSession({
      agentId: "e2e-test",
      replaySeed: 200,
      outputPath: tracePath,
    });
    await recordShellExec(session);
    await endSession(session);

    // Permissive policy: allow all
    const permissivePolicy = parsePolicy(`
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: permissive
  version: "1.0.0"
  description: Allow everything
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: allow-all
      description: Allow all events
      match:
        payload: []
      action: allow
      severity: info
      message: Allowed
`);

    const restrictivePolicy = await loadDefaultPolicy();
    const deps = createRealDeps(tracePath);
    const result = await runEvaluationPipeline(
      { tracePath, policies: [permissivePolicy, restrictivePolicy] },
      deps,
    );

    // Restrictive policy denies shell_exec → exit 2, permissive exits 0 → max = 2
    expect(result.exitCode).toBe(2);
    expect(result.policyResults.length).toBe(2);

    const permResult = result.policyResults.find((p) => p.policyName === "permissive");
    const restResult = result.policyResults.find((p) => p.policyName === "openclaw-default");
    expect(permResult?.exitCode).toBe(0);
    expect(restResult?.exitCode).toBe(2);
  });

  test("e2e: inheritance → file resolver + merged rules", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "inherit.trace.jsonl");

    // Write parent policy
    await writeFile(
      join(dir, "parent.policy.yaml"),
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: parent-policy
  version: "1.0.0"
  description: Parent policy — deny shell_exec
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: deny-shell-exec
      description: Block all shell_exec tool calls
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: critical
      message: Shell execution is not permitted
  defaults:
    unmatched_action: allow
    unmatched_severity: info
`,
    );

    // Write child policy that extends parent and adds file_write rule
    await writeFile(
      join(dir, "child.policy.yaml"),
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: child-policy
  version: "1.0.0"
  description: Child policy — extends parent, adds file_write rule
  extends: parent-policy
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: require-approval-file-write
      description: Require human approval for file_write
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: file_write
      action: require-approval
      severity: warning
      message: File write operations require human approval
  defaults:
    unmatched_action: allow
    unmatched_severity: info
`,
    );

    // Create a file-based resolver that maps policy names to files
    const policyFiles = new Map<string, string>([
      ["parent-policy", join(dir, "parent.policy.yaml")],
    ]);
    const resolver: PolicyResolver = async (name: string) => {
      const filePath = policyFiles.get(name);
      if (!filePath) {
        throw new Error(`Policy "${name}" not found`);
      }
      try {
        const yaml = await readFile(filePath, "utf-8");
        return parsePolicy(yaml);
      } catch {
        throw new Error(`Policy "${name}" not found at ${filePath}`);
      }
    };

    // Resolve child policy with inheritance
    const childYaml = await readFile(join(dir, "child.policy.yaml"), "utf-8");
    const childPolicy = parsePolicy(childYaml);
    const mergedPolicy = await resolvePolicy(childPolicy, resolver);

    // Generate trace with file_read, shell_exec, and file_write
    const session = await startSession({
      agentId: "e2e-test",
      replaySeed: 300,
      outputPath: tracePath,
    });
    await recordFileRead(session);
    await recordShellExec(session);
    await recordFileWrite(session);
    await endSession(session);

    // Evaluate with merged policy
    const events = await readTrace(tracePath);
    const evalResult = evaluate(events, mergedPolicy);

    // file_read → allowed (no violation)
    // shell_exec → denied (critical)
    // file_write → require-approval (warning)
    expect(evalResult.exitCode).toBeGreaterThan(0);

    const shellViolation = evalResult.violations.find(
      (v) => v.ruleId === "deny-shell-exec",
    );
    expect(shellViolation).toBeDefined();
    expect(shellViolation?.severity).toBe("critical");

    const writeViolation = evalResult.violations.find(
      (v) => v.ruleId === "require-approval-file-write",
    );
    expect(writeViolation).toBeDefined();
    expect(writeViolation?.severity).toBe("warning");
  });

  test("e2e: filtered evaluation → tool_call only", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "filtered.trace.jsonl");

    // Generate trace with mixed event types
    const session = await startSession({
      agentId: "e2e-test",
      replaySeed: 400,
      outputPath: tracePath,
    });
    await recordFileRead(session);
    await recordLlmRequest(session);
    await recordLlmResponse(session);
    await recordShellExec(session);
    await endSession(session);

    const policy = await loadDefaultPolicy();
    const deps = createRealDeps(tracePath);

    // Run pipeline with filter: only tool_call events
    const result = await runEvaluationPipeline(
      {
        tracePath,
        policies: [policy],
        filter: { event_types: ["tool_call"] },
      },
      deps,
    );

    // Filtered events should only be tool_call events
    const eventTypes = result.events.map((e) => e.event_type);
    expect(eventTypes.every((t) => t === "tool_call")).toBe(true);
    expect(result.events.length).toBe(2); // file_read + shell_exec

    // Stats should reflect filtered count
    expect(result.stats.event_count).toBe(2);

    // Replay uses unfiltered trace — should still pass
    expect(result.replayResult?.valid).toBe(true);

    // Policy still catches shell_exec in filtered results
    expect(result.exitCode).toBe(2);
  });

  test("e2e: compliance bundle → digests match content", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "bundle.trace.jsonl");

    const session = await startSession({
      agentId: "e2e-test",
      replaySeed: 500,
      outputPath: tracePath,
    });
    await recordFileRead(session);
    await recordShellExec(session);
    await endSession(session);

    const policy = await loadDefaultPolicy();
    const deps = createRealDeps(tracePath);

    const result = await runEvaluationPipeline(
      {
        tracePath,
        policies: [policy],
        generateBundle: true,
        bundleOptions: { include_otlp: true },
      },
      deps,
    );

    expect(result.bundle).toBeDefined();
    const bundle = result.bundle!;

    // Verify manifest has artifacts
    expect(bundle.manifest.artifacts.length).toBeGreaterThan(0);

    // Verify every manifest artifact has a sha256: prefixed digest
    for (const manifestArtifact of bundle.manifest.artifacts) {
      expect(manifestArtifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/);

      // Find the corresponding BundleArtifact by path
      const artifact = bundle.artifacts.find((a) => a.path === manifestArtifact.path);
      expect(artifact).toBeDefined();

      // Verify manifest digest matches computed hash of artifact content
      const computedHash = createHash("sha256")
        .update(artifact!.content, "utf-8")
        .digest("hex");
      expect(manifestArtifact.digest).toBe(`sha256:${computedHash}`);
    }

    // Should include trace, evaluation, and stats artifacts at minimum
    const types = bundle.manifest.artifacts.map((a) => a.type);
    expect(types).toContain("trace");
    expect(types).toContain("evaluation");
    expect(types).toContain("stats");

    // With include_otlp: true, should also have OTLP artifact
    expect(types).toContain("otlp");
  });
});
