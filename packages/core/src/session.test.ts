import { describe, test, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSession, recordEvent, endSession } from "./session.js";
import type { PartialTraceEvent } from "./session.js";
import { readTrace } from "./trace-reader.js";
import { validateHashChain } from "./hash-chain.js";
import { KrynixError } from "./errors.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-session-test-"));
  return async () => {
    await rm(tempDir, { recursive: true, force: true });
  };
});

function makePartialToolCall(toolName: string): PartialTraceEvent {
  return {
    event_type: "tool_call",
    timestamp: "2025-01-15T14:00:01.000Z",
    parent_id: null,
    agent_id: "test-agent",
    payload: { tool_name: toolName, arguments: { path: "/tmp/test.txt" } },
    metadata: null,
  };
}

function makePartialToolResult(toolName: string): PartialTraceEvent {
  return {
    event_type: "tool_result",
    timestamp: "2025-01-15T14:00:02.000Z",
    parent_id: null,
    agent_id: "test-agent",
    payload: { tool_name: toolName, output: "ok", duration_ms: 10 },
    metadata: null,
  };
}

describe("Session Manager", () => {
  test("full lifecycle: start → record 3 events → end; hash chain validates", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(session, makePartialToolCall("file_read"));
    await recordEvent(session, makePartialToolResult("file_read"));
    await recordEvent(session, makePartialToolCall("shell_exec"));
    await endSession(session);

    const events = await readTrace(outputPath);
    expect(events).toHaveLength(5); // session_start + 3 events + session_end

    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
  });

  test("deterministic event_ids: same seed produces same sequence", async () => {
    const path1 = join(tempDir, "trace1.jsonl");
    const path2 = join(tempDir, "trace2.jsonl");

    const session1 = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath: path1,
    });
    const event1 = await recordEvent(session1, makePartialToolCall("file_read"));
    await endSession(session1);

    const session2 = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath: path2,
    });
    const event2 = await recordEvent(session2, makePartialToolCall("file_read"));
    await endSession(session2);

    expect(session1.sessionId).toBe(session2.sessionId);
    expect(event1.event_id).toBe(event2.event_id);
  });

  test("sequence_num: session_start=0, first record=1, second=2", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(session, makePartialToolCall("file_read"));
    await recordEvent(session, makePartialToolResult("file_read"));
    await endSession(session);

    const events = await readTrace(outputPath);
    expect(events[0]?.sequence_num).toBe(0); // session_start
    expect(events[1]?.sequence_num).toBe(1); // first record
    expect(events[2]?.sequence_num).toBe(2); // second record
    expect(events[3]?.sequence_num).toBe(3); // session_end
  });

  test("redaction: event with api_key in payload is redacted", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(session, {
      event_type: "tool_call",
      timestamp: "2025-01-15T14:00:01.000Z",
      parent_id: null,
      agent_id: "test-agent",
      payload: {
        tool_name: "api_call",
        arguments: { api_key: "sk-secret-123", url: "https://example.com" },
      },
      metadata: null,
    });
    await endSession(session);

    const events = await readTrace(outputPath);
    const toolCall = events[1];
    expect(toolCall).toBeDefined();
    expect(toolCall?.redacted).toBe(true);
    const args = (toolCall?.payload as { arguments: Record<string, unknown> }).arguments;
    expect(args.api_key).toMatch(/^\[REDACTED:[0-9a-f]{8}\]$/);
    expect(args.url).toBe("https://example.com");
  });

  test("all events share the same session_id", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(session, makePartialToolCall("file_read"));
    await endSession(session);

    const events = await readTrace(outputPath);
    for (const event of events) {
      expect(event.session_id).toBe(session.sessionId);
    }
  });

  test("recordEvent after endSession throws SESSION_CLOSED", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });
    await endSession(session);

    await expect(recordEvent(session, makePartialToolCall("file_read"))).rejects.toThrow(
      KrynixError,
    );

    try {
      await recordEvent(session, makePartialToolCall("file_read"));
    } catch (e) {
      expect((e as KrynixError).code).toBe("SESSION_CLOSED");
    }
  });

  test("endSession twice throws SESSION_CLOSED", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });
    await endSession(session);

    await expect(endSession(session)).rejects.toThrow(KrynixError);

    try {
      await endSession(session);
    } catch (e) {
      expect((e as KrynixError).code).toBe("SESSION_CLOSED");
    }
  });

  test("session without replaySeed works (non-deterministic)", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      outputPath,
    });

    expect(session.replaySeed).toBeGreaterThan(0);

    await recordEvent(session, makePartialToolCall("file_read"));
    await endSession(session);

    const events = await readTrace(outputPath);
    expect(events).toHaveLength(3);
    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
  });

  test("minimal session: start and end with no recorded events", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });
    await endSession(session);

    const events = await readTrace(outputPath);
    expect(events).toHaveLength(2); // session_start + session_end
    expect(events[0]?.event_type).toBe("lifecycle");
    expect(events[1]?.event_type).toBe("lifecycle");

    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
  });

  test("concurrent sessions with different seeds produce independent traces", async () => {
    const path1 = join(tempDir, "trace1.jsonl");
    const path2 = join(tempDir, "trace2.jsonl");

    const session1 = await startSession({
      agentId: "agent-1",
      replaySeed: 42,
      outputPath: path1,
    });
    const session2 = await startSession({
      agentId: "agent-2",
      replaySeed: 99,
      outputPath: path2,
    });

    await recordEvent(session1, makePartialToolCall("file_read"));
    await recordEvent(session2, makePartialToolCall("shell_exec"));
    await endSession(session1);
    await endSession(session2);

    const events1 = await readTrace(path1);
    const events2 = await readTrace(path2);

    expect(events1[0]?.session_id).not.toBe(events2[0]?.session_id);
    expect(events1[0]?.agent_id).toBe("agent-1");
    expect(events2[0]?.agent_id).toBe("agent-2");

    expect(validateHashChain(events1).valid).toBe(true);
    expect(validateHashChain(events2).valid).toBe(true);
  });

  test("session metadata appears in session_start context", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
      metadata: { agent_version: "0.5.0", custom_field: "hello" },
    });
    await endSession(session);

    const events = await readTrace(outputPath);
    const startEvent = events[0];
    expect(startEvent).toBeDefined();
    const payload = startEvent?.payload as { action: string; context: Record<string, unknown> };
    expect(payload.action).toBe("session_start");
    expect(payload.context["replay_seed"]).toBe(42);
    expect(payload.context["agent_version"]).toBe("0.5.0");
    expect(payload.context["custom_field"]).toBe("hello");
  });
});
