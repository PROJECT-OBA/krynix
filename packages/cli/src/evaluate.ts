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
import {
  readTrace,
  filterTraceEvents,
  validateHashChain,
  verifyHashChainSignature,
} from "@krynix/core";
import type { EnvironmentContext } from "@krynix/core";
import { parsePolicy, evaluate } from "@krynix/policy";
import type { Policy, EvaluationResult } from "@krynix/policy";
import { getArg, getAllArgs, hasFlag } from "./arg-parser.js";
import { buildEnvironmentContext } from "./env-flags.js";

/** Supported output formats. */
export type OutputFormat = "json" | "text";

/** Result from the evaluate command. */
export interface EvaluateResult {
  exitCode: number;
  output: AggregateOutput | null;
  error: string | null;
  format: OutputFormat;
}

/** JSON output format for the evaluate command. */
export interface AggregateOutput {
  verdict: string;
  exitCode: number;
  policyResults: Array<{
    policyName: string;
    result: EvaluationResult;
  }>;
  environment?: EnvironmentContext;
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
  const formatArg = getArg(args, "--format") ?? "json";

  if (formatArg !== "json" && formatArg !== "text") {
    return {
      exitCode: 1,
      output: null,
      error: `Unsupported format: ${formatArg}. Use "json" or "text".`,
      format: "json",
    };
  }
  const format: OutputFormat = formatArg;

  if (tracePath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --trace", format };
  }
  if (policyPath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --policy", format };
  }

  // Read trace
  let trace;
  try {
    trace = await readTrace(tracePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Failed to read trace: ${message}`, format };
  }

  // Reject the incoherent --skip-verify + --public-key combination.
  // Signature verification only authenticates the chain tip's event_hash
  // value. Without structural chain validation, an attacker can mutate
  // earlier event payloads without recomputing the chain — the tip's
  // event_hash field still matches the signature, but the event payloads
  // no longer hash to those values. Allowing this combo would silently
  // weaken the signing guarantee.
  const publicKeyPath = getArg(args, "--public-key");
  const skipVerify = hasFlag(args, "--skip-verify");
  if (skipVerify && publicKeyPath !== undefined) {
    return {
      exitCode: 1,
      output: null,
      error:
        "--skip-verify cannot be combined with --public-key: signature verification requires structural chain validation to be meaningful.",
      format,
    };
  }

  // Verify hash chain integrity before evaluating policy (default ON).
  // Use --skip-verify to bypass (e.g., for manually constructed test traces).
  //
  // Note (CLAIMS): this verifies STRUCTURAL integrity only — catches naive
  // tampering and corruption. A full chain regeneration over tampered data
  // will still pass. For cryptographic tamper-evidence against intentional
  // modification, also pass --public-key (verified below).
  if (!skipVerify) {
    const chainResult = validateHashChain(trace);
    if (!chainResult.valid) {
      return {
        exitCode: 1,
        output: null,
        error: `Hash chain validation failed: ${chainResult.error ?? "unknown error"}. Use --skip-verify to bypass (not recommended for production).`,
        format,
      };
    }
  }

  // Optional Ed25519 signature verification. When --public-key is provided,
  // read the signature (sidecar `<trace>.sig` by default, or --signature path)
  // and verify the chain tip matches. This is the tamper-evidence primitive
  // that structural chain validation alone cannot provide.
  if (publicKeyPath !== undefined) {
    const signaturePath = getArg(args, "--signature") ?? `${tracePath}.sig`;
    let publicKeyPem: string;
    let signatureHex: string;
    try {
      publicKeyPem = await readFile(publicKeyPath, "utf-8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        output: null,
        error: `Failed to read public key at ${publicKeyPath}: ${message}`,
        format,
      };
    }
    try {
      signatureHex = (await readFile(signaturePath, "utf-8")).trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        output: null,
        error: `Failed to read signature at ${signaturePath}: ${message}`,
        format,
      };
    }
    const sigValid = verifyHashChainSignature(trace, signatureHex, publicKeyPem);
    if (!sigValid) {
      return {
        exitCode: 1,
        output: null,
        error: `Signature verification failed: trace tip does not match the signature under the provided public key. The trace may have been tampered with, signed by a different key, or the signature file may be corrupted.`,
        format,
      };
    }
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
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Invalid filter: ${message}`, format };
  }

  // Resolve environment context from --env flags + auto-detection
  let environment: EnvironmentContext | undefined;
  try {
    environment = buildEnvironmentContext(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Invalid --env flag: ${message}`, format };
  }

  // Load policies
  let policies: Array<{ name: string; policy: Policy }>;
  try {
    policies = await loadPolicies(policyPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Failed to load policies: ${message}`, format };
  }

  if (policies.length === 0) {
    return { exitCode: 1, output: null, error: `No policy files found at: ${policyPath}`, format };
  }

  // Evaluate each policy
  const policyResults: AggregateOutput["policyResults"] = [];

  for (const { name, policy } of policies) {
    try {
      const result = evaluate(trace, policy);
      policyResults.push({ policyName: name, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        output: null,
        error: `Policy evaluation failed (${name}): ${message}`,
        format,
      };
    }
  }

  // Aggregate: most-restrictive-wins (max exit code)
  const maxExitCode = Math.max(...policyResults.map((r) => r.result.exitCode));
  const aggregateVerdict = deriveVerdict(maxExitCode);

  const output: AggregateOutput = {
    verdict: aggregateVerdict,
    exitCode: maxExitCode,
    policyResults,
    ...(environment ? { environment } : {}),
  };

  return { exitCode: maxExitCode, output, error: null, format };
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
