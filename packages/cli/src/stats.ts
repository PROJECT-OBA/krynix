/**
 * CLI stats command.
 *
 * Reads a trace JSONL file and computes per-session analytics using
 * `computeTraceStats` from `@krynix/core`. Outputs the result as JSON.
 *
 * @module
 */

import { readTrace, computeTraceStats } from "@krynix/core";
import type { TraceStats } from "@krynix/core";
import { getArg } from "./arg-parser.js";

/** Result from the stats command. */
export interface StatsResult {
  exitCode: number;
  stats: TraceStats | null;
  error: string | null;
}

/**
 * Run the stats command.
 *
 * Does NOT call `process.exit` — returns the result for testability.
 *
 * @param args - Command arguments: `["--trace", path]`
 * @returns Stats result with exit code, computed stats, and any error message
 */
export async function runStats(args: string[]): Promise<StatsResult> {
  const tracePath = getArg(args, "--trace");

  if (tracePath === undefined) {
    return { exitCode: 1, stats: null, error: "Missing required argument: --trace" };
  }

  let trace;
  try {
    trace = await readTrace(tracePath);
  } catch (err) {
    return { exitCode: 1, stats: null, error: `Failed to read trace: ${String(err)}` };
  }

  const stats = computeTraceStats(trace);
  return { exitCode: 0, stats, error: null };
}
