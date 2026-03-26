import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import { computeHashChain, validateHashChain } from "./hash-chain.js";
import { canonicalize } from "./canonical-json.js";
import { makeSessionStart, makeToolCall, makeSessionEnd, makeTraceEvent } from "./test-helpers.js";
import type { TraceEvent } from "./types.js";

/** Safely get an element from an array, throwing if out of bounds. */
function at<T>(arr: T[], index: number): T {
  const val = arr[index];
  if (val === undefined) throw new Error(`unexpected undefined at index ${index}`);
  return val;
}

describe("computeHashChain", () => {
  test("computes hashes for a 3-event chain", () => {
    const events = [makeSessionStart(), makeToolCall(1), makeSessionEnd(2)];
    const chained = computeHashChain(events);

    expect(chained).toHaveLength(3);

    const e0 = at(chained, 0);
    const e1 = at(chained, 1);
    const e2 = at(chained, 2);

    // First event: prev_hash = ""
    expect(e0.prev_hash).toBe("");
    expect(e0.event_hash).not.toBe("");

    // Second event: prev_hash = first event's hash
    expect(e1.prev_hash).toBe(e0.event_hash);
    expect(e1.event_hash).not.toBe("");

    // Third event: prev_hash = second event's hash
    expect(e2.prev_hash).toBe(e1.event_hash);
    expect(e2.event_hash).not.toBe("");
  });

  test("event_hash matches manual SHA-256 of canonical JSON", () => {
    const events = [makeSessionStart()];
    const chained = computeHashChain(events);
    const e0 = at(chained, 0);

    // Manually compute expected hash
    const withEmpty = { ...e0, event_hash: "" } as unknown as TraceEvent;
    const canonical = canonicalize(withEmpty);
    const expected = createHash("sha256").update(canonical).digest("hex");

    expect(e0.event_hash).toBe(expected);
  });

  test("single event (session_start only)", () => {
    const events = [makeSessionStart()];
    const chained = computeHashChain(events);
    const e0 = at(chained, 0);

    expect(chained).toHaveLength(1);
    expect(e0.prev_hash).toBe("");
    expect(e0.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("does not mutate original events", () => {
    const events = [makeSessionStart(), makeToolCall(1)];
    const originalHash0 = at(events, 0).event_hash;
    const originalHash1 = at(events, 1).event_hash;

    computeHashChain(events);

    expect(at(events, 0).event_hash).toBe(originalHash0);
    expect(at(events, 1).event_hash).toBe(originalHash1);
  });

  test("throws on non-contiguous sequence_num", () => {
    const events = [
      makeSessionStart(),
      makeToolCall(2), // gap: 0 → 2
    ];

    expect(() => computeHashChain(events)).toThrow("expected sequence_num 1, got 2");
  });

  test("deterministic — same input produces same hashes", () => {
    const events = [makeSessionStart(), makeToolCall(1)];
    const chain1 = computeHashChain(events);
    const chain2 = computeHashChain(events);

    expect(at(chain1, 0).event_hash).toBe(at(chain2, 0).event_hash);
    expect(at(chain1, 1).event_hash).toBe(at(chain2, 1).event_hash);
  });

  test("throws when event payload contains NaN", () => {
    const events = [makeSessionStart(), makeToolCall(1, { arguments: { value: NaN } })];
    expect(() => computeHashChain(events)).toThrow("non-finite");
  });

  test("throws when event payload contains Infinity", () => {
    const events = [makeSessionStart(), makeToolCall(1, { arguments: { value: Infinity } })];
    expect(() => computeHashChain(events)).toThrow("non-finite");
  });

  test("throws when event payload contains -Infinity", () => {
    const events = [makeSessionStart(), makeToolCall(1, { arguments: { value: -Infinity } })];
    expect(() => computeHashChain(events)).toThrow("non-finite");
  });
});

describe("validateHashChain", () => {
  test("valid 3-event chain passes", () => {
    const events = [makeSessionStart(), makeToolCall(1), makeSessionEnd(2)];
    const chained = computeHashChain(events);

    const result = validateHashChain(chained);
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeUndefined();
  });

  test("tampered payload detected at correct index", () => {
    const events = [makeSessionStart(), makeToolCall(1), makeSessionEnd(2)];
    const chained = computeHashChain(events);

    // Tamper with event 1's payload
    const tampered: TraceEvent[] = [
      at(chained, 0),
      {
        ...at(chained, 1),
        payload: { tool_name: "TAMPERED", arguments: {} },
      } as unknown as TraceEvent,
      at(chained, 2),
    ];

    const result = validateHashChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  test("tampered prev_hash detected", () => {
    const events = [makeSessionStart(), makeToolCall(1)];
    const chained = computeHashChain(events);

    const tampered: TraceEvent[] = [
      at(chained, 0),
      { ...at(chained, 1), prev_hash: "0000000000000000" } as unknown as TraceEvent,
    ];

    const result = validateHashChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.error).toContain("prev_hash mismatch");
  });

  test("empty event list is valid", () => {
    const result = validateHashChain([]);
    expect(result.valid).toBe(true);
  });

  test("single valid event passes", () => {
    const events = [makeSessionStart()];
    const chained = computeHashChain(events);

    const result = validateHashChain(chained);
    expect(result.valid).toBe(true);
  });

  test("compute then validate round-trip succeeds for all event types", () => {
    const events = [
      makeTraceEvent("lifecycle", 0),
      makeTraceEvent("tool_call", 1),
      makeTraceEvent("tool_result", 2),
      makeTraceEvent("llm_request", 3),
      makeTraceEvent("llm_response", 4),
      makeTraceEvent("decision", 5),
      makeTraceEvent("observation", 6),
      makeTraceEvent("error", 7),
    ];
    const chained = computeHashChain(events);
    const result = validateHashChain(chained);

    expect(result.valid).toBe(true);
  });
});
