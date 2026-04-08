import { describe, test, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSession,
  recordEvent,
  endSession,
  destroySession,
  getActiveSessions,
} from "./session.js";
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

  test("session_start includes environment context when provided", async () => {
    const outputPath = join(tempDir, "trace-env.jsonl");
    const environment = {
      ci_provider: "github-actions" as const,
      ci_run_id: "789",
      ci_run_url: "https://github.com/org/repo/actions/runs/789",
      git_sha: "abc123def",
      git_branch: "main",
      git_repository: "org/repo",
      extra: {},
    };

    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
      environment,
    });
    await endSession(session);

    const events = await readTrace(outputPath);
    const startEvent = events[0];
    expect(startEvent).toBeDefined();
    const payload = startEvent?.payload as {
      action: string;
      context: Record<string, unknown>;
    };
    expect(payload.action).toBe("session_start");
    const env = payload.context["environment"] as Record<string, unknown>;
    expect(env).toBeDefined();
    expect(env["ci_provider"]).toBe("github-actions");
    expect(env["git_sha"]).toBe("abc123def");
    expect(env["ci_run_id"]).toBe("789");
  });

  test("session_start omits environment when not provided", async () => {
    const outputPath = join(tempDir, "trace-noenv.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });
    await endSession(session);

    const events = await readTrace(outputPath);
    const startEvent = events[0];
    expect(startEvent).toBeDefined();
    const payload = startEvent?.payload as {
      action: string;
      context: Record<string, unknown>;
    };
    expect(payload.action).toBe("session_start");
    expect(payload.context["environment"]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // destroySession + getActiveSessions (Sprint 4 — TASK-042)
  // -------------------------------------------------------------------------

  test("getActiveSessions returns 0 initially", () => {
    // Sessions from other tests are cleaned up by endSession, so count should be 0
    // at the start of each test (prior tests call endSession).
    expect(getActiveSessions()).toBe(0);
  });

  test("getActiveSessions increments on start, decrements on end", async () => {
    const path1 = join(tempDir, "trace-a.jsonl");
    const path2 = join(tempDir, "trace-b.jsonl");

    const s1 = await startSession({ agentId: "a", replaySeed: 1, outputPath: path1 });
    expect(getActiveSessions()).toBe(1);

    const s2 = await startSession({ agentId: "b", replaySeed: 2, outputPath: path2 });
    expect(getActiveSessions()).toBe(2);

    await endSession(s1);
    expect(getActiveSessions()).toBe(1);

    await endSession(s2);
    expect(getActiveSessions()).toBe(0);
  });

  test("destroySession removes session from registry", async () => {
    const outputPath = join(tempDir, "trace-destroy.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });
    expect(getActiveSessions()).toBe(1);

    await destroySession(session);
    expect(getActiveSessions()).toBe(0);
  });

  test("destroySession is idempotent (calling twice does not throw)", async () => {
    const outputPath = join(tempDir, "trace-idempotent.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await destroySession(session);
    await destroySession(session); // second call — should not throw
    expect(getActiveSessions()).toBe(0);
  });

  test("destroySession on already-ended session is a no-op", async () => {
    const outputPath = join(tempDir, "trace-ended.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });
    await endSession(session);

    // Should not throw — session already cleaned up by endSession
    await destroySession(session);
    expect(getActiveSessions()).toBe(0);
  });

  test("recordEvent throws SESSION_CLOSED after destroySession", async () => {
    const outputPath = join(tempDir, "trace-destroy-record.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await destroySession(session);

    await expect(recordEvent(session, makePartialToolCall("file_read"))).rejects.toThrow(
      KrynixError,
    );

    try {
      await recordEvent(session, makePartialToolCall("file_read"));
    } catch (e) {
      expect((e as KrynixError).code).toBe("SESSION_CLOSED");
    }
  });

  test("endSession throws SESSION_CLOSED after destroySession", async () => {
    const outputPath = join(tempDir, "trace-destroy-end.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await destroySession(session);

    await expect(endSession(session)).rejects.toThrow(KrynixError);

    try {
      await endSession(session);
    } catch (e) {
      expect((e as KrynixError).code).toBe("SESSION_CLOSED");
    }
  });

  // -------------------------------------------------------------------------
  // validatePayloads option (Task 9)
  // -------------------------------------------------------------------------

  test("validatePayloads: false (default) allows mismatched payload", async () => {
    const outputPath = join(tempDir, "trace-no-validate.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    // tool_call payload missing required 'arguments' — should NOT throw
    await expect(
      recordEvent(session, {
        event_type: "tool_call",
        timestamp: "2025-01-15T14:00:01.000Z",
        parent_id: null,
        agent_id: "test-agent",
        payload: { tool_name: "file_read" },
        metadata: null,
      }),
    ).resolves.toBeDefined();

    await endSession(session);
  });

  test("validatePayloads: true rejects mismatched payload with INVALID_PAYLOAD", async () => {
    const outputPath = join(tempDir, "trace-validate.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
      validatePayloads: true,
    });

    // tool_call payload missing 'arguments'
    await expect(
      recordEvent(session, {
        event_type: "tool_call",
        timestamp: "2025-01-15T14:00:01.000Z",
        parent_id: null,
        agent_id: "test-agent",
        payload: { tool_name: "file_read" },
        metadata: null,
      }),
    ).rejects.toThrow(KrynixError);

    try {
      await recordEvent(session, {
        event_type: "tool_call",
        timestamp: "2025-01-15T14:00:01.000Z",
        parent_id: null,
        agent_id: "test-agent",
        payload: { tool_name: "file_read" },
        metadata: null,
      });
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_PAYLOAD");
    }

    await endSession(session);
  });

  test("validatePayloads: true accepts correct payload", async () => {
    const outputPath = join(tempDir, "trace-validate-ok.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
      validatePayloads: true,
    });

    await expect(recordEvent(session, makePartialToolCall("file_read"))).resolves.toBeDefined();

    await expect(recordEvent(session, makePartialToolResult("file_read"))).resolves.toBeDefined();

    await endSession(session);

    const events = await readTrace(outputPath);
    expect(events).toHaveLength(4); // start + 2 events + end
    expect(validateHashChain(events).valid).toBe(true);
  });

  test("getActiveSessions returns 0 after destroySession cleans up", async () => {
    const path1 = join(tempDir, "trace-d1.jsonl");
    const path2 = join(tempDir, "trace-d2.jsonl");

    const s1 = await startSession({ agentId: "a", replaySeed: 1, outputPath: path1 });
    const s2 = await startSession({ agentId: "b", replaySeed: 2, outputPath: path2 });
    expect(getActiveSessions()).toBe(2);

    await destroySession(s1);
    expect(getActiveSessions()).toBe(1);

    await destroySession(s2);
    expect(getActiveSessions()).toBe(0);
  });
});
