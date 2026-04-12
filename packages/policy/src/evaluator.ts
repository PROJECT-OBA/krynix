/**
 * Policy evaluation engine.
 *
 * Evaluates a trace (array of TraceEvents) against a Policy to produce
 * an EvaluationResult with a verdict, exit code, and list of violations.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { Policy, PolicyRule, Severity } from "./schema.js";
import { matchRule } from "./matcher.js";
import { evaluateSequence } from "./sequence-matcher.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Overall evaluation verdict. */
export type PolicyVerdict = "pass" | "fail" | "require-approval";

/** A single violation produced by a matching deny/require-approval rule. */
export interface Violation {
  ruleId: string;
  eventIndex: number;
  eventId: string;
  action: string;
  severity: Severity;
  message: string;
  ciFailure: boolean;
}

/**
 * Stable machine-readable codes emitted by `evaluate()`.
 *
 * Filter on these values rather than warning messages (message text is not
 * guaranteed stable across versions).
 */
export type PolicyWarningCode =
  /** `on_violation.notify` is parsed but notification delivery is not yet implemented. */
  | "ON_VIOLATION_NOTIFY_NOT_IMPLEMENTED"
  /** `on_violation.create_issue` is parsed but issue creation is not yet implemented. */
  | "ON_VIOLATION_ISSUE_NOT_IMPLEMENTED"
  /**
   * A rule's match predicate never satisfied any in-scope event (per-event
   * rules) or never matched its sequence pattern across the trace (sequence
   * rules). The most common cause is a typo in `match.payload` conditions or
   * a scope filter that excludes every event the rule was meant to cover.
   */
  | "RULE_NEVER_MATCHED";

/**
 * A structured evaluation warning.
 *
 * Warnings are diagnostic signals surfaced alongside the pass/fail verdict;
 * they never affect `verdict` or `exitCode`. They exist to catch
 * silent-failure modes like typo'd rule IDs that would otherwise pass CI
 * with false confidence. Each warning has a stable machine-readable `code`
 * so CLI / CI tooling can filter on it.
 */
export interface PolicyWarning {
  /** Stable machine-readable identifier — see `PolicyWarningCode` for known values. */
  code: PolicyWarningCode;
  /** Human-readable explanation. Stable text is not guaranteed; filter on `code` instead. */
  message: string;
  /** ID of the rule the warning relates to, when applicable. */
  ruleId?: string;
}

