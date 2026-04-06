/**
 * CLI replay command.
 *
 * Verifies or regenerates trace files. Supports single trace files
 * (`--trace`) and entire golden directories (`--golden-dir`).
 *
 * @module
 */

import {
  verifyTrace,
  verifyGoldenDir,
  regenerateTrace,
  regenerateGoldenDir,
  compareTraces,
} from "@krynix/replay";
import type { ReplayResult, DivergenceReport } from "@krynix/replay";
import { readTrace } from "@krynix/core";
import { getArg, hasFlag } from "./arg-parser.js";
import { formatReplayResults } from "./format-replay.js";

/** Result from the replay command (verify/regenerate modes). */
export interface ReplayCommandResult {
  exitCode: number;
  results: ReplayResult[];
  error: string | null;
  verboseLines?: string[];
}

/** Result from the replay --compare command. */
export interface CompareCommandResult {
  exitCode: number;
  report: DivergenceReport | null;
  error: string | null;
}

/**
 * Run the replay command.
 *
 * Does NOT call `process.exit` — returns the result for testability.
 *
 * @param args - Command arguments
 * @returns Replay result with exit code, results array, and any error message
 */
export async function runReplay(
  args: string[],
): Promise<ReplayCommandResult | CompareCommandResult> {
  const tracePath = getArg(args, "--trace");
  const goldenDir = getArg(args, "--golden-dir");
  const hasVerify = hasFlag(args, "--verify");
  const hasRegenerate = hasFlag(args, "--regenerate");
  const hasCompare = hasFlag(args, "--compare");
  const verbose = hasFlag(args, "--verbose");

  // --compare mode: separate flow; reject incompatible flag combos up front
  if (hasCompare) {
    if (hasVerify || hasRegenerate) {
      return {
        exitCode: 1,
        report: null,
        error: "--compare cannot be combined with --verify or --regenerate",
      };
    }
    if (tracePath !== undefined || goldenDir !== undefined) {
      return {
        exitCode: 1,
        report: null,
        error: "--compare does not accept --trace or --golden-dir; use --baseline and --candidate",
      };
    }
    return await runCompare(args);
  }

  // Validate: need at least one target
  if (tracePath === undefined && goldenDir === undefined) {
    return {
      exitCode: 1,
      results: [],
      error: "Missing required argument: --trace or --golden-dir",
    };
  }

  // Validate: --verify and --regenerate are mutually exclusive
  if (hasVerify && hasRegenerate) {
    return {
      exitCode: 1,
      results: [],
      error: "--verify and --regenerate are mutually exclusive",
    };
  }

  // Default to verify mode if neither flag is given
  const mode = hasRegenerate ? "regenerate" : "verify";

  try {
    if (mode === "regenerate") {
      return await handleRegenerate(tracePath, goldenDir);
    }
    return await handleVerify(tracePath, goldenDir, verbose);
  } catch (err) {
    return {
      exitCode: 1,
      results: [],
      error: `Unexpected error: ${String(err)}`,
    };
  }
}

/**
 * Compare two traces for behavioral drift.
 *
 * @param args - Command arguments (expects --baseline and --candidate)
 * @returns Compare result with divergence report
 */
async function runCompare(args: string[]): Promise<CompareCommandResult> {
  const baselinePath = getArg(args, "--baseline");
  const candidatePath = getArg(args, "--candidate");

  if (baselinePath === undefined || candidatePath === undefined) {
    return {
      exitCode: 1,
      report: null,
      error: "--compare requires both --baseline <file> and --candidate <file>",
    };
  }

  try {
    const baselineEvents = await readTrace(baselinePath);
    const candidateEvents = await readTrace(candidatePath);
    const report = compareTraces(baselineEvents, candidateEvents);

    return {
      exitCode: report.status === "pass" ? 0 : 1,
      report,
      error: null,
    };
  } catch (err) {
    return {
      exitCode: 1,
      report: null,
      error: `Compare failed: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleVerify(
  tracePath: string | undefined,
  goldenDir: string | undefined,
  verbose: boolean,
): Promise<ReplayCommandResult> {
  const results: ReplayResult[] = [];

  if (tracePath !== undefined) {
    results.push(await verifyTrace(tracePath));
  }

  if (goldenDir !== undefined) {
    const dirResults = await verifyGoldenDir(goldenDir);
    results.push(...dirResults);
  }

  const hasFailure = results.some((r) => r.status !== "pass");

  const output: ReplayCommandResult = {
    exitCode: hasFailure ? 1 : 0,
    results,
    error: null,
  };

  if (verbose) {
    output.verboseLines = formatReplayResults(results);
  }

  return output;
}

async function handleRegenerate(
  tracePath: string | undefined,
  goldenDir: string | undefined,
): Promise<ReplayCommandResult> {
  const results: ReplayResult[] = [];

  if (tracePath !== undefined) {
    try {
      await regenerateTrace(tracePath);
      results.push({ file: tracePath, status: "pass" });
    } catch (err) {
      results.push({
        file: tracePath,
        status: "error",
        validationErrors: [String(err)],
      });
    }
  }

  if (goldenDir !== undefined) {
    const dirResults = await regenerateGoldenDir(goldenDir);
    results.push(...dirResults);
  }

  const hasFailure = results.some((r) => r.status !== "pass");

  return {
    exitCode: hasFailure ? 1 : 0,
    results,
    error: null,
  };
}
