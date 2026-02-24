/**
 * Event comparator for divergence detection between trace sequences.
 *
 * Compares two arrays of TraceEvents element-by-element to find the first
 * point of divergence. Used by the replay engine to detect behavioral
 * regressions against golden traces.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { DivergenceReport, FieldDiff, DivergencePoint } from "./types.js";

/**
 * Compare two trace event sequences and report the first divergence.
 *
 * Compares `event_type`, `payload`, and `agent_id` at each index.
 * Ignores derived/non-deterministic fields: `event_hash`, `prev_hash`,
 * `timestamp`, `event_id`, `metadata`.
 *
 * @param expected - The golden/reference trace events
 * @param actual - The replay/new trace events
 * @returns A report indicating whether traces match or where they diverge
 */
export function compareTraces(
  expected: readonly TraceEvent[],
  actual: readonly TraceEvent[],
): DivergenceReport {
  const minLen = Math.min(expected.length, actual.length);

  for (let i = 0; i < minLen; i++) {
    const exp = expected[i] as TraceEvent;
    const act = actual[i] as TraceEvent;

    const diffs: FieldDiff[] = [];

    if (exp.event_type !== act.event_type) {
      diffs.push({
        field: "event_type",
        expected: exp.event_type,
        actual: act.event_type,
      });
    }

    if (exp.agent_id !== act.agent_id) {
      diffs.push({
        field: "agent_id",
        expected: exp.agent_id,
        actual: act.agent_id,
      });
    }

    const payloadDiffs = deepCompare(exp.payload, act.payload, "payload");
    diffs.push(...payloadDiffs);

    if (diffs.length > 0) {
      return {
        status: "diverged",
        firstDivergence: {
          sequenceNum: i,
          expected: { eventType: exp.event_type, payload: exp.payload },
          actual: { eventType: act.event_type, payload: act.payload },
          diffs,
        },
        totalEvents: expected.length,
        eventsBeforeDivergence: i,
      };
    }
  }

  // Length mismatch
  if (expected.length !== actual.length) {
    const divergeAt = minLen;
    const expEvent = expected[divergeAt];
    const actEvent = actual[divergeAt];
    const point: DivergencePoint = {
      sequenceNum: divergeAt,
      expected: {
        eventType: expEvent ? expEvent.event_type : "<missing>",
        payload: expEvent ? expEvent.payload : null,
      },
      actual: {
        eventType: actEvent ? actEvent.event_type : "<missing>",
        payload: actEvent ? actEvent.payload : null,
      },
      diffs: [
        {
          field: "length",
          expected: expected.length,
          actual: actual.length,
        },
      ],
    };

    return {
      status: "diverged",
      firstDivergence: point,
      totalEvents: expected.length,
      eventsBeforeDivergence: minLen,
    };
  }

  return {
    status: "pass",
    totalEvents: expected.length,
    eventsBeforeDivergence: expected.length,
  };
}

/**
 * Recursively compare two values and collect field-level diffs.
 */
function deepCompare(expected: unknown, actual: unknown, path: string): FieldDiff[] {
  if (expected === actual) return [];

  // Null/undefined checks
  if (expected === null || expected === undefined || actual === null || actual === undefined) {
    if (expected !== actual) {
      return [{ field: path, expected, actual }];
    }
    return [];
  }

  // Primitive types
  if (typeof expected !== "object" || typeof actual !== "object") {
    if (expected !== actual) {
      return [{ field: path, expected, actual }];
    }
    return [];
  }

  // Array comparison
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const diffs: FieldDiff[] = [];
    const maxLen = Math.max(expected.length, actual.length);

    for (let i = 0; i < maxLen; i++) {
      if (i >= expected.length || i >= actual.length) {
        diffs.push({
          field: `${path}[${String(i)}]`,
          expected: i < expected.length ? (expected[i] as unknown) : undefined,
          actual: i < actual.length ? (actual[i] as unknown) : undefined,
        });
      } else {
        diffs.push(...deepCompare(expected[i], actual[i], `${path}[${String(i)}]`));
      }
    }
    return diffs;
  }

  // One is array, other is not
  if (Array.isArray(expected) !== Array.isArray(actual)) {
    return [{ field: path, expected, actual }];
  }

  // Object comparison
  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(expObj), ...Object.keys(actObj)]);
  const diffs: FieldDiff[] = [];

  for (const key of allKeys) {
    diffs.push(...deepCompare(expObj[key], actObj[key], `${path}.${key}`));
  }

  return diffs;
}
