/**
 * Shared field path resolution and condition evaluation logic.
 *
 * Used by both per-event matching (matcher.ts) and cross-event
 * sequence matching (sequence-matcher.ts).
 *
 * @module
 */

import type { PayloadCondition } from "./schema.js";

/**
 * Resolve a dot-notation field path against an object.
 *
 * @param obj - The object to traverse
 * @param path - Dot-separated field path (e.g., "arguments.path")
 * @returns The resolved value, or `undefined` if any segment is missing
 */
export function resolveFieldPath(obj: Record<string, unknown>, path: string): unknown {
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
export function evaluateCondition(condition: PayloadCondition, value: unknown): boolean {
  switch (condition.operator) {
    case "eq":
      return value === condition.value;

    case "neq":
      // A missing field (undefined) is not equal to any condition value.
      return value !== condition.value;

    case "in":
      return Array.isArray(condition.value) && condition.value.includes(value);

    case "not_in":
      // A missing field (undefined) is not in any list.
      return Array.isArray(condition.value) && !condition.value.includes(value);

    case "matches":
      if (value === undefined || typeof condition.value !== "string") return false;
      try {
        const str =
          typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
        return new RegExp(condition.value, "u").test(str);
      } catch {
        return false;
      }

    case "contains":
      if (value === undefined || typeof condition.value !== "string") return false;
      try {
        const str =
          typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
        return str.includes(condition.value);
      } catch {
        return false;
      }

    case "exists":
      return (value !== undefined) === condition.value;

    default:
      return false;
  }
}
