/**
 * Cross-event sequence matching for policy rules.
 *
 * Detects ordered patterns of events within a sliding window.
 * For example: "agent read credentials THEN called external API."
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { SequenceMatch, SequenceStep, PayloadCondition } from "./schema.js";

/** Result of a sequence match attempt. */
export interface SequenceMatchResult {
  matched: boolean;
  /** Indices of the events that formed the complete match. */
  matchedEventIndices: number[];
}

/**
 * Resolve a dot-notation field path against an object.
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
 * (Mirrors matcher.ts logic — kept local to avoid circular dependency.)
 */
function evaluateCondition(condition: PayloadCondition, value: unknown): boolean {
  switch (condition.operator) {
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(value);
    case "not_in":
      return Array.isArray(condition.value) && !condition.value.includes(value);
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
 * Check whether a single event matches a sequence step.
 */
function matchStep(event: TraceEvent, step: SequenceStep): boolean {
  if (step.event_type !== undefined && event.event_type !== step.event_type) {
    return false;
  }

  const payload = event.payload as unknown as Record<string, unknown>;

  for (const condition of step.payload) {
    const value = resolveFieldPath(payload, condition.field);
    if (!evaluateCondition(condition, value)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluate a sequence match against a full trace.
 *
 * Scans the trace in order. For each step in the sequence, finds the next
 * event (after the previous match) that satisfies the step. If all steps
 * are matched within the window, the sequence matches.
 *
 * @param trace - The full ordered trace
 * @param sequence - The sequence pattern to match
 * @returns Match result with indices of matched events
 */
export function evaluateSequence(
  trace: readonly TraceEvent[],
  sequence: SequenceMatch,
): SequenceMatchResult {
  const steps = sequence.steps;
  if (steps.length === 0) {
    return { matched: false, matchedEventIndices: [] };
  }

  // Try each possible starting position for the first step
  for (let startIdx = 0; startIdx < trace.length; startIdx++) {
    const event = trace[startIdx];
    const firstStep = steps[0];
    if (event === undefined || firstStep === undefined || !matchStep(event, firstStep)) {
      continue;
    }

    // Found a match for step 0 — try to complete the sequence
    const matchedIndices = [startIdx];
    let searchFrom = startIdx + 1;
    let allMatched = true;

    for (let stepIdx = 1; stepIdx < steps.length; stepIdx++) {
      let found = false;
      const step = steps[stepIdx];
      if (step === undefined) break;

      for (let eventIdx = searchFrom; eventIdx < trace.length; eventIdx++) {
        // Window check: distance from first match
        if (sequence.window !== undefined && eventIdx - startIdx > sequence.window) {
          break;
        }

        const candidate = trace[eventIdx];
        if (candidate !== undefined && matchStep(candidate, step)) {
          matchedIndices.push(eventIdx);
          searchFrom = eventIdx + 1;
          found = true;
          break;
        }
      }

      if (!found) {
        allMatched = false;
        break;
      }
    }

    if (allMatched) {
      return { matched: true, matchedEventIndices: matchedIndices };
    }
  }

  return { matched: false, matchedEventIndices: [] };
}
