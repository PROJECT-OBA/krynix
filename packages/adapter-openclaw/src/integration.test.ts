import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { OpenClawAdapter } from "./adapter.js";
import type { OpenClawHookEvent } from "./openclaw-types.js";
import { startSession, recordEvent, endSession, readTrace, validateHashChain } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";
import { parsePolicy, evaluate } from "@krynix/policy";
import { verifyTrace } from "@krynix/replay";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-openclaw-integration-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Simulated OpenClaw hook events
// ---------------------------------------------------------------------------

const HOOK_EVENTS: OpenClawHookEvent[] = [
  {
    _hook: "session_start",
    event: { sessionId: "oc-123" },
    context: { agentId: "openclaw-test", sessionId: "oc-123" },
  },
  {
    _hook: "before_tool_call",
    event: { toolName: "file_read", params: { path: "/src/index.ts" } },
    context: { agentId: "openclaw-test", sessionKey: "sk1", toolName: "file_read" },
  },
  {
    _hook: "after_tool_call",
    event: {
      toolName: "file_read",
      params: { path: "/src/index.ts" },
      result: "contents...",
      durationMs: 15,
    },
    context: { agentId: "openclaw-test", sessionKey: "sk1", toolName: "file_read" },
  },
  {
    _hook: "before_tool_call",
    event: { toolName: "shell_exec", params: { command: "rm -rf /" } },
    context: { agentId: "openclaw-test", sessionKey: "sk2", toolName: "shell_exec" },
  },
  {
    _hook: "after_tool_call",
    event: {
      toolName: "shell_exec",
      params: { command: "rm -rf /" },
      error: "blocked by policy",
      durationMs: 0,
    },
    context: { agentId: "openclaw-test", sessionKey: "sk2", toolName: "shell_exec" },
  },
  {
    _hook: "llm_input",
    event: {
      runId: "r1",
      sessionId: "oc-123",
      provider: "openai",
      model: "gpt-4",
      prompt: "Hello",
      historyMessages: [],
      imagesCount: 0,
    },
    context: { agentId: "openclaw-test", sessionId: "oc-123" },
  },
  {
    _hook: "llm_output",
    event: {
      runId: "r1",
      sessionId: "oc-123",
      provider: "openai",
      model: "gpt-4",
      assistantTexts: ["Hi there"],
      usage: { input: 10, output: 5 },
    },
    context: { agentId: "openclaw-test", sessionId: "oc-123" },
  },
  {
    _hook: "session_end",
    event: { sessionId: "oc-123", messageCount: 3, durationMs: 500 },
    context: { agentId: "openclaw-test", sessionId: "oc-123" },
  },
];

async function runFullPipeline(outputPath: string, replaySeed: number): Promise<TraceEvent[]> {
  const adapter = new OpenClawAdapter();
  await adapter.initialize({
    agentId: "openclaw-test",
    sessionId: "test-session",
    replaySeed,
  });

  const session = await startSession({
    agentId: "openclaw-test",
    replaySeed,
    outputPath,
  });

  for (const hookEvent of HOOK_EVENTS) {
    const traceEvent = adapter.onEvent(hookEvent);
    if (traceEvent !== null) {
      await recordEvent(session, {
        event_type: traceEvent.event_type,
        timestamp: traceEvent.timestamp,
        parent_id: traceEvent.parent_id,
        agent_id: traceEvent.agent_id,
        payload: traceEvent.payload,
        metadata: traceEvent.metadata,
      });
    }
  }

  await endSession(session);
  await adapter.shutdown();

  return readTrace(outputPath);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OpenClaw Integration", () => {
  test("end-to-end: adapter → session manager → trace file → hash chain validates", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");

    const events = await runFullPipeline(outputPath, 42);

    // session_start + 8 adapter events + session_end = 10 events
    expect(events.length).toBe(10);

    // Hash chain validates
    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
  });

  test("policy: shell_exec tool events → critical deny violation", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const events = await runFullPipeline(outputPath, 42);

    const policyYaml = await readFile(
      join(import.meta.dirname, "../policies/openclaw-default.policy.yaml"),
      "utf-8",
    );
    const policy = parsePolicy(policyYaml);
    const result = evaluate(events, policy);

    // shell_exec events should trigger critical deny
    expect(result.exitCode).toBeGreaterThan(0);
    const shellViolations = result.violations.filter((v) => v.ruleId === "deny-shell-exec");
    expect(shellViolations.length).toBeGreaterThan(0);
    expect(shellViolations[0]?.severity).toBe("critical");
  });

  test("policy: file_read tool events → allowed (no violation)", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const events = await runFullPipeline(outputPath, 42);

    const policyYaml = await readFile(
      join(import.meta.dirname, "../policies/openclaw-default.policy.yaml"),
      "utf-8",
    );
    const policy = parsePolicy(policyYaml);
    const result = evaluate(events, policy);

    // file_read events should not cause violations
    const fileReadViolations = result.violations.filter((v) => {
      const event = events[v.eventIndex];
      if (!event || event.event_type !== "tool_call") return false;
      const payload = event.payload as { tool_name: string };
      return payload.tool_name === "file_read";
    });
    expect(fileReadViolations.length).toBe(0);
  });

  test("determinism: same seed twice → identical event_ids, session_ids, payloads", async () => {
    const dir = await createTempDir();
    const path1 = join(dir, "trace1.jsonl");
    const path2 = join(dir, "trace2.jsonl");

    const events1 = await runFullPipeline(path1, 42);
    const events2 = await runFullPipeline(path2, 42);

    expect(events1.length).toBe(events2.length);

    for (let i = 0; i < events1.length; i++) {
      const e1 = events1[i] as TraceEvent;
      const e2 = events2[i] as TraceEvent;

      // Deterministic fields must match
      expect(e1.event_id).toBe(e2.event_id);
      expect(e1.session_id).toBe(e2.session_id);
      expect(e1.sequence_num).toBe(e2.sequence_num);
      expect(e1.event_type).toBe(e2.event_type);
      expect(e1.agent_id).toBe(e2.agent_id);
      expect(JSON.stringify(e1.payload)).toBe(JSON.stringify(e2.payload));

      // Timestamps are NOT deterministic (wall-clock time) — skip comparison
    }
  });

  test("golden trace passes verifyTrace from replay runner", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    await runFullPipeline(outputPath, 42);

    const result = await verifyTrace(outputPath);
    expect(result.status).toBe("pass");
  });

  test("all adapter events have correct metadata", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const events = await runFullPipeline(outputPath, 42);

    // Skip session_start (index 0) and session_end (last) — those are from session manager
    const adapterEvents = events.slice(1, -1);
    for (const event of adapterEvents) {
      expect(event.metadata).toMatchObject({
        _adapter: "openclaw",
      });
      expect(event.metadata).toHaveProperty("_openclaw_hook");
    }
  });
});
