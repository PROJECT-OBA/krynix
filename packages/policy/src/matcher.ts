/**
 * Evaluate a single policy rule against a single TraceEvent.
 *
 * Implements all 7 match operators and dot-notation field path resolution.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { PolicyRule } from "./schema.js";
import { resolveFieldPath, evaluateCondition } from "./condition-utils.js";

/**
 * Check whether a TraceEvent matches a policy rule.
 *
 * @param event - The TraceEvent to evaluate
 * @param rule - The policy rule to match against
 * @returns `true` if the event matches all conditions in the rule
 */
export function matchRule(event: TraceEvent, rule: PolicyRule): boolean {
  // Check event_type filter if present
  if (rule.match.event_type !== undefined && event.event_type !== rule.match.event_type) {
    return false;
  }

  // All payload conditions must match (AND logic)
  const payload = event.payload as unknown as Record<string, unknown>;

  for (const condition of rule.match.payload) {
    const value = resolveFieldPath(payload, condition.field);
    if (!evaluateCondition(condition, value)) {
      return false;
    }
  }

  return true;
}
