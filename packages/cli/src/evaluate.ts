/**
 * CLI evaluate command.
 *
 * Reads a trace JSONL file and one or more policy files, evaluates the trace
 * against all policies, and outputs the result as JSON. Uses
 * most-restrictive-wins when multiple policies are provided.
 *
 * @module
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { readTrace, filterTraceEvents } from "@krynix/core";
import { parsePolicy, evaluate } from "@krynix/policy";
import type { Policy, EvaluationResult } from "@krynix/policy";
import { getArg, getAllArgs } from "./arg-parser.js";

/** Result from the evaluate command. */
export interface EvaluateResult {
  exitCode: number;
  output: AggregateOutput | null;
  error: string | null;
}

/** JSON output format for the evaluate command. */
export interface AggregateOutput {
  verdict: string;
  exitCode: number;
  policyResults: Array<{
    policyName: string;
    result: EvaluationResult;
  }>;
}

/**
 * Run the evaluate command.
 *
 * Does NOT call `process.exit` — returns the result for testability.
 *
 * @param args - Command arguments: `["--trace", path, "--policy", path]`
 * @returns Evaluate result with exit code, JSON output, and any error message
 */
export async function runEvaluate(args: string[]): Promise<EvaluateResult> {
  // Parse args
  const tracePath = getArg(args, "--trace");
  const policyPath = getArg(args, "--policy");
  const filterTypes = getAllArgs(args, "--filter-type");
  const filterAgents = getAllArgs(args, "--filter-agent");
  const afterArg = getArg(args, "--after");
  const beforeArg = getArg(args, "--before");

  if (tracePath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --trace" };
  }
  if (policyPath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --policy" };
  }

  // Read trace
  let trace;
  try {
    trace = await readTrace(tracePath);
  } catch (err) {
    return { exitCode: 1, output: null, error: `Failed to read trace: ${String(err)}` };
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
    return { exitCode: 1, output: null, error: `Invalid filter: ${String(err)}` };
  }

  // Load policies
  let policies: Array<{ name: string; policy: Policy }>;
  try {
    policies = await loadPolicies(policyPath);
  } catch (err) {
    return { exitCode: 1, output: null, error: `Failed to load policies: ${String(err)}` };
  }

  if (policies.length === 0) {
    return { exitCode: 1, output: null, error: `No policy files found at: ${policyPath}` };
  }

  // Evaluate each policy
  const policyResults: AggregateOutput["policyResults"] = [];

  for (const { name, policy } of policies) {
    const result = evaluate(trace, policy);
    policyResults.push({ policyName: name, result });
  }

  // Aggregate: most-restrictive-wins (max exit code)
  const maxExitCode = Math.max(...policyResults.map((r) => r.result.exitCode));
  const aggregateVerdict = deriveVerdict(maxExitCode);

  const output: AggregateOutput = {
    verdict: aggregateVerdict,
    exitCode: maxExitCode,
    policyResults,
  };

  return { exitCode: maxExitCode, output, error: null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveVerdict(exitCode: number): string {
  switch (exitCode) {
    case 0:
      return "pass";
    case 3:
      return "require-approval";
    default:
      return "fail";
  }
}

async function loadPolicies(policyPath: string): Promise<Array<{ name: string; policy: Policy }>> {
  const info = await stat(policyPath);

  if (info.isDirectory()) {
    const entries = await readdir(policyPath);
    const yamlFiles = entries.filter((f) => f.endsWith(".policy.yaml")).sort();
    const results: Array<{ name: string; policy: Policy }> = [];

    for (const file of yamlFiles) {
      const content = await readFile(join(policyPath, file), "utf-8");
      const policy = parsePolicy(content);
      results.push({ name: file, policy });
    }

    return results;
  }

  // Single file
  const content = await readFile(policyPath, "utf-8");
  const policy = parsePolicy(content);
  const name = basename(policyPath);
  return [{ name, policy }];
}