/** Complete evaluation result. */
export interface EvaluationResult {
  verdict: PolicyVerdict;
  exitCode: number;
  violations: Violation[];
  warnings: PolicyWarning[];
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a trace against a policy.
 *
 * Uses first-match-wins: for each event, the first matching rule determines
 * the outcome. Events outside the policy scope are skipped entirely.
 *
 * @param trace - Array of TraceEvents to evaluate
 * @param policy - The policy to evaluate against
 * @returns Evaluation result with verdict, exit code, and violations
 */
export function evaluate(trace: readonly TraceEvent[], policy: Policy): EvaluationResult {
  const violations: Violation[] = [];
  const scope = policy.spec.scope;
  const defaults = policy.spec.defaults;

  // Collect warnings for on_violation fields that are parsed but not yet implemented
  const warnings = collectOnViolationWarnings(policy.spec.rules);

  // Track which rules had their predicate satisfied by at least one in-scope
  // event (per-event rules) or matched their sequence pattern (sequence rules).
  // Used to emit `RULE_NEVER_MATCHED` diagnostics at the end of evaluation.
  //
  // IMPORTANT: this uses predicate-level matching, not the first-match-wins
  // winner. If rule A (at position 0) and rule B (at position 1) both match
  // the same event, only A triggers a violation — but BOTH A and B are added
  // to `matchedRuleIds`. Without this distinction, rule B would receive a
  // false-positive `RULE_NEVER_MATCHED` warning even though its predicate is
  // working correctly and is merely shadowed by A.
  const matchedRuleIds = new Set<string>();

  for (const [eventIndex, event] of trace.entries()) {
    // Scope filtering: skip events outside scope
    if (!isInScope(event, scope.agents, scope.event_types)) {
      continue;
    }

    // Single pass: evaluate every per-event rule's predicate, recording ALL
    // matches into matchedRuleIds (for the RULE_NEVER_MATCHED diagnostic) and
    // remembering the first match for first-match-wins violation logic.
    const firstMatch = findMatchingRuleAndTrackAll(event, policy.spec.rules, matchedRuleIds);

    if (firstMatch !== undefined) {
      if (firstMatch.action === "deny" || firstMatch.action === "require-approval") {
        violations.push({
          ruleId: firstMatch.id,
          eventIndex,
          eventId: event.event_id,
          action: firstMatch.action,
          severity: firstMatch.severity,
          message: firstMatch.message,
          ciFailure: resolveCiFailure(firstMatch),
        });
      }
      // "allow" → no violation
    } else if (defaults?.unmatched_action === "deny") {
      // Default deny for unmatched in-scope events
      const severity = defaults.unmatched_severity ?? "warning";
      violations.push({
        ruleId: "__default_deny__",
        eventIndex,
        eventId: event.event_id,
        action: "deny",
        severity,
        message: `No rule matched event; default action is deny`,
        ciFailure: false, // unmatched_severity is restricted to "info" | "warning" by schema
      });
    }
  }

  // Evaluate sequence rules (cross-event patterns). Sequence rule matches are
  // tracked inline so they also participate in the never-matched diagnostic.
  evaluateSequenceRules(trace, policy.spec.rules, violations, scope, matchedRuleIds);

  // Emit RULE_NEVER_MATCHED for every rule that didn't fire. Additive — the
  // verdict and exit code are unchanged; warnings surface in CLI output.
  warnings.push(...collectNeverMatchedWarnings(policy.spec.rules, matchedRuleIds));

  return buildResult(violations, warnings);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInScope(event: TraceEvent, agents: string[], eventTypes: string[]): boolean {
  const agentMatch = agents.includes("*") || agents.includes(event.agent_id);
  const typeMatch = eventTypes.includes("*") || eventTypes.includes(event.event_type);
  return agentMatch && typeMatch;
}

/**
 * Single-pass rule evaluation: iterates all per-event rules (skipping sequence
 * rules), records every predicate match into `matchedRuleIds` for the
 * RULE_NEVER_MATCHED diagnostic, and returns the first matching rule for
 * first-match-wins violation logic.
 *
 * Optimisation: rules already in `matchedRuleIds` skip the diagnostic
 * predicate evaluation (they can't become "never-matched" regardless of
 * this event). They still participate in the first-match-wins check, but
 * only while `firstMatch` is undefined.
 */
function findMatchingRuleAndTrackAll(
  event: TraceEvent,
  rules: readonly PolicyRule[],
  matchedRuleIds: Set<string>,
): PolicyRule | undefined {
  let firstMatch: PolicyRule | undefined;
  for (const rule of rules) {
    if (rule.match.sequence !== undefined) continue;

    // Already known to have matched a prior event — skip predicate work.
    // We still need to check for first-match-wins, but only if we haven't
    // found one yet (rules are ordered, so the first match is always the
    // earliest rule whose predicate matches).
    if (matchedRuleIds.has(rule.id)) {
      if (firstMatch === undefined && matchRule(event, rule)) {
        firstMatch = rule;
      }
      continue;
    }

    if (matchRule(event, rule)) {
      matchedRuleIds.add(rule.id);
      if (firstMatch === undefined) {
        firstMatch = rule;
      }
    }
  }
  return firstMatch;
}

function resolveCiFailure(rule: PolicyRule): boolean {
  if (rule.ci_failure !== undefined) {
    return rule.ci_failure;
  }
  // Default: error and critical cause CI failure; info and warning do not
  return rule.severity === "error" || rule.severity === "critical";
}

function evaluateSequenceRules(
  trace: readonly TraceEvent[],
  rules: readonly PolicyRule[],
  violations: Violation[],
  scope: { agents: string[]; event_types: string[] },
  matchedRuleIds: Set<string>,
): void {
  // Fast path: skip building the scoped trace when no sequence rules exist.
  if (!rules.some((r) => r.match.sequence !== undefined)) return;

  // Build scoped trace once, keeping a parallel array of original indices so
  // violation reports reference positions in the full trace, not the filtered slice.
  const originalIndices: number[] = [];
  const scopedTrace: TraceEvent[] = [];
  for (let i = 0; i < trace.length; i++) {
    const ev = trace[i];
    if (ev !== undefined && isInScope(ev, scope.agents, scope.event_types)) {
      originalIndices.push(i);
      scopedTrace.push(ev);
    }
  }

  for (const rule of rules) {
    if (rule.match.sequence === undefined) continue;

    const result = evaluateSequence(scopedTrace, rule.match.sequence);
    if (!result.matched) continue;
    matchedRuleIds.add(rule.id);

    // Map the first matched scoped index back to the original trace position.
    const firstScopedIdx = result.matchedEventIndices[0] ?? 0;
    const firstOriginalIdx = originalIndices[firstScopedIdx] ?? firstScopedIdx;
    const firstEvent = scopedTrace[firstScopedIdx];

    if (rule.action === "deny" || rule.action === "require-approval") {
      violations.push({
        ruleId: rule.id,
        eventIndex: firstOriginalIdx,
        eventId: firstEvent?.event_id ?? "unknown",
        action: rule.action,
        severity: rule.severity,
        message: rule.message,
        ciFailure: resolveCiFailure(rule),
      });
    }
  }
}

function collectOnViolationWarnings(rules: readonly PolicyRule[]): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];
  const warned = new Set<string>();

