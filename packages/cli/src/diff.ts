/**
 * CLI `diff` command.
 *
 * Compares two trace files for behavioral drift. Wraps the
 * `compareTraces` library from `@krynix/replay`.
 *
 * @module
 */

import { readTrace } from "@krynix/core";
import { compareTraces } from "@krynix/replay";
import type { DivergenceReport } from "@krynix/replay";
import { getArg } from "./arg-parser.js";

/** Result from the diff command. */
export interface DiffResult {
  exitCode: number;
  output: DivergenceReport | null;
  error: string | null;
}

/**
 * Compare two trace files and report behavioral drift.
 *
 * @param args - `["--baseline", path, "--candidate", path]`
 * @returns Diff result with exit code 0 (match) or 1 (diverged/error)
 */
export async function runDiff(args: string[]): Promise<DiffResult> {
  const baselinePath = getArg(args, "--baseline");
  const candidatePath = getArg(args, "--candidate");

  if (baselinePath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --baseline" };
  }
  if (candidatePath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --candidate" };
  }

  let baselineEvents;
  try {
    baselineEvents = await readTrace(baselinePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Failed to read baseline trace: ${message}` };
  }

  let candidateEvents;
  try {
    candidateEvents = await readTrace(candidatePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Failed to read candidate trace: ${message}` };
  }

  const report = compareTraces(baselineEvents, candidateEvents);

  return {
    exitCode: report.status === "pass" ? 0 : 1,
    output: report,
    error: null,
  };
}
