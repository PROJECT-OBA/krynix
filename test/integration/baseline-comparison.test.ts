/**
 * Integration smoke tests for the baseline drift comparison path.
 *
 * Full coverage lives in packages/replay/src/comparator.test.ts.
 * This file provides a minimal integration-level sanity check that
 * `compareTraces` works end-to-end from the package public API.
 */

import { describe, test, expect } from "vitest";
import { compareTraces } from "../../packages/replay/src/index.js";
import type { TraceEvent } from "../../packages/core/src/index.js";

// ---------------------------------------------------------------------------
// Minimal trace fixtures (no file I/O needed — pure in-memory)
// ---------------------------------------------------------------------------

function makeSessionStart(): TraceEvent {
  return {
    event_id: "evt-001",
    session_id: "session-abc",
    sequence_num: 0,
    timestamp: "2025-01-01T00:00:00.000Z",
    parent_id: null,
    agent_id: "agent-x",
    redacted: false,
    prev_hash: "",
    event_hash: "aaaa",
    metadata: null,
    schema_version: "1.0.0",
    event_type: "lifecycle",
    payload: { action: "session_start", context: { replay_seed: 42 } },
  } as unknown as TraceEvent;
}

function makeToolCall(): TraceEvent {
  return {
    event_id: "evt-002",
    session_id: "session-abc",
    sequence_num: 1,
    timestamp: "2025-01-01T00:00:01.000Z",
    parent_id: null,
    agent_id: "agent-x",
    redacted: false,
    prev_hash: "aaaa",
    event_hash: "bbbb",
    metadata: null,
    schema_version: "1.0.0",
    event_type: "tool_call",
    payload: { tool_name: "read_file", arguments: { path: "/tmp/test.txt" } },
  } as unknown as TraceEvent;
}

function makeSessionEnd(): TraceEvent {
  return {
    event_id: "evt-003",
    session_id: "session-abc",
    sequence_num: 2,
    timestamp: "2025-01-01T00:00:02.000Z",
    parent_id: null,
    agent_id: "agent-x",
    redacted: false,
    prev_hash: "bbbb",
    event_hash: "cccc",
    metadata: null,
    schema_version: "1.0.0",
    event_type: "lifecycle",
    payload: { action: "session_end" },
  } as unknown as TraceEvent;
}

function makeTrace(): TraceEvent[] {
  return [makeSessionStart(), makeToolCall(), makeSessionEnd()];
}

// ---------------------------------------------------------------------------
// Smoke tests (detailed coverage in packages/replay/src/comparator.test.ts)
// ---------------------------------------------------------------------------

describe("compareTraces — baseline drift comparison (smoke)", () => {
  test("identical traces produce status: pass with no divergences", () => {
    const result = compareTraces(makeTrace(), makeTrace());

    expect(result.status).toBe("pass");
    expect(result.firstDivergence).toBeUndefined();
    expect(result.totalEvents).toBe(3);
    expect(result.eventsBeforeDivergence).toBe(3);
  });

  test("changed payload field detected at correct sequence index", () => {
    const expected = makeTrace();
    const actual = makeTrace();
    (actual[1]!.payload as Record<string, unknown>)["tool_name"] = "write_file";

    const result = compareTraces(expected, actual);

    expect(result.status).toBe("diverged");
    expect(result.firstDivergence?.sequenceNum).toBe(1);
    expect(result.firstDivergence?.diffs).toContainEqual(
      expect.objectContaining({
        field: "payload.tool_name",
        expected: "read_file",
        actual: "write_file",
      }),
    );
  });
});
