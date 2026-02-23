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

/** Complete evaluation result. */
export interface EvaluationResult {
  verdict: PolicyVerdict;
  exitCode: number;
  violations: Violation[];
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

  for (const [eventIndex, event] of trace.entries()) {
    // Scope filtering: skip events outside scope
    if (!isInScope(event, scope.agents, scope.event_types)) {
      continue;
    }

    // First-match-wins: find the first matching rule
    const matchedRule = findMatchingRule(event, policy.spec.rules);

    if (matchedRule !== undefined) {
      if (matchedRule.action === "deny" || matchedRule.action === "require-approval") {
        violations.push({
          ruleId: matchedRule.id,
          eventIndex,
          eventId: event.event_id,
          action: matchedRule.action,
          severity: matchedRule.severity,
          message: matchedRule.message,
          ciFailure: resolveCiFailure(matchedRule),
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
        ciFailure: false, // unmatched_severity is always info or warning
      });
    }
  }

  return buildResult(violations);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isInScope(event: TraceEvent, agents: string[], eventTypes: string[]): boolean {
  const agentMatch = agents.includes("*") || agents.includes(event.agent_id);
  const typeMatch = eventTypes.includes("*") || eventTypes.includes(event.event_type);
  return agentMatch && typeMatch;
}

function findMatchingRule(event: TraceEvent, rules: readonly PolicyRule[]): PolicyRule | undefined {
  for (const rule of rules) {
    if (matchRule(event, rule)) {
      return rule;
    }
  }
  return undefined;
}

function resolveCiFailure(rule: PolicyRule): boolean {
  if (rule.ci_failure !== undefined) {
    return rule.ci_failure;
  }
  // Default: error and critical cause CI failure; info and warning do not
  return rule.severity === "error" || rule.severity === "critical";
}

function buildResult(violations: Violation[]): EvaluationResult {
  if (violations.length === 0) {
    return { verdict: "pass", exitCode: 0, violations };
  }

  const hasRequireApproval = violations.some((v) => v.action === "require-approval");
  const ciViolations = violations.filter((v) => v.ciFailure);

  if (ciViolations.length === 0 && !hasRequireApproval) {
    return { verdict: "pass", exitCode: 0, violations };
  }

  if (hasRequireApproval && ciViolations.length === 0) {
    return { verdict: "require-approval", exitCode: 3, violations };
  }

  // CI failures take precedence over require-approval when both are present.
  // Determine exit code from highest severity among CI-failing violations.
  const hasCritical = ciViolations.some((v) => v.severity === "critical");
  const exitCode = hasCritical ? 2 : 1;

  return { verdict: "fail", exitCode, violations };
}
