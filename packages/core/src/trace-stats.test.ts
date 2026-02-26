import { describe, test, expect } from "vitest";
import { computeTraceStats } from "./trace-stats.js";
import type { TraceEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers — minimal TraceEvent factory
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<TraceEvent> & { event_type: TraceEvent["event_type"]; payload: unknown },
): TraceEvent {
  return {
    event_id: "evt-1",
    session_id: "sess-1",
    sequence_num: 0,
    timestamp: "2025-01-15T14:00:00.000Z",
    parent_id: null,
    agent_id: "agent-1",
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: "1.0.0",
    ...overrides,
  } as TraceEvent;
}

function makeLifecycle(action: "session_start" | "session_end", timestamp: string): TraceEvent {
  return makeEvent({
    event_type: "lifecycle",
    timestamp,
    payload: { action, context: { replay_seed: 42 } },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeTraceStats", () => {
  test("returns zeroed stats for an empty trace", () => {
    const stats = computeTraceStats([]);

    expect(stats.event_count).toBe(0);
    expect(stats.duration_ms).toBeNull();
    expect(stats.tool_call_count).toBe(0);
    expect(stats.llm_request_count).toBe(0);
    expect(stats.error_count).toBe(0);
    expect(stats.total_token_usage).toBeNull();
    expect(stats.event_type_counts["tool_call"]).toBe(0);
    expect(stats.event_type_counts["lifecycle"]).toBe(0);
  });

  test("computes duration and counts for minimal session (start + end)", () => {
    const trace = [
      makeLifecycle("session_start", "2025-01-15T14:00:00.000Z"),
      makeLifecycle("session_end", "2025-01-15T14:00:05.000Z"),
    ];

    const stats = computeTraceStats(trace);

    expect(stats.event_count).toBe(2);
    expect(stats.duration_ms).toBe(5000);
    expect(stats.event_type_counts["lifecycle"]).toBe(2);
  });

  test("counts tool_call events", () => {
    const trace = [
      makeLifecycle("session_start", "2025-01-15T14:00:00.000Z"),
      makeEvent({
        event_type: "tool_call",
        payload: { tool_name: "file_read", arguments: { path: "/tmp" } },
      }),
      makeEvent({
        event_type: "tool_call",
        payload: { tool_name: "file_write", arguments: { path: "/tmp" } },
      }),
      makeLifecycle("session_end", "2025-01-15T14:00:01.000Z"),
    ];

    const stats = computeTraceStats(trace);
    expect(stats.tool_call_count).toBe(2);
  });

  test("counts llm_request events", () => {
    const trace = [
      makeLifecycle("session_start", "2025-01-15T14:00:00.000Z"),
      makeEvent({
        event_type: "llm_request",
        payload: { model: "gpt-4", messages: [], parameters: {} },
      }),
      makeEvent({
        event_type: "llm_request",
        payload: { model: "gpt-4", messages: [], parameters: {} },
      }),
      makeEvent({
        event_type: "llm_request",
        payload: { model: "gpt-4", messages: [], parameters: {} },
      }),
      makeLifecycle("session_end", "2025-01-15T14:00:01.000Z"),
    ];

    const stats = computeTraceStats(trace);
    expect(stats.llm_request_count).toBe(3);
  });

  test("sums token usage from llm_response events", () => {
    const trace = [
      makeLifecycle("session_start", "2025-01-15T14:00:00.000Z"),
      makeEvent({
        event_type: "llm_response",
        payload: {
          model: "gpt-4",
          content: "hello",
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          finish_reason: "stop",
        },
      }),
      makeLifecycle("session_end", "2025-01-15T14:00:01.000Z"),
    ];

    const stats = computeTraceStats(trace);
    expect(stats.total_token_usage).toBe(150);
  });

  test("counts error events", () => {
    const trace = [
      makeLifecycle("session_start", "2025-01-15T14:00:00.000Z"),
      makeEvent({
        event_type: "error",
        payload: { code: "TIMEOUT", message: "Request timed out", recoverable: true },
      }),
      makeEvent({
        event_type: "error",
        payload: { code: "PARSE_FAIL", message: "Invalid JSON", recoverable: false },
      }),
      makeLifecycle("session_end", "2025-01-15T14:00:01.000Z"),
    ];

    const stats = computeTraceStats(trace);
    expect(stats.error_count).toBe(2);
  });

  test("populates event_type_counts for all 8 types with mixed events", () => {
    const trace = [
      makeLifecycle("session_start", "2025-01-15T14:00:00.000Z"),
      makeEvent({
        event_type: "tool_call",
        payload: { tool_name: "f", arguments: {} },
      }),
      makeEvent({
        event_type: "tool_result",
        payload: { tool_name: "f", output: "ok", duration_ms: 10 },
      }),
      makeEvent({
        event_type: "llm_request",
        payload: { model: "m", messages: [], parameters: {} },
      }),
      makeEvent({
        event_type: "llm_response",
        payload: {
          model: "m",
          content: "hi",
          usage: { prompt_tokens: 10, completion_tokens: 5 },
          finish_reason: "stop",
        },
      }),
      makeEvent({
        event_type: "decision",
        payload: { action: "proceed", reasoning: "looks good" },
      }),
      makeEvent({
        event_type: "observation",
        payload: { source: "env", content: {} },
      }),
      makeEvent({
        event_type: "error",
        payload: { code: "E", message: "err", recoverable: true },
      }),
      makeLifecycle("session_end", "2025-01-15T14:00:01.000Z"),
    ];

    const stats = computeTraceStats(trace);

    expect(stats.event_type_counts["lifecycle"]).toBe(2);
    expect(stats.event_type_counts["tool_call"]).toBe(1);
    expect(stats.event_type_counts["tool_result"]).toBe(1);
    expect(stats.event_type_counts["llm_request"]).toBe(1);
    expect(stats.event_type_counts["llm_response"]).toBe(1);
    expect(stats.event_type_counts["decision"]).toBe(1);
    expect(stats.event_type_counts["observation"]).toBe(1);
    expect(stats.event_type_counts["error"]).toBe(1);
    expect(stats.event_count).toBe(9);
  });

  test("returns null duration_ms when session_end is missing", () => {
    const trace = [makeLifecycle("session_start", "2025-01-15T14:00:00.000Z")];

    const stats = computeTraceStats(trace);
    expect(stats.duration_ms).toBeNull();
  });

  test("returns null duration_ms when session_start is missing", () => {
    const trace = [makeLifecycle("session_end", "2025-01-15T14:00:05.000Z")];

    const stats = computeTraceStats(trace);
    expect(stats.duration_ms).toBeNull();
  });

  test("invalid lifecycle timestamps produce null duration_ms", () => {
    const trace = [
      makeLifecycle("session_start", "not-a-date"),
      makeLifecycle("session_end", "also-not-a-date"),
    ];

    const stats = computeTraceStats(trace);
    // Should return null, not NaN, for invalid timestamps
    expect(stats.duration_ms).toBeNull();
  });

  test("sums token usage across multiple llm_response events", () => {
    const trace = [
      makeLifecycle("session_start", "2025-01-15T14:00:00.000Z"),
      makeEvent({
        event_type: "llm_response",
        payload: {
          model: "gpt-4",
          content: "a",
          usage: { prompt_tokens: 100, completion_tokens: 50 },
          finish_reason: "stop",
        },
      }),
      makeEvent({
        event_type: "llm_response",
        payload: {
          model: "gpt-4",
          content: "b",
          usage: { prompt_tokens: 200, completion_tokens: 100 },
          finish_reason: "stop",
        },
      }),
      makeEvent({
        event_type: "llm_response",
        payload: {
          model: "gpt-4",
          content: "c",
          usage: { prompt_tokens: 50, completion_tokens: 25 },
          finish_reason: "stop",
        },
      }),
      makeLifecycle("session_end", "2025-01-15T14:00:01.000Z"),
    ];

    const stats = computeTraceStats(trace);
    expect(stats.total_token_usage).toBe(525); // (100+50) + (200+100) + (50+25)
  });
});
