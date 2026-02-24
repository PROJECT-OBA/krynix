/**
 * Trace analytics — compute per-session metrics from a trace.
 *
 * Implements the per-session metrics defined in `observability.md`:
 * event counts, duration, tool call count, LLM request count,
 * error count, token usage, and per-type breakdown.
 *
 * @module
 */

import type { TraceEvent, LifecyclePayload, LlmResponsePayload } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-session analytics computed from a trace. */
export interface TraceStats {
  /** Total number of events in the trace. */
  event_count: number;

  /** Wall-clock duration in ms (session_end.timestamp - session_start.timestamp). null if missing lifecycle events. */
  duration_ms: number | null;

  /** Count of tool_call events. */
  tool_call_count: number;

  /** Count of llm_request events. */
  llm_request_count: number;

  /** Count of error events. */
  error_count: number;

  /** Sum of prompt_tokens + completion_tokens from all llm_response events. null if no llm_response events. */
  total_token_usage: number | null;

  /** Breakdown of event counts by event_type. */
  event_type_counts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// All event types for initializing counts
// ---------------------------------------------------------------------------

const ALL_EVENT_TYPES = [
  "tool_call",
  "tool_result",
  "llm_request",
  "llm_response",
  "decision",
  "observation",
  "error",
  "lifecycle",
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute per-session analytics from a trace.
 *
 * Pure function — does not modify the input or perform I/O.
 *
 * @param trace - Array of TraceEvents (may be empty)
 * @returns Computed analytics; null fields indicate missing data (not errors)
 */
export function computeTraceStats(trace: readonly TraceEvent[]): TraceStats {
  const eventTypeCounts: Record<string, number> = {};
  for (const t of ALL_EVENT_TYPES) {
    eventTypeCounts[t] = 0;
  }

  let sessionStartTimestamp: string | null = null;
  let sessionEndTimestamp: string | null = null;
  let tokenUsageSum = 0;
  let hasLlmResponse = false;

  for (const event of trace) {
    // Count by type
    eventTypeCounts[event.event_type] = (eventTypeCounts[event.event_type] ?? 0) + 1;

    // Extract lifecycle timestamps (first start, last end)
    if (event.event_type === "lifecycle") {
      const payload = event.payload as LifecyclePayload;
      if (payload.action === "session_start" && sessionStartTimestamp === null) {
        sessionStartTimestamp = event.timestamp;
      } else if (payload.action === "session_end") {
        sessionEndTimestamp = event.timestamp;
      }
    }

    // Sum token usage from llm_response events
    if (event.event_type === "llm_response") {
      hasLlmResponse = true;
      const payload = event.payload as LlmResponsePayload;
      tokenUsageSum += payload.usage.prompt_tokens + payload.usage.completion_tokens;
    }
  }

  // Compute duration
  let durationMs: number | null = null;
  if (sessionStartTimestamp !== null && sessionEndTimestamp !== null) {
    const start = new Date(sessionStartTimestamp).getTime();
    const end = new Date(sessionEndTimestamp).getTime();
    durationMs = end - start;
  }

  return {
    event_count: trace.length,
    duration_ms: durationMs,
    tool_call_count: eventTypeCounts["tool_call"] ?? 0,
    llm_request_count: eventTypeCounts["llm_request"] ?? 0,
    error_count: eventTypeCounts["error"] ?? 0,
    total_token_usage: hasLlmResponse ? tokenUsageSum : null,
    event_type_counts: eventTypeCounts,
  };
}
