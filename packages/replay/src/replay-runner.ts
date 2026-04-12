/**
 * Replay runner for trace verification and regeneration.
 *
 * Provides functions to verify trace integrity (hash chain, lifecycle bookends,
 * contiguous sequence numbers, determinism envelope) and to regenerate hashes
 * for trace files.
 *
 * @module
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { readTrace, validateHashChain, computeHashChain, TraceWriter } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";
import { extractEnvelope } from "./envelope.js";
import type { ReplayResult, ReplayOptions } from "./types.js";

/**
 * Verify a single trace file for structural integrity and determinism.
 *
 * Checks:
 * 1. File can be read and parsed
 * 2. Trace is non-empty
 * 3. Lifecycle bookends: session_start first, session_end last
 * 4. Contiguous sequence_num from 0
 * 5. Consistent session_id across all events
 * 6. Hash chain integrity
 * 7. Determinism envelope is extractable
 * 8. Hash chain re-computation produces identical hashes
 *
 * @param tracePath - Path to a `.trace.jsonl` file
 * @param _options - Reserved for future use
 * @returns Verification result with pass/diverged/error status
 */
export async function verifyTrace(
  tracePath: string,
  _options?: ReplayOptions,
): Promise<ReplayResult> {
  let events: TraceEvent[];
  try {
    events = await readTrace(tracePath);
  } catch (err) {
    return {
      file: tracePath,
      status: "error",
      validationErrors: [`Failed to read trace: ${String(err)}`],
    };
  }

  const errors: string[] = [];

  if (events.length === 0) {
    return {
      file: tracePath,
      status: "error",
      validationErrors: ["Trace file is empty"],
    };
  }

  // Check contiguous sequence_num
  for (const [i, event] of events.entries()) {
    if (event.sequence_num !== i) {
      errors.push(
        `Non-contiguous sequence_num at index ${String(i)}: expected ${String(i)}, got ${String(event.sequence_num)}`,
      );
      break;
    }
  }

  // Check consistent session_id
  const firstEvent = events[0] as TraceEvent;
  const sessionId = firstEvent.session_id;
  for (const [i, event] of events.entries()) {
    if (event.session_id !== sessionId) {
      errors.push(
        `Mismatched session_id at index ${String(i)}: expected "${sessionId}", got "${event.session_id}"`,
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

  if (events.length === 1) {
    errors.push("Trace must have at least 2 events (session_start + session_end)");
  } else if (events.length > 1) {
    const lastEvent = events[events.length - 1] as TraceEvent;
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
      `Hash chain broken at sequence_num ${String(hashResult.brokenAt ?? "unknown")}: ${hashResult.error ?? "unknown error"}`,
    );
  }

  // Extract envelope (validates session_start has replay_seed)
  try {
    extractEnvelope(events);
  } catch (err) {
    errors.push(`Envelope extraction failed: ${String(err)}`);
  }

  if (errors.length > 0) {
    return {
      file: tracePath,
      status: "error",
      validationErrors: errors,
    };
  }

  // Hash determinism check: strip hashes, recompute, compare
  const stripped = events.map((e: TraceEvent) => ({
    ...e,
    prev_hash: "",
    event_hash: "",
  })) as TraceEvent[];

  const recomputed = computeHashChain(stripped);

  for (const [i, original] of events.entries()) {
    const recomp = recomputed[i] as TraceEvent;
    if (original.event_hash !== recomp.event_hash) {
      return {
        file: tracePath,
        status: "diverged",
        report: {
          status: "diverged",
          firstDivergence: {
            sequenceNum: i,
            expected: {
              eventType: original.event_type,
              payload: original.payload,
            },
            actual: {
              eventType: recomp.event_type,
              payload: recomp.payload,
            },
            diffs: [
              {
                field: "event_hash",
                expected: original.event_hash,
                actual: recomp.event_hash,
              },
            ],
          },
          totalEvents: events.length,
          eventsBeforeDivergence: i,
        },
      };
    }
  }

  return {
    file: tracePath,
    status: "pass",
    report: {
      status: "pass",
      totalEvents: events.length,
      eventsBeforeDivergence: events.length,
    },
  };
}

/**
 * Verify all golden trace files in a directory.
 *
 * Scans for `*.trace.jsonl` files and runs `verifyTrace` on each.
 * Non-trace files are ignored.
 *
 * @param dir - Directory containing golden trace files
 * @param options - Replay options
 * @returns Array of results, one per trace file
 */
export async function verifyGoldenDir(
  dir: string,
  options?: ReplayOptions,
): Promise<ReplayResult[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    return [
      {
        file: dir,
        status: "error",
        validationErrors: [`Failed to read directory: ${String(err)}`],
      },
    ];
  }

  const traceFiles = entries.filter((f) => f.endsWith(".trace.jsonl")).sort();

  const results: ReplayResult[] = [];
  for (const file of traceFiles) {
    results.push(await verifyTrace(join(dir, file), options));
  }

  return results;
}

/**
 * Regenerate all golden trace files in a directory.
 *
 * Scans for `*.trace.jsonl` files and runs `regenerateTrace` on each.
 * Non-trace files are ignored. Errors on individual files are captured
 * in the result array without aborting processing of remaining files.
 *
 * @param dir - Directory containing golden trace files
 * @returns Array of results, one per trace file
 */
export async function regenerateGoldenDir(dir: string): Promise<ReplayResult[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    return [
      {
        file: dir,
        status: "error",
        validationErrors: [`Failed to read directory: ${String(err)}`],
      },
    ];
  }

  const traceFiles = entries.filter((f) => f.endsWith(".trace.jsonl")).sort();

  const results: ReplayResult[] = [];
  for (const file of traceFiles) {
    const filePath = join(dir, file);
    try {
      await regenerateTrace(filePath);
      results.push({ file: filePath, status: "pass" });
    } catch (err) {
      results.push({
        file: filePath,
        status: "error",
        validationErrors: [String(err)],
      });
    }
  }

  return results;
}

/**
 * Regenerate a trace file by stripping hashes and recomputing them.
 *
 * This is useful when the hash algorithm or canonical JSON format changes.
 * The trace file is overwritten in place.
 *
 * @param tracePath - Path to a `.trace.jsonl` file
 */
export async function regenerateTrace(tracePath: string): Promise<void> {
  const events = await readTrace(tracePath);

  // Strip existing hashes — TraceWriter.write() recomputes them
  const stripped = events.map((e: TraceEvent) => ({
    ...e,
    prev_hash: "",
    event_hash: "",
  })) as TraceEvent[];

  const writer = new TraceWriter({ validateOnWrite: true });
  await writer.open(tracePath);
  for (const event of stripped) {
    await writer.write(event);
  }
  await writer.close();
}
