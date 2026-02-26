/**
 * Tests for StreamingHashValidator.
 */

import { describe, test, expect } from "vitest";
import { StreamingHashValidator } from "./streaming-validator.js";
import { computeHashChain } from "./hash-chain.js";
import { TraceWriter } from "./trace-writer.js";
import { makeSessionStart, makeToolCall, makeSessionEnd } from "./test-helpers.js";
import type { TraceEvent } from "./types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a valid hash-chained trace. */
function chainedTrace(): TraceEvent[] {
  return computeHashChain([
    makeSessionStart({ sequence_num: 0 }),
    makeToolCall(1),
    makeSessionEnd(2),
  ]);
}

describe("StreamingHashValidator", () => {
  test("valid 3-event chain: all validate successfully", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    for (const event of events) {
      const result = validator.validate(event);
      expect(result.valid).toBe(true);
    }
    expect(validator.eventsValidated).toBe(3);
  });

  test("tampered event_hash: validation fails at that event", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    // Tamper with event 1's hash
    const tampered = { ...events[1], event_hash: "deadbeef" } as unknown as TraceEvent;

    expect(validator.validate(events[0] as TraceEvent).valid).toBe(true);
    const result = validator.validate(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.error).toContain("event_hash mismatch");
  });

  test("tampered prev_hash: validation fails at that event", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    // Tamper with event 1's prev_hash
    const tampered = { ...events[1], prev_hash: "wrong" } as unknown as TraceEvent;

    expect(validator.validate(events[0] as TraceEvent).valid).toBe(true);
    const result = validator.validate(tampered);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.error).toContain("prev_hash mismatch");
  });

  test("out-of-order sequence_num: validation error", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    // Feed event 0 then event 2 (skipping event 1)
    expect(validator.validate(events[0] as TraceEvent).valid).toBe(true);
    const result = validator.validate(events[2] as TraceEvent);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.error).toContain("sequence_num mismatch");
  });

  test("eventsValidated increments correctly", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    expect(validator.eventsValidated).toBe(0);
    validator.validate(events[0] as TraceEvent);
    expect(validator.eventsValidated).toBe(1);
    validator.validate(events[1] as TraceEvent);
    expect(validator.eventsValidated).toBe(2);
    validator.validate(events[2] as TraceEvent);
    expect(validator.eventsValidated).toBe(3);
  });

  test("currentHash matches last event hash after validation", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    for (const event of events) {
      validator.validate(event);
    }
    expect(validator.currentHash).toBe(events[2]?.event_hash);
  });

  test("reset clears state, allows revalidation", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    for (const event of events) {
      validator.validate(event);
    }
    expect(validator.eventsValidated).toBe(3);

    validator.reset();
    expect(validator.eventsValidated).toBe(0);
    expect(validator.currentHash).toBe("");

    // Can re-validate the same trace
    for (const event of events) {
      const result = validator.validate(event);
      expect(result.valid).toBe(true);
    }
  });

  test("empty use: currentHash is empty, eventsValidated is 0", () => {
    const validator = new StreamingHashValidator();
    expect(validator.currentHash).toBe("");
    expect(validator.eventsValidated).toBe(0);
  });

  test("single event with prev_hash empty string validates correctly", () => {
    const validator = new StreamingHashValidator();
    const events = computeHashChain([makeSessionStart({ sequence_num: 0 })]);

    expect(events[0]?.prev_hash).toBe("");
    const result = validator.validate(events[0] as TraceEvent);
    expect(result.valid).toBe(true);
    expect(validator.currentHash).toBe(events[0]?.event_hash);
  });

  test("failed validation does not advance state", () => {
    const validator = new StreamingHashValidator();
    const events = chainedTrace();

    // Validate first event successfully
    expect(validator.validate(events[0] as TraceEvent).valid).toBe(true);
    expect(validator.eventsValidated).toBe(1);

    // Feed a tampered event — validation fails
    const tampered = { ...events[1], event_hash: "tampered" } as unknown as TraceEvent;
    const failResult = validator.validate(tampered);
    expect(failResult.valid).toBe(false);

    // State should NOT have advanced
    expect(validator.eventsValidated).toBe(1);
    expect(validator.currentHash).toBe((events[0] as TraceEvent).event_hash);

    // Feeding the correct event should still work (retry scenario)
    const retryResult = validator.validate(events[1] as TraceEvent);
    expect(retryResult.valid).toBe(true);
    expect(validator.eventsValidated).toBe(2);
  });

  test("TraceWriter double open without close throws error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "krynix-tw-"));
    try {
      const writer = new TraceWriter();
      await writer.open(join(dir, "test1.jsonl"));

      // Second open without close should throw
      await expect(writer.open(join(dir, "test2.jsonl"))).rejects.toThrow(
        "TraceWriter is already open",
      );

      await writer.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("TraceWriter currentHash getter returns correct hash after writes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "krynix-sv-"));
    try {
      const writer = new TraceWriter();
      await writer.open(join(dir, "test.jsonl"));

      // Before any writes, currentHash should be ""
      expect(writer.currentHash).toBe("");

      // Write an event
      const events = [makeSessionStart({ sequence_num: 0 })] as TraceEvent[];
      await writer.write(events[0] as TraceEvent);

      // currentHash should now be non-empty
      expect(writer.currentHash).not.toBe("");
      expect(writer.currentHash).toMatch(/^[0-9a-f]{64}$/);

      await writer.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
