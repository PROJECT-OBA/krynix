/**
 * Streaming hash chain validator.
 *
 * Processes TraceEvents one at a time, maintaining only the rolling hash
 * state. Memory-efficient for large traces or piped input.
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { TraceEvent, ValidationResult } from "./types.js";
import { canonicalize } from "./canonical-json.js";

/**
 * Stateful hash chain validator that processes events one at a time.
 *
 * Unlike `validateHashChain` (which requires the full array upfront),
 * `StreamingHashValidator` validates incrementally. It stores only
 * the expected `prevHash` and event count — zero memory growth.
 *
 * @example
 * ```ts
 * const validator = new StreamingHashValidator();
 * for (const event of events) {
 *   const result = validator.validate(event);
 *   if (!result.valid) {
 *     console.error(`Broken at event ${result.brokenAt}: ${result.error}`);
 *     break;
 *   }
 * }
 * console.log(`Validated ${validator.eventsValidated} events`);
 * ```
 */
export class StreamingHashValidator {
  private expectedPrevHash = "";
  private eventCount = 0;

  /**
   * Validate a single event against the hash chain.
   *
   * Checks:
   * 1. `prev_hash` matches the hash of the previously validated event
   * 2. `event_hash` matches the recomputed hash
   * 3. `sequence_num` matches the expected counter
   *
   * On success, advances the internal state. On failure, state is
   * NOT advanced (the failing event can be retried or skipped).
   *
   * @param event - The TraceEvent to validate
   * @returns Validation result; `brokenAt` is the 0-based index of this event
   */
  validate(event: TraceEvent): ValidationResult {
    const index = this.eventCount;

    // Check sequence_num
    if (event.sequence_num !== index) {
      return {
        valid: false,
        brokenAt: index,
        error: `sequence_num mismatch at event ${index}: expected ${index}, got ${event.sequence_num}`,
      };
    }

    // Check prev_hash linkage
    if (event.prev_hash !== this.expectedPrevHash) {
      return {
        valid: false,
        brokenAt: index,
        error: `prev_hash mismatch at event ${index}: expected "${this.expectedPrevHash}", got "${event.prev_hash}"`,
      };
    }

    // Recompute event_hash
    const withEmptyHash = { ...event, event_hash: "" } as unknown as TraceEvent;
    const canonical = canonicalize(withEmptyHash);
    const expectedHash = createHash("sha256").update(canonical).digest("hex");

    if (event.event_hash !== expectedHash) {
      return {
        valid: false,
        brokenAt: index,
        error: `event_hash mismatch at event ${index}: expected "${expectedHash}", got "${event.event_hash}"`,
      };
    }

    // Advance state
    this.expectedPrevHash = event.event_hash;
    this.eventCount++;

    return { valid: true };
  }

  /** The hash of the last successfully validated event, or "" if none. */
  get currentHash(): string {
    return this.expectedPrevHash;
  }

  /** Number of events validated so far. */
  get eventsValidated(): number {
    return this.eventCount;
  }

  /** Reset to initial state for reuse. */
  reset(): void {
    this.expectedPrevHash = "";
    this.eventCount = 0;
  }
}
