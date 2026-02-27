import { describe, test, expect } from "vitest";
import { filterTraceEvents, matchFieldGlob } from "./trace-filter.js";
import type { TraceEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE = {
  event_id: "evt-000",
  session_id: "session-1",
  sequence_num: 0,
  timestamp: "2025-01-15T14:00:00.000Z",
  parent_id: null,
  agent_id: "agent-1",
  redacted: false,
  prev_hash: "",
  event_hash: "",
  metadata: null,
  schema_version: "1.0.0",
} as const;

function makeEvent(overrides: Partial<TraceEvent>): TraceEvent {
  return { ...BASE, ...overrides } as unknown as TraceEvent;
}

function makeTestEvents(): TraceEvent[] {
  return [
    makeEvent({
      event_id: "evt-001",
      sequence_num: 0,
      event_type: "lifecycle",
      agent_id: "agent-1",
      session_id: "session-1",
      timestamp: "2025-01-15T14:00:00.000Z",
      payload: { action: "session_start" },
    }),
    makeEvent({
      event_id: "evt-002",
      sequence_num: 1,
      event_type: "tool_call",
      agent_id: "agent-1",
      session_id: "session-1",
      timestamp: "2025-01-15T14:01:00.000Z",
      payload: { tool_name: "file_read", arguments: { path: "/tmp/a" } },
    }),
    makeEvent({
      event_id: "evt-003",
      sequence_num: 2,
      event_type: "llm_request",
      agent_id: "agent-2",
      session_id: "session-1",
      timestamp: "2025-01-15T14:02:00.000Z",
      payload: { model: "gpt-4", messages: [], parameters: {} },
    }),
    makeEvent({
      event_id: "evt-004",
      sequence_num: 3,
      event_type: "tool_call",
      agent_id: "agent-2",
      session_id: "session-2",
      timestamp: "2025-01-15T14:03:00.000Z",
      payload: { tool_name: "bash", arguments: { cmd: "ls" } },
    }),
    makeEvent({
      event_id: "evt-005",
      sequence_num: 4,
      event_type: "lifecycle",
      agent_id: "agent-1",
      session_id: "session-1",
      timestamp: "2025-01-15T14:04:00.000Z",
      payload: { action: "session_end" },
    }),
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("filterTraceEvents", () => {
  test("returns all events when criteria is empty", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {});
    expect(result).toHaveLength(5);
    expect(result.map((e) => e.event_id)).toEqual([
      "evt-001",
      "evt-002",
      "evt-003",
      "evt-004",
      "evt-005",
    ]);
  });

  test("returns all events when no criteria argument provided", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events);
    expect(result).toHaveLength(5);
  });

  test("filters by single event_type", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, { event_types: ["tool_call"] });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.event_type === "tool_call")).toBe(true);
  });

  test("filters by multiple event_types", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      event_types: ["tool_call", "llm_request"],
    });
    expect(result).toHaveLength(3);
  });

  test("filters by agent_id", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, { agent_ids: ["agent-2"] });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.agent_id === "agent-2")).toBe(true);
  });

  test("filters by multiple agent_ids", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      agent_ids: ["agent-1", "agent-2"],
    });
    expect(result).toHaveLength(5);
  });

  test("filters by session_id", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, { session_ids: ["session-2"] });
    expect(result).toHaveLength(1);
    expect(result[0]?.event_id).toBe("evt-004");
  });

  test("filters by after timestamp (inclusive)", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      after: "2025-01-15T14:03:00.000Z",
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.event_id)).toEqual(["evt-004", "evt-005"]);
  });

  test("filters by before timestamp (inclusive)", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      before: "2025-01-15T14:01:00.000Z",
    });
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.event_id)).toEqual(["evt-001", "evt-002"]);
  });

  test("filters by time range (after + before)", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      after: "2025-01-15T14:01:00.000Z",
      before: "2025-01-15T14:03:00.000Z",
    });
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.event_id)).toEqual(["evt-002", "evt-003", "evt-004"]);
  });

  test("AND logic: event_type + agent_id combined", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      event_types: ["tool_call"],
      agent_ids: ["agent-2"],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.event_id).toBe("evt-004");
  });

  test("AND logic: all criteria combined", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      event_types: ["tool_call"],
      agent_ids: ["agent-1"],
      session_ids: ["session-1"],
      after: "2025-01-15T14:00:30.000Z",
      before: "2025-01-15T14:02:00.000Z",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.event_id).toBe("evt-002");
  });

  test("throws on unparseable after date", () => {
    const events = makeTestEvents();
    expect(() => filterTraceEvents(events, { after: "not-a-date" })).toThrow(
      "Invalid 'after' date",
    );
  });

  test("throws on unparseable before date", () => {
    const events = makeTestEvents();
    expect(() => filterTraceEvents(events, { before: "garbage" })).toThrow("Invalid 'before' date");
  });

  test("preserves original event ordering", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, { event_types: ["lifecycle"] });
    expect(result.map((e) => e.event_id)).toEqual(["evt-001", "evt-005"]);
  });

  test("returns empty array when nothing matches", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      event_types: ["observation"],
    });
    expect(result).toEqual([]);
  });

  test("does not mutate input array", () => {
    const events = makeTestEvents();
    const original = [...events];
    filterTraceEvents(events, { event_types: ["tool_call"] });
    expect(events).toEqual(original);
    expect(events).toHaveLength(5);
  });

  test("returns empty array for empty input", () => {
    const result = filterTraceEvents([], { event_types: ["tool_call"] });
    expect(result).toEqual([]);
  });

  test("after > before returns empty (valid empty window)", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      after: "2025-01-15T15:00:00.000Z",
      before: "2025-01-15T13:00:00.000Z",
    });
    expect(result).toEqual([]);
  });

  test("excludes events with invalid timestamps when time filter is active", () => {
    const events = makeTestEvents();
    const base = events[0];
    if (base === undefined) throw new Error("expected at least one event");
    // Inject an event with an unparseable timestamp
    const badEvent = {
      ...base,
      event_id: "evt-bad",
      timestamp: "not-a-date",
    } as unknown as TraceEvent;
    const withBad = [...events, badEvent];

    const result = filterTraceEvents(withBad, {
      after: "2025-01-15T13:00:00.000Z",
    });

    // The bad event should be excluded (NaN timestamp)
    expect(result.find((e) => e.event_id === "evt-bad")).toBeUndefined();
    // Valid events within range should still be included
    expect(result.length).toBe(5);
  });

  test("includes events with invalid timestamps when no time filter is active", () => {
    const events = makeTestEvents();
    const base = events[0];
    if (base === undefined) throw new Error("expected at least one event");
    const badEvent = {
      ...base,
      event_id: "evt-bad",
      timestamp: "not-a-date",
    } as unknown as TraceEvent;
    const withBad = [...events, badEvent];

    // Non-time filter should include the bad-timestamp event
    const result = filterTraceEvents(withBad, { event_types: ["lifecycle"] });
    expect(result.find((e) => e.event_id === "evt-bad")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Field-level filtering tests
// ---------------------------------------------------------------------------

describe("matchFieldGlob", () => {
  test("exact match", () => {
    expect(matchFieldGlob("tool_name", "tool_name")).toBe(true);
    expect(matchFieldGlob("tool_name", "arguments")).toBe(false);
  });

  test("parent pattern matches child path", () => {
    expect(matchFieldGlob("arguments", "arguments.path")).toBe(true);
    expect(matchFieldGlob("arguments", "arguments.nested.deep")).toBe(true);
  });

  test("* matches single segment", () => {
    expect(matchFieldGlob("arguments.*", "arguments.path")).toBe(true);
    expect(matchFieldGlob("arguments.*", "arguments.nested.deep")).toBe(false);
    expect(matchFieldGlob("*", "tool_name")).toBe(true);
    expect(matchFieldGlob("*.path", "arguments.path")).toBe(true);
  });

  test("** matches any depth", () => {
    expect(matchFieldGlob("usage.**", "usage.tokens")).toBe(true);
    expect(matchFieldGlob("usage.**", "usage.nested.deep")).toBe(true);
    expect(matchFieldGlob("**", "any.path.at.all")).toBe(true);
  });

  test("mixed pattern", () => {
    expect(matchFieldGlob("a.*.c", "a.b.c")).toBe(true);
    expect(matchFieldGlob("a.*.c", "a.b.d")).toBe(false);
    expect(matchFieldGlob("a.*.c", "a.b.x.c")).toBe(false);
  });

  test("no match when path is shorter than pattern", () => {
    expect(matchFieldGlob("a.b.c", "a.b")).toBe(false);
  });
});

describe("filterTraceEvents — field-level filtering", () => {
  test("include_fields keeps only matching payload fields", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      event_types: ["tool_call"],
      include_fields: ["tool_name"],
    });

    expect(result).toHaveLength(2);
    for (const e of result) {
      const payload = e.payload as unknown as Record<string, unknown>;
      expect(payload).toHaveProperty("tool_name");
      expect(payload).not.toHaveProperty("arguments");
    }
  });

  test("exclude_fields removes matching payload fields", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      event_types: ["tool_call"],
      exclude_fields: ["arguments"],
    });

    expect(result).toHaveLength(2);
    for (const e of result) {
      const payload = e.payload as unknown as Record<string, unknown>;
      expect(payload).toHaveProperty("tool_name");
      expect(payload).not.toHaveProperty("arguments");
    }
  });

  test("include_fields with glob pattern", () => {
    const events = makeTestEvents();
    const result = filterTraceEvents(events, {
      event_types: ["tool_call"],
      include_fields: ["arguments.*"],
    });

    expect(result).toHaveLength(2);
    for (const e of result) {
      const payload = e.payload as unknown as Record<string, unknown>;
      expect(payload).not.toHaveProperty("tool_name");
      expect(payload).toHaveProperty("arguments");
    }
  });

  test("exclude_fields with ** glob removes nested fields", () => {
    const event = makeEvent({
      event_type: "tool_call",
      payload: {
        tool_name: "test",
        arguments: { path: "/tmp", opts: { recursive: true } },
      },
    });

    const result = filterTraceEvents([event], {
      exclude_fields: ["arguments.**"],
    });

    const payload = result[0]?.payload as unknown as Record<string, unknown>;
    expect(payload).toHaveProperty("tool_name", "test");
    expect(payload).not.toHaveProperty("arguments");
  });

  test("include_fields and exclude_fields combined", () => {
    const event = makeEvent({
      event_type: "tool_call",
      payload: {
        tool_name: "file_write",
        arguments: { path: "/tmp/a", content: "secret" },
      },
    });

    const result = filterTraceEvents([event], {
      include_fields: ["tool_name", "arguments"],
      exclude_fields: ["arguments.content"],
    });

    const payload = result[0]?.payload as unknown as Record<string, unknown>;
    expect(payload).toHaveProperty("tool_name", "file_write");
    const args = payload["arguments"] as Record<string, unknown>;
    expect(args).toHaveProperty("path", "/tmp/a");
    expect(args).not.toHaveProperty("content");
  });

  test("field filtering does not mutate original events", () => {
    const events = makeTestEvents();
    const original = JSON.parse(JSON.stringify(events)) as TraceEvent[];

    filterTraceEvents(events, {
      event_types: ["tool_call"],
      include_fields: ["tool_name"],
    });

    expect(events).toEqual(original);
  });

  test("field filtering skips events with null payload", () => {
    const event = {
      ...BASE,
      event_type: "lifecycle" as const,
      payload: null,
    } as unknown as TraceEvent;

    const result = filterTraceEvents([event], {
      include_fields: ["tool_name"],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.payload).toBeNull();
  });
});
