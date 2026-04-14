import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import { computeHashChain, validateHashChain } from "./hash-chain.js";
import { canonicalize } from "./canonical-json.js";
import { generateSigningKeypair, signHashChain, verifyHashChainSignature } from "./signing.js";
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

  // -------------------------------------------------------------------------
  // Adversarial scenarios.
  //
  // These tests document exactly what structural chain validation does and
  // does NOT protect against. The short version:
  //
  //   - Chain alone (v1.0.0): catches naive tampering where the chain wasn't
  //     rebuilt. DOES NOT catch full-chain regeneration — anyone who reads
  //     `hash-chain.ts` can mutate data and regenerate a valid-looking chain.
  //   - Chain + Ed25519 signature (v2.0.0 planned, shipped in `signing.ts`):
  //     catches regeneration because the tip hash changes and the attacker
  //     has no private key to re-sign.
  //
  // If you break one of these tests, you may have changed the security model.
  // Think hard before updating the expectation.
  // -------------------------------------------------------------------------
  describe("adversarial scenarios — what chain alone catches vs signing", () => {
    test("naive mutation (payload changed, hashes left alone) → CAUGHT by chain", () => {
      const chained = computeHashChain([makeSessionStart(), makeToolCall(1), makeSessionEnd(2)]);
      const mutated: TraceEvent[] = chained.map((e, i) =>
        i === 1
          ? ({
              ...e,
              payload: { tool_name: "rm_rf_slash", arguments: {} },
            } as unknown as TraceEvent)
          : e,
      );

      const result = validateHashChain(mutated);
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
    });

    test("full chain regeneration over tampered data → MISSED by chain, CAUGHT by signature", () => {
      const legit = computeHashChain([makeSessionStart(), makeToolCall(1), makeSessionEnd(2)]);
      const { privateKey, publicKey } = generateSigningKeypair();
      const legitSig = signHashChain(legit, privateKey);

      // Attacker mutates event 1 AND regenerates the chain from scratch.
      const regenerated = computeHashChain([
        makeSessionStart(),
        makeToolCall(1, { arguments: { path: "/etc/passwd" } }),
        makeSessionEnd(2),
      ]);

      // Structural validation PASSES — this is the v1.0.0 gap.
      expect(validateHashChain(regenerated).valid).toBe(true);

      // But the tip differs, so the original signature no longer verifies.
      expect(verifyHashChainSignature(regenerated, legitSig, publicKey)).toBe(false);
    });

    test("event deletion + regeneration → MISSED by chain, CAUGHT by signature", () => {
      const legit = computeHashChain([makeSessionStart(), makeToolCall(1), makeSessionEnd(2)]);
      const { privateKey, publicKey } = generateSigningKeypair();
      const legitSig = signHashChain(legit, privateKey);

      // Attacker drops event 1 (the tool_call evidence) and re-numbers + regenerates.
      // Re-sequenced so sequence_num values stay contiguous starting at 0.
      const regenerated = computeHashChain([
        makeSessionStart(),
        { ...makeSessionEnd(2), sequence_num: 1 } as TraceEvent,
      ]);

      expect(validateHashChain(regenerated).valid).toBe(true);
      expect(verifyHashChainSignature(regenerated, legitSig, publicKey)).toBe(false);
    });

    test("event insertion + regeneration → MISSED by chain, CAUGHT by signature", () => {
      const legit = computeHashChain([makeSessionStart(), makeSessionEnd(1)]);
      const { privateKey, publicKey } = generateSigningKeypair();
      const legitSig = signHashChain(legit, privateKey);

      // Attacker inserts a fabricated tool_call between start and end.
      const regenerated = computeHashChain([
        makeSessionStart(),
        makeToolCall(1),
        { ...makeSessionEnd(1), sequence_num: 2 } as TraceEvent,
      ]);

      expect(validateHashChain(regenerated).valid).toBe(true);
      expect(verifyHashChainSignature(regenerated, legitSig, publicKey)).toBe(false);
    });

    test("event reorder + sequence_num fix + regeneration → MISSED by chain, CAUGHT by signature", () => {
      const legit = computeHashChain([
        makeSessionStart(),
        makeToolCall(1),
        makeToolCall(2, { tool_name: "file_write" }),
        makeSessionEnd(3),
      ]);
      const { privateKey, publicKey } = generateSigningKeypair();
      const legitSig = signHashChain(legit, privateKey);

      // Attacker swaps the two tool_calls so it looks like the writes came before reads.
      const regenerated = computeHashChain([
        makeSessionStart(),
        { ...makeToolCall(1, { tool_name: "file_write" }), sequence_num: 1 } as TraceEvent,
        { ...makeToolCall(1), sequence_num: 2 } as TraceEvent,
        { ...makeSessionEnd(3), sequence_num: 3 } as TraceEvent,
      ]);

      expect(validateHashChain(regenerated).valid).toBe(true);
      expect(verifyHashChainSignature(regenerated, legitSig, publicKey)).toBe(false);
    });

    test("chain truncation (drop tail + rebuild is a no-op since chain is still valid by construction) → MISSED by chain, CAUGHT by signature", () => {
      const legit = computeHashChain([makeSessionStart(), makeToolCall(1), makeSessionEnd(2)]);
      const { privateKey, publicKey } = generateSigningKeypair();
      const legitSig = signHashChain(legit, privateKey);

      // Attacker drops the tail — the remaining prefix is structurally valid.
      const truncated = legit.slice(0, 2);

      expect(validateHashChain(truncated).valid).toBe(true);
      expect(verifyHashChainSignature(truncated, legitSig, publicKey)).toBe(false);
    });

    test("wrong signing key detection — signature under key A does not verify under key B", () => {
      const chained = computeHashChain([makeSessionStart(), makeSessionEnd(1)]);
      const keyA = generateSigningKeypair();
      const keyB = generateSigningKeypair();
      const sigA = signHashChain(chained, keyA.privateKey);

      expect(verifyHashChainSignature(chained, sigA, keyA.publicKey)).toBe(true);
      expect(verifyHashChainSignature(chained, sigA, keyB.publicKey)).toBe(false);
    });

    test("corrupted signature detection — single-bit flip invalidates", () => {
      const chained = computeHashChain([makeSessionStart(), makeSessionEnd(1)]);
      const { privateKey, publicKey } = generateSigningKeypair();
      const sig = signHashChain(chained, privateKey);

      // Flip one hex nibble deep in the signature
      const mid = Math.floor(sig.length / 2);
      const flipped = sig.slice(0, mid) + (sig[mid] === "0" ? "f" : "0") + sig.slice(mid + 1);

      expect(verifyHashChainSignature(chained, flipped, publicKey)).toBe(false);
    });
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
