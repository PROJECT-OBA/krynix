/**
 * CLI policy diff command.
 *
 * Compares two policy files and outputs a structured diff. Detects
 * severity downgrades and action weakenings for CI integration.
 *
 * Exit codes:
 * - 0: No security-relevant regressions
 * - 1: Runtime error (missing args, parse failure, etc.)
 * - 2: Severity downgrade or action weakening detected
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { parsePolicy, diffPolicies } from "@krynix/policy";
import type { PolicyDiff } from "@krynix/policy";
import { getArg } from "./arg-parser.js";

/** Result from the policy diff command. */
export interface PolicyDiffResult {
  exitCode: number;
  result: PolicyDiff | null;
  error: string | null;
}

/**
 * Run the policy diff command.
 *
 * Does NOT call `process.exit` — returns the result for testability.
 *
 * @param args - Command arguments: `["--old", path, "--new", path]`
 * @returns Policy diff result with exit code, structured diff, and any error
 */
export async function runPolicyDiff(args: string[]): Promise<PolicyDiffResult> {
  const oldPath = getArg(args, "--old");
  const newPath = getArg(args, "--new");

  if (oldPath === undefined) {
    return { exitCode: 1, result: null, error: "Missing required argument: --old" };
  }
  if (newPath === undefined) {
    return { exitCode: 1, result: null, error: "Missing required argument: --new" };
  }

  // Read and parse old policy
  let oldContent: string;
  try {
    oldContent = await readFile(oldPath, "utf-8");
  } catch (err) {
    return { exitCode: 1, result: null, error: `Failed to read old policy: ${String(err)}` };
  }

  let oldPolicy;
  try {
    oldPolicy = parsePolicy(oldContent);
  } catch (err) {
    return { exitCode: 1, result: null, error: `Failed to parse old policy: ${String(err)}` };
  }

  // Read and parse new policy
  let newContent: string;
  try {
    newContent = await readFile(newPath, "utf-8");
  } catch (err) {
    return { exitCode: 1, result: null, error: `Failed to read new policy: ${String(err)}` };
  }

  let newPolicy;
  try {
    newPolicy = parsePolicy(newContent);
  } catch (err) {
    return { exitCode: 1, result: null, error: `Failed to parse new policy: ${String(err)}` };
  }

  // Compute diff
  const diff = diffPolicies(oldPolicy, newPolicy);

  // Exit code 2 for security regressions
  const exitCode = diff.hasSeverityDowngrade || diff.hasActionWeakening ? 2 : 0;

  return { exitCode, result: diff, error: null };
}
