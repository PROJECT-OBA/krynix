/**
 * Trace event filtering — subset events by type, agent, session, time range,
 * and field-level inclusion/exclusion with glob support.
 *
 * Pure function with AND logic across all criteria.
 *
 * @module
 */

import type { TraceEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Criteria for filtering trace events. All fields are optional; when
 *  multiple are provided they are combined with AND logic. */
export interface TraceFilterCriteria {
  /** Include only events whose `event_type` is in this list. */
  event_types?: string[];
  /** Include only events whose `agent_id` is in this list. */
  agent_ids?: string[];
  /** Include only events whose `session_id` is in this list. */
  session_ids?: string[];
  /** Include only events at or after this ISO-8601 timestamp (inclusive). */
  after?: string;
  /** Include only events at or before this ISO-8601 timestamp (inclusive). */
  before?: string;
  /**
   * Field-level inclusion filter. Glob patterns matching dot-notation payload
   * paths. Only matched fields are kept in the event payload.
   *
   * Supports `*` (single segment) and `**` (any depth).
   * Example: `["tool_name", "arguments.*"]`
   */
  include_fields?: string[];
  /**
   * Field-level exclusion filter. Glob patterns matching dot-notation payload
   * paths. Matched fields are removed from the event payload.
   *
   * Applied after `include_fields` (if both are set).
   * Example: `["arguments.password", "usage.**"]`
   */
  exclude_fields?: string[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Filter trace events by the given criteria.
 *
 * - Empty or undefined criteria returns a shallow copy of the input.
 * - Multiple criteria are combined with AND logic.
 * - Time range uses inclusive bounds (`>=` after, `<=` before).
 * - Field-level filters apply to event payloads (include_fields first,
 *   then exclude_fields). Events are shallow-cloned when field filters apply.
 * - Does NOT mutate the input array or events.
 *
 * @throws {Error} If `after` or `before` is an unparseable date string.
 */
export function filterTraceEvents(
  events: readonly TraceEvent[],
  criteria: TraceFilterCriteria = {},
): TraceEvent[] {
  // Parse and validate time bounds up front
  let afterMs: number | undefined;
  let beforeMs: number | undefined;

  if (criteria.after !== undefined) {
    afterMs = new Date(criteria.after).getTime();
    if (isNaN(afterMs)) {
      throw new Error(`Invalid 'after' date: ${criteria.after}`);
    }
  }

  if (criteria.before !== undefined) {
    beforeMs = new Date(criteria.before).getTime();
    if (isNaN(beforeMs)) {
      throw new Error(`Invalid 'before' date: ${criteria.before}`);
    }
  }

  // Build fast lookup sets for list-based filters
  const typeSet =
    criteria.event_types != null && criteria.event_types.length > 0
      ? new Set(criteria.event_types)
      : undefined;

  const agentSet =
    criteria.agent_ids != null && criteria.agent_ids.length > 0
      ? new Set(criteria.agent_ids)
      : undefined;

  const sessionSet =
    criteria.session_ids != null && criteria.session_ids.length > 0
      ? new Set(criteria.session_ids)
      : undefined;

  const hasFieldFilters =
    (criteria.include_fields != null && criteria.include_fields.length > 0) ||
    (criteria.exclude_fields != null && criteria.exclude_fields.length > 0);

  let result = events.filter((event) => {
    if (typeSet !== undefined && !typeSet.has(event.event_type)) return false;
    if (agentSet !== undefined && !agentSet.has(event.agent_id)) return false;
    if (sessionSet !== undefined && !sessionSet.has(event.session_id)) return false;

    if (afterMs !== undefined || beforeMs !== undefined) {
      const ts = new Date(event.timestamp).getTime();
      // Exclude events with unparseable timestamps when time filtering is active
      if (isNaN(ts)) return false;
      if (afterMs !== undefined && ts < afterMs) return false;
      if (beforeMs !== undefined && ts > beforeMs) return false;
    }

    return true;
  });

  // Apply field-level filtering to payloads
  if (hasFieldFilters) {
    result = result.map((event) => {
      const payload = event.payload;
      if (payload === null || payload === undefined || typeof payload !== "object") {
        return event;
      }

      let filtered = payload as unknown as Record<string, unknown>;

      if (criteria.include_fields != null && criteria.include_fields.length > 0) {
        filtered = pickFields(filtered, criteria.include_fields);
      }

      if (criteria.exclude_fields != null && criteria.exclude_fields.length > 0) {
        filtered = omitFields(filtered, criteria.exclude_fields);
      }

      return { ...event, payload: filtered } as unknown as TraceEvent;
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Field filtering helpers
// ---------------------------------------------------------------------------

/**
 * Keep only fields matching at least one of the given glob patterns.
 */
function pickFields(obj: Record<string, unknown>, patterns: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const paths = flattenPaths(obj);

  for (const [path, value] of paths) {
    if (patterns.some((p) => matchFieldGlob(p, path))) {
      setNestedValue(result, path, value);
    }
  }

  return result;
}

/**
 * Remove fields matching any of the given glob patterns.
 */
function omitFields(obj: Record<string, unknown>, patterns: string[]): Record<string, unknown> {
  const paths = flattenPaths(obj);
  const result: Record<string, unknown> = {};

  for (const [path, value] of paths) {
    if (!patterns.some((p) => matchFieldGlob(p, path))) {
      setNestedValue(result, path, value);
    }
  }

  return result;
}

/**
 * Flatten an object into an array of [dotPath, leafValue] pairs.
 *
 * Example: `{ a: { b: 1, c: 2 } }` → `[["a.b", 1], ["a.c", 2]]`
 */
function flattenPaths(obj: Record<string, unknown>, prefix = ""): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];

  for (const key of Object.keys(obj)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const val = obj[key];

    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      entries.push(...flattenPaths(val as Record<string, unknown>, path));
    } else {
      entries.push([path, val]);
    }
  }

  return entries;
}

/**
 * Set a value at a dot-notation path, creating intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i] as string;
    if (current[key] === undefined || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = parts[parts.length - 1] as string;
  current[lastKey] = value;
}

/**
 * Match a dot-notation field path against a glob pattern.
 *
 * Supported patterns:
 * - Exact match: `"tool_name"` matches `"tool_name"`
 * - Single-segment wildcard: `"arguments.*"` matches `"arguments.path"` but not `"arguments.nested.deep"`
 * - Recursive wildcard: `"usage.**"` matches `"usage.tokens"` and `"usage.nested.deep"`
 * - Mixed: `"a.*.c"` matches `"a.b.c"` but not `"a.b.d"` or `"a.b.x.c"`
 *
 * Literal (no-wildcard) patterns also match descendant paths:
 * pattern `"arguments"` matches path `"arguments.path"` (selecting a parent
 * selects all children). Wildcard patterns do NOT get this behavior — use
 * `**` explicitly for recursive matching.
 */
export function matchFieldGlob(pattern: string, path: string): boolean {
  const patternParts = pattern.split(".");
  const pathParts = path.split(".");

  // Standard glob match (exact length or ** consumption)
  if (matchParts(patternParts, 0, pathParts, 0)) return true;

  // Literal prefix match: "arguments" matches "arguments.path.deep"
  // Only applies when the pattern contains no wildcards and is a strict prefix.
  if (!pattern.includes("*") && pathParts.length > patternParts.length) {
    return patternParts.every((seg, i) => seg === pathParts[i]);
  }

  return false;
}

function matchParts(pattern: string[], pi: number, path: string[], xi: number): boolean {
  // Both exhausted — exact match
  if (pi === pattern.length && xi === path.length) return true;

  // Pattern exhausted but path continues — no match (parent rule handled in matchFieldGlob)
  if (pi === pattern.length) return false;

  // Path exhausted but pattern continues — no match
  if (xi === path.length) return false;

  const seg = pattern[pi] as string;

  if (seg === "**") {
    // ** matches zero or more segments
    for (let skip = xi; skip <= path.length; skip++) {
      if (matchParts(pattern, pi + 1, path, skip)) return true;
    }
    return false;
  }

  if (seg === "*") {
    // * matches exactly one segment
    return matchParts(pattern, pi + 1, path, xi + 1);
  }

  // Literal match
  if (seg === path[xi]) {
    return matchParts(pattern, pi + 1, path, xi + 1);
  }

  return false;
}
