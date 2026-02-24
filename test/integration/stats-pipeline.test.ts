/**
 * Stats pipeline integration tests.
 *
 * End-to-end: session API → trace file → readTrace → computeTraceStats.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  computeTraceStats,
  destroySession,
  getActiveSessions,
} from "../../packages/core/src/index.js";
import type { PartialTraceEvent } from "../../packages/core/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, "../golden");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-stats-int-"));
  return async () => {
    await rm(tempDir, { recursive: true, force: true });
  };
});

function makePartial(
  eventType: string,
  payload: unknown,
  timestamp = "2025-01-15T14:00:01.000Z",
): PartialTraceEvent {
  return {
    event_type: eventType as PartialTraceEvent["event_type"],
    timestamp,
    parent_id: null,
    agent_id: "test-agent",
    payload,
    metadata: null,
  };
}

describe("Stats pipeline integration", () => {
  test("session → events → endSession → computeTraceStats → verify counts", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(session, makePartial("tool_call", {
      tool_name: "file_read",
      arguments: { path: "/tmp" },
    }));
    await recordEvent(session, makePartial("tool_result", {
      tool_name: "file_read",
      output: "ok",
      duration_ms: 10,
    }));
    await recordEvent(session, makePartial("error", {
      code: "TIMEOUT",
      message: "Request timed out",
      recoverable: true,
    }));
    await endSession(session);

    const events = await readTrace(outputPath);
    const stats = computeTraceStats(events);

    expect(stats.event_count).toBe(5); // start + 3 + end
    expect(stats.tool_call_count).toBe(1);
    expect(stats.error_count).toBe(1);
    expect(stats.llm_request_count).toBe(0);
    expect(stats.total_token_usage).toBeNull();
    expect(stats.duration_ms).not.toBeNull();
    expect(stats.event_type_counts["lifecycle"]).toBe(2);
    expect(stats.event_type_counts["tool_call"]).toBe(1);
    expect(stats.event_type_counts["tool_result"]).toBe(1);
    expect(stats.event_type_counts["error"]).toBe(1);
  });

  test("token usage summed across multiple llm_response events", async () => {
    const outputPath = join(tempDir, "trace-tokens.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 99,
      outputPath,
    });

    await recordEvent(session, makePartial("llm_request", {
      model: "gpt-4",
      messages: [],
      parameters: {},
    }));
    await recordEvent(session, makePartial("llm_response", {
      model: "gpt-4",
      content: "first",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      finish_reason: "stop",
    }));
    await recordEvent(session, makePartial("llm_request", {
      model: "gpt-4",
      messages: [],
      parameters: {},
    }));
    await recordEvent(session, makePartial("llm_response", {
      model: "gpt-4",
      content: "second",
      usage: { prompt_tokens: 200, completion_tokens: 100 },
      finish_reason: "stop",
    }));
    await endSession(session);

    const events = await readTrace(outputPath);
    const stats = computeTraceStats(events);

    expect(stats.llm_request_count).toBe(2);
    expect(stats.total_token_usage).toBe(450); // (100+50) + (200+100)
    expect(stats.event_type_counts["llm_response"]).toBe(2);
  });

  test("destroySession during active session → getActiveSessions returns 0", async () => {
    const outputPath = join(tempDir, "trace-destroy.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    expect(getActiveSessions()).toBe(1);

    await recordEvent(session, makePartial("tool_call", {
      tool_name: "file_read",
      arguments: { path: "/tmp" },
    }));

    await destroySession(session);
    expect(getActiveSessions()).toBe(0);
  });

  test("golden minimal.trace.jsonl stats match expected values", async () => {
    const events = await readTrace(resolve(GOLDEN_DIR, "minimal.trace.jsonl"));
    const stats = computeTraceStats(events);

    expect(stats.event_count).toBe(3);
    expect(stats.duration_ms).toBe(2000); // 14:00:02 - 14:00:00
    expect(stats.tool_call_count).toBe(1);
    expect(stats.llm_request_count).toBe(0);
    expect(stats.error_count).toBe(0);
    expect(stats.total_token_usage).toBeNull();
    expect(stats.event_type_counts["lifecycle"]).toBe(2);
    expect(stats.event_type_counts["tool_call"]).toBe(1);
  });

  test("golden openclaw-minimal.trace.jsonl stats match expected values", async () => {
    const events = await readTrace(resolve(GOLDEN_DIR, "openclaw-minimal.trace.jsonl"));
    const stats = computeTraceStats(events);

    expect(stats.event_count).toBe(10);
    expect(stats.duration_ms).toBe(3); // 41.917 - 41.914
    expect(stats.tool_call_count).toBe(2);
    expect(stats.llm_request_count).toBe(1);
    expect(stats.error_count).toBe(0);
    expect(stats.total_token_usage).toBe(15); // 10 + 5
    expect(stats.event_type_counts["lifecycle"]).toBe(4);
    expect(stats.event_type_counts["tool_call"]).toBe(2);
    expect(stats.event_type_counts["tool_result"]).toBe(2);
    expect(stats.event_type_counts["llm_request"]).toBe(1);
    expect(stats.event_type_counts["llm_response"]).toBe(1);
  });
});
