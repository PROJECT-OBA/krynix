/**
 * TraceEvent type definitions for Krynix ARTL.
 *
 * All types match the schema defined in `docs/10_architecture/trace_spec.md` (v1.0.0).
 * Wire format types use string unions, not TypeScript enums.
 *
 * @module
 */

/** Current schema version for all TraceEvents. */
export const SCHEMA_VERSION = "1.0.0" as const;

// ---------------------------------------------------------------------------
// String unions for wire-format enum values
// ---------------------------------------------------------------------------

/** The 8 event types that a TraceEvent can represent. */
export type EventType =
  | "tool_call"
  | "tool_result"
  | "llm_request"
  | "llm_response"
  | "decision"
  | "observation"
  | "error"
  | "lifecycle";

/** Approval status for tool calls gated by policy. */
export type ApprovalStatus = "auto" | "manual" | "denied";

/** Reason an LLM stopped generating a response. */
export type FinishReason = "stop" | "max_tokens" | "tool_use";

/** Lifecycle transition types within an agent session. */
export type LifecycleAction = "session_start" | "session_end" | "checkpoint";

// ---------------------------------------------------------------------------
// Payload interfaces (one per event type)
// ---------------------------------------------------------------------------

/** Payload for `tool_call` events — records an agent's invocation of a tool. */
export interface ToolCallPayload {
  tool_name: string;
  arguments: Record<string, unknown>;
  approval_status?: ApprovalStatus;
  /** Identifier of the human or system that approved this tool call. */
  approved_by?: string;
  /** Reason the approval decision was made. */
  approval_reason?: string;
}

/** Payload for `tool_result` events — records the result of a tool invocation. */
export interface ToolResultPayload {
  tool_name: string;
  output: unknown;
  exit_code?: number;
  duration_ms: number;
}

/** Payload for `llm_request` events — records a request sent to an LLM provider. */
export interface LlmRequestPayload {
  model: string;
  messages: unknown[];
  parameters: Record<string, unknown>;
}

/** Token usage stats returned by an LLM provider. */
export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  /** Estimated cost in USD for this LLM call. */
  estimated_cost?: number;
}

/** Payload for `llm_response` events — records a response from an LLM provider. */
export interface LlmResponsePayload {
  model: string;
  content: string;
  usage: LlmUsage;
  finish_reason: FinishReason;
  /** Whether this response was generated via streaming. */
  is_streaming?: boolean;
}

/** Payload for `decision` events — records an agent's internal decision. */
export interface DecisionPayload {
  action: string;
  reasoning: string;
  confidence?: number;
  alternatives?: string[];
}

/** Payload for `observation` events — records data observed from the environment. */
export interface ObservationPayload {
  source: string;
  content: unknown;
  category?: string;
}

/** Payload for `error` events — records an error encountered during execution. */
export interface ErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
}

/** Payload for `lifecycle` events — records session lifecycle transitions. */
export interface LifecyclePayload {
  action: LifecycleAction;
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Payload type map (event_type → payload interface)
// ---------------------------------------------------------------------------

/** Maps each EventType to its corresponding payload interface. */
export interface PayloadMap {
  tool_call: ToolCallPayload;
  tool_result: ToolResultPayload;
  llm_request: LlmRequestPayload;
  llm_response: LlmResponsePayload;
  decision: DecisionPayload;
  observation: ObservationPayload;
  error: ErrorPayload;
  lifecycle: LifecyclePayload;
}

// ---------------------------------------------------------------------------
// TraceEvent (discriminated union)
// ---------------------------------------------------------------------------

/**
 * Base shape shared by all TraceEvent variants.
 *
 * @typeParam T - The specific EventType string literal
 * @typeParam P - The payload interface corresponding to T
 */
export interface TraceEventBase<T extends EventType, P> {
  event_id: string;
  session_id: string;
  sequence_num: number;
  /** ISO 8601 timestamp (e.g., `"2025-01-15T14:00:00.000Z"`). */
  timestamp: string;
  event_type: T;
  parent_id: string | null;
  agent_id: string;
  payload: P;
  redacted: boolean;
  prev_hash: string;
  event_hash: string;
  metadata: Record<string, unknown> | null;
  schema_version: string;
}

/**
 * A single TraceEvent — discriminated union on `event_type`.
 *
 * Narrowing on `event_type` gives access to the correctly typed `payload`.
 *
 * @example
 * ```ts
 * if (event.event_type === "tool_call") {
 *   console.log(event.payload.tool_name); // ToolCallPayload
 * }
 * ```
 */
export type TraceEvent =
  | TraceEventBase<"tool_call", ToolCallPayload>
  | TraceEventBase<"tool_result", ToolResultPayload>
  | TraceEventBase<"llm_request", LlmRequestPayload>
  | TraceEventBase<"llm_response", LlmResponsePayload>
  | TraceEventBase<"decision", DecisionPayload>
  | TraceEventBase<"observation", ObservationPayload>
  | TraceEventBase<"error", ErrorPayload>
  | TraceEventBase<"lifecycle", LifecyclePayload>;

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

/** Result of a validation operation (hash chain, schema, golden trace). */
export interface ValidationResult {
  valid: boolean;
  brokenAt?: number;
  error?: string;
}
