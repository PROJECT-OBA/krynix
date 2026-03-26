import { describe, test, expect } from "vitest";
import { compareTraces } from "./comparator.js";
import type { TraceEvent } from "@krynix/core";
import type { DivergencePoint } from "./types.js";

function makeEvent(
  seq: number,
  eventType: string,
  payload: unknown,
  overrides?: Partial<TraceEvent>,
): TraceEvent {
  return {
    event_id: `e${String(seq)}`,
    session_id: "s1",
    sequence_num: seq,
    timestamp: `2025-01-15T14:00:${String(seq).padStart(2, "0")}.000Z`,
    event_type: eventType,
    parent_id: null,
    agent_id: "test-agent",
    payload,
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: "1.0.0",
    ...overrides,
  } as TraceEvent;
}

/** Type-safe helper: asserts a value is defined and returns it. */
function defined<T>(val: T | undefined): T {
  expect(val).toBeDefined();
  return val as T;
}

describe("compareTraces", () => {
  test("identical 3-event traces → pass", () => {
    const events: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
      makeEvent(2, "lifecycle", { action: "session_end" }),
    ];

    const result = compareTraces(events, events);

    expect(result.status).toBe("pass");
    expect(result.totalEvents).toBe(3);
    expect(result.eventsBeforeDivergence).toBe(3);
    expect(result.firstDivergence).toBeUndefined();
  });

  test("different event_type at index 2 → divergence at seq 2", () => {
    const expected: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
      makeEvent(2, "tool_result", { tool_name: "file_read", output: "ok", duration_ms: 10 }),
    ];
    const actual: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
      makeEvent(2, "decision", { action: "proceed", reasoning: "looks good" }),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(2);
    expect(result.eventsBeforeDivergence).toBe(2);
    expect(div.diffs.some((d) => d.field === "event_type")).toBe(true);
  });

  test("same event_type, different payload field at index 1 → divergence with field diff", () => {
    const expected: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
    ];
    const actual: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "shell_exec", arguments: { path: "/tmp" } }),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(1);
    expect(div.diffs.some((d) => d.field === "payload.tool_name")).toBe(true);
  });

  test("expected longer than actual → divergence at actual.length", () => {
    const expected: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: {} }),
      makeEvent(2, "lifecycle", { action: "session_end" }),
    ];
    const actual: TraceEvent[] = [makeEvent(0, "lifecycle", { action: "session_start" })];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(1);
    expect(div.diffs.some((d) => d.field === "length")).toBe(true);
    expect(div.diffs[0]?.expected).toBe(3);
    expect(div.diffs[0]?.actual).toBe(1);
  });

  test("actual longer than expected → divergence at expected.length", () => {
    const expected: TraceEvent[] = [makeEvent(0, "lifecycle", { action: "session_start" })];
    const actual: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: {} }),
      makeEvent(2, "lifecycle", { action: "session_end" }),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(1);
    expect(div.diffs.some((d) => d.field === "length")).toBe(true);
    expect(div.diffs[0]?.expected).toBe(1);
    expect(div.diffs[0]?.actual).toBe(3);
  });

  test("both empty → pass", () => {
    const result = compareTraces([], []);

    expect(result.status).toBe("pass");
    expect(result.totalEvents).toBe(0);
    expect(result.eventsBeforeDivergence).toBe(0);
  });

  test("one empty, one non-empty → diverge at 0", () => {
    const events: TraceEvent[] = [makeEvent(0, "lifecycle", { action: "session_start" })];

    const result = compareTraces(events, []);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(0);
    expect(div.expected.eventType).toBe("lifecycle");
    expect(div.actual.eventType).toBe("<missing>");
  });

  test("deep payload diff: nested arguments.path → diff reports payload.arguments.path", () => {
    const expected: TraceEvent[] = [
      makeEvent(0, "tool_call", {
        tool_name: "file_read",
        arguments: { path: "/src/index.ts", recursive: true },
      }),
    ];
    const actual: TraceEvent[] = [
      makeEvent(0, "tool_call", {
        tool_name: "file_read",
        arguments: { path: "/src/main.ts", recursive: true },
      }),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(div.diffs.some((d) => d.field === "payload.arguments.path")).toBe(true);
    const pathDiff = defined(div.diffs.find((d) => d.field === "payload.arguments.path"));
    expect(pathDiff.expected).toBe("/src/index.ts");
    expect(pathDiff.actual).toBe("/src/main.ts");
  });

  test("multiple fields differ → all diffs reported", () => {
    const expected: TraceEvent[] = [
      makeEvent(0, "tool_call", { tool_name: "file_read", arguments: { path: "/a" } }),
    ];
    const actual: TraceEvent[] = [
      makeEvent(
        0,
        "tool_call",
        { tool_name: "shell_exec", arguments: { cmd: "ls" } },
        { agent_id: "other-agent" },
      ),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.diffs.some((d) => d.field === "agent_id")).toBe(true);
    expect(div.diffs.some((d) => d.field === "payload.tool_name")).toBe(true);
    expect(div.diffs.length).toBeGreaterThanOrEqual(3);
  });

  test("divergence at first event (index 0) → correctly reported", () => {
    const expected: TraceEvent[] = [makeEvent(0, "lifecycle", { action: "session_start" })];
    const actual: TraceEvent[] = [
      makeEvent(0, "tool_call", { tool_name: "file_read", arguments: {} }),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(0);
    expect(result.eventsBeforeDivergence).toBe(0);
    expect(div.expected.eventType).toBe("lifecycle");
    expect(div.actual.eventType).toBe("tool_call");
  });

  test("agent_id-only change detected as divergence", () => {
    const expected: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
    ];
    const actual: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }, { agent_id: "other-agent" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(0);
    expect(div.diffs).toContainEqual(
      expect.objectContaining({
        field: "agent_id",
        expected: "test-agent",
        actual: "other-agent",
      }),
    );
  });

  test("divergence at last event → eventsBeforeDivergence correct", () => {
    const expected: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
      makeEvent(2, "tool_result", { tool_name: "file_read", output: "ok", duration_ms: 10 }),
      makeEvent(3, "lifecycle", { action: "session_end" }),
    ];
    const actual: TraceEvent[] = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "file_read", arguments: { path: "/tmp" } }),
      makeEvent(2, "tool_result", { tool_name: "file_read", output: "ok", duration_ms: 10 }),
      makeEvent(3, "lifecycle", { action: "checkpoint" }),
    ];

    const result = compareTraces(expected, actual);
    const div = defined<DivergencePoint>(result.firstDivergence);

    expect(result.status).toBe("diverged");
    expect(div.sequenceNum).toBe(3);
    expect(result.eventsBeforeDivergence).toBe(3);
    expect(result.totalEvents).toBe(4);
  });
});
