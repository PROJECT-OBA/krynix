/**
 * Hash chain computation and validation for TraceEvent sequences.
 *
 * Each event's `event_hash` is the SHA-256 hex digest of its canonical JSON
 * (with `event_hash` set to `""`). Events are linked via `prev_hash`, forming
 * a tamper-evident chain.
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { TraceEvent, ValidationResult } from "./types.js";
import { KrynixError } from "./errors.js";
import { canonicalize } from "./canonical-json.js";

/**
 * Compute SHA-256 hash chain over a sequence of TraceEvents.
 *
 * Returns a new array of cloned events with `prev_hash` and `event_hash`
 * populated. The original events are never mutated.
 *
 * @param events - Ordered TraceEvents with contiguous `sequence_num` starting at 0
 * @returns New array with hash chain computed
 * @throws {KrynixError} INVALID_SEQUENCE if sequence_num values are not contiguous from 0
 */
export function computeHashChain(events: readonly TraceEvent[]): TraceEvent[] {
  validateSequenceNums(events);

  const result: TraceEvent[] = [];
  let prevHash = "";

  for (const event of events) {
    const withPrev = { ...event, prev_hash: prevHash, event_hash: "" } as unknown as TraceEvent;
    const canonical = canonicalize(withPrev);
    const eventHash = createHash("sha256").update(canonical).digest("hex");
    const hashed = { ...withPrev, event_hash: eventHash } as unknown as TraceEvent;

    result.push(hashed);
    prevHash = eventHash;
  }

  return result;
}

/**
 * Validate that a hash chain is intact.
 *
 * Recomputes each event's hash and verifies it matches the stored
 * `event_hash`, and that each `prev_hash` links to the preceding event.
 *
 * @param events - Ordered TraceEvents to validate
 * @returns Validation result with `brokenAt` index if invalid
 */
export function validateHashChain(events: readonly TraceEvent[]): ValidationResult {
  if (events.length === 0) {
    return { valid: true };
  }

  let prevHash = "";

  for (const [i, event] of events.entries()) {
    // Check prev_hash linkage
    if (event.prev_hash !== prevHash) {
      return {
        valid: false,
        brokenAt: i,
        error: `prev_hash mismatch at event ${i}: expected "${prevHash}", got "${event.prev_hash}"`,
      };
    }

    // Recompute event_hash
    const withEmptyHash = { ...event, event_hash: "" } as unknown as TraceEvent;
    const canonical = canonicalize(withEmptyHash);
    const expectedHash = createHash("sha256").update(canonical).digest("hex");

    if (event.event_hash !== expectedHash) {
      return {
        valid: false,
        brokenAt: i,
        error: `event_hash mismatch at event ${i}: expected "${expectedHash}", got "${event.event_hash}"`,
      };
    }

    prevHash = event.event_hash;
  }

  return { valid: true };
}

/**
 * Verify that sequence_num values are contiguous starting from 0.
 */
function validateSequenceNums(events: readonly TraceEvent[]): void {
  for (const [i, event] of events.entries()) {
    if (event.sequence_num !== i) {
      throw new KrynixError(
        "INVALID_SEQUENCE",
        `expected sequence_num ${i}, got ${event.sequence_num}`,
      );
    }
  }
}
