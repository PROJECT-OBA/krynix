/**
 * Edge case and stress tests for the Krynix pipeline.
 *
 * Covers: large traces, malformed adapter input, multi-agent sessions.
 */

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  validateHashChain,
  validateTraceEvent,
} from "../../packages/core/src/index.js";
import { evaluate, parsePolicy } from "../../packages/policy/src/index.js";
import { verifyTrace } from "../../packages/replay/src/index.js";
import { LangChainAdapter } from "../../packages/adapter-langchain/src/adapter.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-edge-"));
  return tempDir;
}

const ALLOW_ALL_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: allow-all
  version: "1.0.0"
  description: Allow everything (for stress testing)
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call", "tool_result", "llm_request", "llm_response"]
  rules: []
  defaults:
    unmatched_action: allow
    unmatched_severity: info
`;

describe("edge cases and stress tests", () => {
  test("large trace: 200+ events with valid hash chain and policy evaluation", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "large-trace.trace.jsonl");

    const session = await startSession({
      agentId: "stress-agent",
      replaySeed: 1234,
      outputPath: tracePath,
    });

    // Generate 100 tool_call + tool_result pairs = 200 events
    for (let i = 0; i < 100; i++) {
      await recordEvent(session, {
        event_type: "tool_call",
        timestamp: new Date(Date.now() + i * 100).toISOString(),
        parent_id: null,
        agent_id: "stress-agent",
        payload: {
          tool_name: `tool_${i % 5}`, // Rotate through 5 tool names
          arguments: { index: i, batch: Math.floor(i / 10) },
        },
        metadata: null,
      });

      await recordEvent(session, {
        event_type: "tool_result",
        timestamp: new Date(Date.now() + i * 100 + 50).toISOString(),
        parent_id: null,
        agent_id: "stress-agent",
        payload: {
          tool_name: `tool_${i % 5}`,
          output: { result: `output-${i}`, size: i * 10 },
          duration_ms: 10 + (i % 50),
        },
        metadata: null,
      });
    }

    await endSession(session);

    // Read and validate
    const events = await readTrace(tracePath);
    // 1 session_start + 200 tool events + 1 session_end = 202
    expect(events.length).toBe(202);

    // Hash chain valid
    const hashResult = validateHashChain(events);
    expect(hashResult.valid).toBe(true);

    // All events schema-valid
    for (const event of events) {
      expect(validateTraceEvent(event).valid).toBe(true);
    }

    // Sequence numbers contiguous
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.sequence_num).toBe(i);
    }

    // Policy evaluation works at scale
    const policy = parsePolicy(ALLOW_ALL_POLICY);
    const evalResult = evaluate(events, policy);
    expect(evalResult.exitCode).toBe(0);

    // Replay verification works at scale
    const replayResult = await verifyTrace(tracePath);
    expect(replayResult.status).toBe("pass");
    expect(replayResult.report?.totalEvents).toBe(202);
  });

  test("malformed adapter input: null, undefined, non-object, missing fields", () => {
    const adapter = new LangChainAdapter();
    const skipped: Array<{ reason: string; event: unknown }> = [];
    adapter.onSkippedEvent = (reason, event) => skipped.push({ reason, event });

    // Not initialized — should skip
    expect(adapter.onEvent({ _callback: "handleLLMStart", runId: "r1" })).toBeNull();
    expect(skipped.at(-1)?.reason).toContain("not initialized");

    // Initialize adapter
    adapter.initialize({ agentId: "test", sessionId: "s1" });

    // null input
    expect(adapter.onEvent(null)).toBeNull();
    expect(skipped.at(-1)?.reason).toContain("null or undefined");

    // undefined input
    expect(adapter.onEvent(undefined)).toBeNull();

    // non-object input
    expect(adapter.onEvent("string")).toBeNull();
    expect(skipped.at(-1)?.reason).toContain("not an object");

    expect(adapter.onEvent(42)).toBeNull();
    expect(adapter.onEvent(true)).toBeNull();

    // Missing _callback field
    expect(adapter.onEvent({ runId: "r1" })).toBeNull();
    expect(skipped.at(-1)?.reason).toContain("_callback");

    // Non-string _callback
    expect(adapter.onEvent({ _callback: 123, runId: "r1" })).toBeNull();

    // Unknown callback name
    expect(adapter.onEvent({ _callback: "handleCustomEvent", runId: "r1" })).toBeNull();
    expect(skipped.at(-1)?.reason).toContain("unknown callback");

    // Missing runId
    expect(adapter.onEvent({ _callback: "handleLLMStart" })).toBeNull();
    expect(skipped.at(-1)?.reason).toContain("runId");

    // All malformed inputs were handled gracefully (no throws)
    expect(skipped.length).toBeGreaterThanOrEqual(8);
  });

  test("multi-agent session: two agents writing to same trace", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "multi-agent.trace.jsonl");

    const session = await startSession({
      agentId: "coordinator",
      replaySeed: 555,
      outputPath: tracePath,
    });

    // Agent A: performs file operations
    for (let i = 0; i < 5; i++) {
      await recordEvent(session, {
        event_type: "tool_call",
        timestamp: new Date(Date.now() + i * 200).toISOString(),
        parent_id: null,
        agent_id: "agent-a",
        payload: {
          tool_name: "file_read",
          arguments: { path: `/src/module-${i}.ts` },
        },
        metadata: { "agent.role": "reader" },
      });

      await recordEvent(session, {
        event_type: "tool_result",
        timestamp: new Date(Date.now() + i * 200 + 10).toISOString(),
        parent_id: null,
        agent_id: "agent-a",
        payload: {
          tool_name: "file_read",
          output: `// content of module-${i}`,
          duration_ms: 5,
        },
        metadata: { "agent.role": "reader" },
      });
    }

    // Agent B: performs LLM calls
    for (let i = 0; i < 3; i++) {
      await recordEvent(session, {
        event_type: "llm_request",
        timestamp: new Date(Date.now() + 1000 + i * 300).toISOString(),
        parent_id: null,
        agent_id: "agent-b",
        payload: {
          model: "gpt-4o",
          messages: [{ role: "user", content: `Analyze module ${i}` }],
          parameters: { temperature: 0.7 },
        },
        metadata: { "agent.role": "analyzer" },
      });

      await recordEvent(session, {
        event_type: "llm_response",
        timestamp: new Date(Date.now() + 1000 + i * 300 + 200).toISOString(),
        parent_id: null,
        agent_id: "agent-b",
        payload: {
          model: "gpt-4o",
          content: `Module ${i} looks clean.`,
          usage: { prompt_tokens: 50 + i * 10, completion_tokens: 20 },
          finish_reason: "stop" as const,
        },
        metadata: { "agent.role": "analyzer" },
      });
    }

    await endSession(session);

    const events = await readTrace(tracePath);
    // 1 start + 10 agent-a + 6 agent-b + 1 end = 18
    expect(events.length).toBe(18);

    // Hash chain valid despite multiple agents
    expect(validateHashChain(events).valid).toBe(true);

    // Sequence numbers contiguous
    for (let i = 0; i < events.length; i++) {
      expect(events[i]!.sequence_num).toBe(i);
    }

    // Both agents present
    const agentIds = new Set(events.map((e) => e.agent_id));
    expect(agentIds.has("agent-a")).toBe(true);
    expect(agentIds.has("agent-b")).toBe(true);

    // Schema valid for all events
    for (const event of events) {
      expect(validateTraceEvent(event).valid).toBe(true);
    }

    // Replay passes
    expect((await verifyTrace(tracePath)).status).toBe("pass");
  });

  test("empty session: only lifecycle events", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "empty-session.trace.jsonl");

    const session = await startSession({
      agentId: "idle-agent",
      replaySeed: 1,
      outputPath: tracePath,
    });

    // No events recorded — just start and end
    await endSession(session);

    const events = await readTrace(tracePath);
    expect(events.length).toBe(2); // start + end

    expect(validateHashChain(events).valid).toBe(true);
    expect((await verifyTrace(tracePath)).status).toBe("pass");

    // Policy evaluation on empty session — should pass
    const policy = parsePolicy(ALLOW_ALL_POLICY);
    const result = evaluate(events, policy);
    expect(result.exitCode).toBe(0);
  });
});
