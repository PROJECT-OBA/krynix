/**
 * CLI policy test command.
 *
 * Tests a single policy against a single trace and reports the verdict.
 * Optionally compares against an expected verdict (`--expect-verdict`).
 * Without `--expect-verdict`, always exits 0 (reporting mode).
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { readTrace } from "@krynix/core";
import { parsePolicy, evaluate } from "@krynix/policy";
import type { Violation } from "@krynix/policy";
import { getArg } from "./arg-parser.js";

/** Result from the policy test command. */
export interface PolicyTestResult {
  exitCode: number;
  result: {
    verdict: string;
    violations: Violation[];
    expectation: { expected: string; actual: string; match: boolean } | null;
  } | null;
  error: string | null;
}

const VALID_VERDICTS = ["pass", "fail", "require-approval"];

/**
 * Run the policy test command.
 *
 * Does NOT call `process.exit` — returns the result for testability.
 *
 * @param args - Command arguments: `["--policy", path, "--trace", path, "--expect-verdict", verdict?]`
 * @returns Policy test result with exit code, evaluation output, and any error
 */
export async function runPolicyTest(args: string[]): Promise<PolicyTestResult> {
  const policyPath = getArg(args, "--policy");
  const tracePath = getArg(args, "--trace");
  const expectVerdict = getArg(args, "--expect-verdict");

  if (policyPath === undefined) {
    return { exitCode: 1, result: null, error: "Missing required argument: --policy" };
  }
  if (tracePath === undefined) {
    return { exitCode: 1, result: null, error: "Missing required argument: --trace" };
  }
  if (expectVerdict !== undefined && !VALID_VERDICTS.includes(expectVerdict)) {
    return {
      exitCode: 1,
      result: null,
      error: `Invalid --expect-verdict value: "${expectVerdict}". Must be one of: ${VALID_VERDICTS.join(", ")}`,
    };
  }

  // Read trace
  let trace;
  try {
    trace = await readTrace(tracePath);
  } catch (err) {
    return { exitCode: 1, result: null, error: `Failed to read trace: ${String(err)}` };
  }

  // Read and parse policy
  let policyContent: string;
  try {
    policyContent = await readFile(policyPath, "utf-8");
  } catch (err) {
    return { exitCode: 1, result: null, error: `Failed to read policy: ${String(err)}` };
  }

  let policy;
  try {
    policy = parsePolicy(policyContent);
  } catch (err) {
    return { exitCode: 1, result: null, error: `Failed to parse policy: ${String(err)}` };
  }

  // Evaluate
  const evalResult = evaluate(trace, policy);

  // Build result
  let expectation: { expected: string; actual: string; match: boolean } | null = null;
  let exitCode = 0;

  if (expectVerdict !== undefined) {
    const match = evalResult.verdict === expectVerdict;
    expectation = { expected: expectVerdict, actual: evalResult.verdict, match };
    exitCode = match ? 0 : 1;
  }

  return {
    exitCode,
    result: {
      verdict: evalResult.verdict,
      violations: evalResult.violations,
      expectation,
    },
    error: null,
  };
}
