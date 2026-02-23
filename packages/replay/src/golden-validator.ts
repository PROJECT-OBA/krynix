/**
 * Golden trace validator for ARTL replays.
 *
 * Reads `*.trace.jsonl` files from a directory and validates each one:
 * hash chain integrity, contiguous sequence_num, same session_id,
 * lifecycle bookends (session_start / session_end).
 *
 * @module
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTrace, validateHashChain } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

/** Validation result for a single golden trace file. */
export interface GoldenValidationResult {
  file: string;
  valid: boolean;
  errors: string[];
}

/**
 * Validate all golden trace files in a directory.
 *
 * @param dir - Directory containing `*.trace.jsonl` files
 * @returns Array of validation results, one per file
 */
export async function validateGoldenTraces(dir: string): Promise<GoldenValidationResult[]> {
  const entries = await readdir(dir);
  const traceFiles = entries.filter((f) => f.endsWith(".trace.jsonl")).sort();

  const results: GoldenValidationResult[] = [];

  for (const file of traceFiles) {
    const filePath = join(dir, file);
    results.push(await validateSingleTrace(file, filePath));
  }

  return results;
}

async function validateSingleTrace(
  file: string,
  filePath: string,
): Promise<GoldenValidationResult> {
  const errors: string[] = [];

  let events: TraceEvent[];
  try {
    events = await readTrace(filePath);
  } catch (err) {
    return { file, valid: false, errors: [`Failed to read trace: ${String(err)}`] };
  }

  if (events.length === 0) {
    return { file, valid: false, errors: ["Trace file is empty"] };
  }

  // Check contiguous sequence_num
  for (const [i, event] of events.entries()) {
    if (event.sequence_num !== i) {
      errors.push(
        `Non-contiguous sequence_num at index ${i}: expected ${i}, got ${event.sequence_num}`,
      );
      break;
    }
  }

  // Check same session_id — events[0] is guaranteed to exist (empty check above)
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const firstEvent = events[0]!;

  const sessionId = firstEvent.session_id;
  for (const [i, event] of events.entries()) {
    if (event.session_id !== sessionId) {
      errors.push(
        `Mismatched session_id at index ${i}: expected "${sessionId}", got "${event.session_id}"`,
      );
      break;
    }
  }

  // Check lifecycle bookends
  if (firstEvent.event_type !== "lifecycle") {
    errors.push(`First event must be lifecycle (session_start), got "${firstEvent.event_type}"`);
  } else {
    const payload = firstEvent.payload as unknown as Record<string, unknown>;
    if (payload["action"] !== "session_start") {
      errors.push(
        `First lifecycle event must have action "session_start", got "${String(payload["action"])}"`,
      );
    }
  }

  if (events.length > 1) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const lastEvent = events[events.length - 1]!;
    if (lastEvent.event_type !== "lifecycle") {
      errors.push(`Last event must be lifecycle (session_end), got "${lastEvent.event_type}"`);
    } else {
      const payload = lastEvent.payload as unknown as Record<string, unknown>;
      if (payload["action"] !== "session_end") {
        errors.push(
          `Last lifecycle event must have action "session_end", got "${String(payload["action"])}"`,
        );
      }
    }
  }

  // Validate hash chain
  const hashResult = validateHashChain(events);
  if (!hashResult.valid) {
    errors.push(
      `Hash chain broken at sequence_num ${hashResult.brokenAt ?? "unknown"}: ${hashResult.error ?? "unknown error"}`,
    );
  }

  return { file, valid: errors.length === 0, errors };
}
