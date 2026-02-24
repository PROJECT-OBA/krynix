/**
 * CLI replay command.
 *
 * Verifies or regenerates trace files. Supports single trace files
 * (`--trace`) and entire golden directories (`--golden-dir`).
 *
 * @module
 */

import { verifyTrace, verifyGoldenDir, regenerateTrace } from "@krynix/replay";
import type { ReplayResult } from "@krynix/replay";

/** Result from the replay command. */
export interface ReplayCommandResult {
  exitCode: number;
  results: ReplayResult[];
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
export async function runReplay(args: string[]): Promise<ReplayCommandResult> {
  const tracePath = getArg(args, "--trace");
  const goldenDir = getArg(args, "--golden-dir");
  const hasVerify = args.includes("--verify");
  const hasRegenerate = args.includes("--regenerate");
  const hasVerbose = args.includes("--verbose");

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
    return await handleVerify(tracePath, goldenDir, hasVerbose);
  } catch (err) {
    return {
      exitCode: 1,
      results: [],
      error: `Unexpected error: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleVerify(
  tracePath: string | undefined,
  goldenDir: string | undefined,
  _verbose: boolean,
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

  return {
    exitCode: hasFailure ? 1 : 0,
    results,
    error: null,
  };
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
    // For regeneration of a directory, we'd need to list files — but for now
    // this is handled by the --trace flag for individual files.
    return {
      exitCode: 1,
      results,
      error:
        "--regenerate with --golden-dir is not yet supported; use --trace for individual files",
    };
  }

  const hasFailure = results.some((r) => r.status !== "pass");

  return {
    exitCode: hasFailure ? 1 : 0,
    results,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}
