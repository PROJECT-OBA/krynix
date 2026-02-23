/**
 * Evaluate a single policy rule against a single TraceEvent.
 *
 * Implements all 7 match operators and dot-notation field path resolution.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { PolicyRule, PayloadCondition } from "./schema.js";

/**
 * Resolve a dot-notation field path against an object.
 *
 * @param obj - The object to traverse
 * @param path - Dot-separated field path (e.g., "arguments.path")
 * @returns The resolved value, or `undefined` if any segment is missing
 */
function resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Evaluate a single operator condition against a resolved value.
 */
function evaluateCondition(condition: PayloadCondition, value: unknown): boolean {
  switch (condition.operator) {
    case "eq":
      return value === condition.value;

    case "neq":
      return value !== undefined && value !== condition.value;

    case "in":
      return Array.isArray(condition.value) && condition.value.includes(value);

    case "not_in":
      return (
        value !== undefined && Array.isArray(condition.value) && !condition.value.includes(value)
      );

    case "matches":
      if (value === undefined || typeof condition.value !== "string") return false;
      try {
        return new RegExp(condition.value, "u").test(String(value));
      } catch {
        return false;
      }

    case "contains":
      if (value === undefined || typeof condition.value !== "string") return false;
      return String(value).includes(condition.value);

    case "exists":
      return (value !== undefined) === condition.value;

    default:
      return false;
  }
}

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
