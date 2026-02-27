/**
 * Evaluation pipeline — single-function orchestration for CI/CD integration.
 *
 * Chains trace loading → hash chain validation → filtering → stats →
 * policy evaluation → replay verification → compliance bundle generation.
 *
 * Uses dependency inversion: core cannot import policy/replay, so those
 * operations are injected as callbacks.
 *
 * @module
 */

import type { TraceEvent, ValidationResult } from "./types.js";
import type { TraceFilterCriteria } from "./trace-filter.js";
import type { TraceStats } from "./trace-stats.js";
import type { ComplianceBundle, ComplianceBundleOptions } from "./compliance-bundle.js";
import { readTrace } from "./trace-reader.js";
import { validateHashChain } from "./hash-chain.js";
import { filterTraceEvents } from "./trace-filter.js";
import { computeTraceStats } from "./trace-stats.js";
import { generateComplianceBundle } from "./compliance-bundle.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from evaluating a single policy (provided by the caller). */
export interface PipelineEvalResult {
  /** Policy name or identifier. */
  policyName: string;
  /** Verdict: pass, fail, or require-approval. */
  verdict: "pass" | "fail" | "require-approval";
  /** Exit code for this policy (0 = pass, 1 = fail/error, 2 = deny, 3 = require-approval). */
  exitCode: number;
  /** Violations found (if any). */
  violations: unknown[];
}

/** Result from replay verification (provided by the caller). */
export interface PipelineReplayResult {
  /** Whether replay verification passed. */
  valid: boolean;
  /** Exit code for replay (0 = valid, 1 = invalid). */
  exitCode: number;
  /** Details about the replay result. */
  details: unknown;
}

/** Result for a single policy in the pipeline output. */
export interface PipelinePolicyResult {
  policyName: string;
  verdict: string;
  exitCode: number;
  violations: unknown[];
}

/** Options for the evaluation pipeline. */
export interface EvaluationPipelineOptions {
  /** Path to a .trace.jsonl file. Mutually exclusive with `events`. */
  tracePath?: string;
  /** Pre-loaded trace events. Mutually exclusive with `tracePath`. */
  events?: readonly TraceEvent[];
  /** Filter criteria to apply before evaluation. */
  filter?: TraceFilterCriteria;
  /** Policy references to evaluate. Opaque to the pipeline; passed to deps.evaluatePolicy. */
  policies: unknown[];
  /** Whether to generate a compliance bundle. Default: false. */
  generateBundle?: boolean;
  /** Additional options for the compliance bundle. */
  bundleOptions?: Partial<ComplianceBundleOptions>;
}

/** Injectable dependencies for the evaluation pipeline. */
export interface EvaluationPipelineDeps {
  /** Evaluate a single policy against trace events. */
  evaluatePolicy: (events: readonly TraceEvent[], policy: unknown) => Promise<PipelineEvalResult>;
  /**
   * Verify replay integrity. Optional.
   *
   * **Note:** This callback always receives the _unfiltered_ trace. Replay
   * verification must operate on the complete event sequence to validate hash
   * chains and deterministic re-execution; a filtered subset would break
   * chain continuity.
   */
  verifyReplay?: (events: readonly TraceEvent[]) => Promise<PipelineReplayResult>;
}

/** Complete result from the evaluation pipeline. */
export interface EvaluationPipelineResult {
  /** Overall exit code (max of all sub-results). */
  exitCode: number;
  /** The trace events (after filtering). */
  events: readonly TraceEvent[];
  /** Hash chain validation result. */
  hashChain: ValidationResult;
  /** Computed trace statistics. */
  stats: TraceStats;
  /** Results from policy evaluations. */
  policyResults: PipelinePolicyResult[];
  /** Replay verification result (undefined if not requested). */
  replayResult?: PipelineReplayResult;
  /** Compliance bundle (undefined if not requested). */
  bundle?: ComplianceBundle;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full evaluation pipeline.
 *
 * @param options - Pipeline configuration
 * @param deps - Injectable dependencies (policy evaluation, replay verification)
 * @returns Complete structured result
 * @throws If both tracePath and events are provided, or neither is provided
 * @throws If deps.evaluatePolicy throws
 */
export async function runEvaluationPipeline(
  options: EvaluationPipelineOptions,
  deps: EvaluationPipelineDeps,
): Promise<EvaluationPipelineResult> {
  // Validate input source
  if (options.tracePath !== undefined && options.events !== undefined) {
    throw new Error("Cannot provide both tracePath and events");
  }
  if (options.tracePath === undefined && options.events === undefined) {
    throw new Error("Must provide either tracePath or events");
  }

  // Step 1: Load trace
  let allEvents: readonly TraceEvent[];
  if (options.tracePath !== undefined) {
    allEvents = await readTrace(options.tracePath);
  } else {
    allEvents = options.events as readonly TraceEvent[];
  }

  // Step 2: Validate hash chain (does not abort on failure)
  const hashChain = validateHashChain(allEvents);

  // Step 3: Apply filter criteria
  let events: readonly TraceEvent[];
  if (options.filter !== undefined) {
    events = filterTraceEvents(allEvents, options.filter);
  } else {
    events = allEvents;
  }

  // Step 4: Compute stats
  const stats = computeTraceStats(events);

  // Step 5: Evaluate policies
  const policyResults: PipelinePolicyResult[] = [];
  for (const policy of options.policies) {
    const result = await deps.evaluatePolicy(events, policy);
    policyResults.push({
      policyName: result.policyName,
      verdict: result.verdict,
      exitCode: result.exitCode,
      violations: result.violations,
    });
  }

  // Step 6: Verify replay (optional) — uses unfiltered allEvents intentionally;
  // replay needs the full hash chain and complete event sequence.
  let replayResult: PipelineReplayResult | undefined;
  if (deps.verifyReplay !== undefined) {
    replayResult = await deps.verifyReplay(allEvents);
  }

  // Step 7: Compute overall exit code (max of all sub-results)
  let exitCode = 0;
  if (!hashChain.valid) {
    exitCode = Math.max(exitCode, 1);
  }
  for (const pr of policyResults) {
    exitCode = Math.max(exitCode, pr.exitCode);
  }
  if (replayResult !== undefined) {
    exitCode = Math.max(exitCode, replayResult.exitCode);
  }

  // Step 8: Generate compliance bundle (optional)
  let bundle: ComplianceBundle | undefined;
  if (options.generateBundle === true) {
    // Prefer sessionId from the original (unfiltered) trace so the bundle
    // has a meaningful identifier even when filtering removes all events.
    const sessionId = allEvents[0]?.session_id ?? events[0]?.session_id ?? "unknown";

    const bundleOpts: ComplianceBundleOptions = {
      traces: [
        {
          session_id: sessionId,
          events: [...events],
          evaluation: policyResults.length > 0 ? policyResults : undefined,
          replay_report: replayResult?.details,
        },
      ],
      ...options.bundleOptions,
    };
    bundle = generateComplianceBundle(bundleOpts);
  }

  return {
    exitCode,
    events,
    hashChain,
    stats,
    policyResults,
    replayResult,
    bundle,
  };
}

/**
 * Alias for `runEvaluationPipeline`.
 *
 * Provides a shorter name for programmatic use:
 * ```ts
 * const result = await evaluateTrace(options, deps);
 * ```
 */
export const evaluateTrace = runEvaluationPipeline;