  for (const rule of rules) {
    if (rule.on_violation === undefined) continue;

    if (
      rule.on_violation.notify !== undefined &&
      rule.on_violation.notify.length > 0 &&
      !warned.has(`notify:${rule.id}`)
    ) {
      warned.add(`notify:${rule.id}`);
      warnings.push({
        code: "ON_VIOLATION_NOTIFY_NOT_IMPLEMENTED",
        ruleId: rule.id,
        message: `Rule '${rule.id}' defines on_violation.notify but notification delivery is not yet implemented (PLANNED). If this rule triggers a violation, the violation will still be recorded.`,
      });
    }

    if (rule.on_violation.create_issue === true && !warned.has(`issue:${rule.id}`)) {
      warned.add(`issue:${rule.id}`);
      warnings.push({
        code: "ON_VIOLATION_ISSUE_NOT_IMPLEMENTED",
        ruleId: rule.id,
        message: `Rule '${rule.id}' defines on_violation.create_issue but issue creation is not yet implemented (PLANNED). If this rule triggers a violation, the violation will still be recorded.`,
      });
    }
  }

  return warnings;
}

/**
 * Emit a `RULE_NEVER_MATCHED` warning for any rule that never fired during
 * evaluation.
 *
 * For per-event rules: "never fired" means the rule's match predicate
 * satisfied zero in-scope events across the entire trace. For sequence rules:
 * "never fired" means the multi-event pattern was never completed.
 *
 * The most common failure mode this catches: a rule whose `match.payload`
 * field has a typo (`tool_nam` instead of `tool_name`), or whose scope
 * excludes every event it was meant to cover. Without this diagnostic, such
 * a rule silently short-circuits and the policy passes with false confidence.
 *
 * Purely additive — does not change the verdict or exit code.
 */
function collectNeverMatchedWarnings(
  rules: readonly PolicyRule[],
  matchedRuleIds: ReadonlySet<string>,
): PolicyWarning[] {
  const warnings: PolicyWarning[] = [];
  for (const rule of rules) {
    if (matchedRuleIds.has(rule.id)) continue;
    const isSequence = rule.match.sequence !== undefined;
    const detail = isSequence
      ? "matched the sequence pattern zero times across the trace"
      : "matched zero in-scope events";
    warnings.push({
      code: "RULE_NEVER_MATCHED",
      ruleId: rule.id,
      message: `Rule '${rule.id}' ${detail}. This usually means a typo in match conditions, a scope filter that excludes the intended events, or that the rule is genuinely unused. Verify intent before shipping.`,
    });
  }
  return warnings;
}

function buildResult(violations: Violation[], warnings: PolicyWarning[] = []): EvaluationResult {
  if (violations.length === 0) {
    return { verdict: "pass", exitCode: 0, violations, warnings };
  }

  const hasRequireApproval = violations.some((v) => v.action === "require-approval");
  const ciViolations = violations.filter((v) => v.ciFailure);

  if (ciViolations.length === 0 && !hasRequireApproval) {
    return { verdict: "pass", exitCode: 0, violations, warnings };
  }

  if (hasRequireApproval && ciViolations.length === 0) {
    return { verdict: "require-approval", exitCode: 3, violations, warnings };
  }

  // CI failures take precedence over require-approval when both are present.
  // Determine exit code from highest severity among CI-failing violations.
  const hasCritical = ciViolations.some((v) => v.severity === "critical");
  const exitCode = hasCritical ? 2 : 1;

  return { verdict: "fail", exitCode, violations, warnings };
}
