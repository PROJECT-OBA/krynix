/**
 * CLI stats command.
 *
 * Reads a trace JSONL file and computes per-session analytics using
 * `computeTraceStats` from `@krynix/core`. Outputs the result as JSON.
 *
 * @module
 */

import { readTrace, computeTraceStats, filterTraceEvents } from "@krynix/core";
import type { TraceStats } from "@krynix/core";
import { getArg, getAllArgs } from "./arg-parser.js";

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
  const filterTypes = getAllArgs(args, "--filter-type");
  const filterAgents = getAllArgs(args, "--filter-agent");
  const afterArg = getArg(args, "--after");
  const beforeArg = getArg(args, "--before");

  if (tracePath === undefined) {
    return { exitCode: 1, stats: null, error: "Missing required argument: --trace" };
  }

  let trace;
  try {
    trace = await readTrace(tracePath);
  } catch (err) {
    return { exitCode: 1, stats: null, error: `Failed to read trace: ${String(err)}` };
  }

  // Apply filters
  try {
    trace = filterTraceEvents(trace, {
      event_types: filterTypes.length > 0 ? filterTypes : undefined,
      agent_ids: filterAgents.length > 0 ? filterAgents : undefined,
      after: afterArg,
      before: beforeArg,
    });
  } catch (err) {
    return { exitCode: 1, stats: null, error: `Invalid filter: ${String(err)}` };
  }

  let stats;
  try {
    stats = computeTraceStats(trace);
  } catch (err) {
    return { exitCode: 1, stats: null, error: `Failed to compute stats: ${String(err)}` };
  }

  return { exitCode: 0, stats, error: null };
}
