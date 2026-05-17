/**
 * TraceEvent type definitions for Krynix ARTL.
 *
 * All types match the schema defined in `docs/10_architecture/trace_spec.md` (v1.1.0).
 * Wire format types use string unions, not TypeScript enums.
 *
 * @module
 */

/**
 * Current schema version for all TraceEvents.
 *
 * `1.1.0` adds the optional `policy_decision` sub-shape to
 * `DecisionPayload` for the `@krynix/sdk` runtime policy path
 * (verdicts, redactions, matched rule, eval latency).
 *
 * Backward compatible at the wire level — every new field is optional,
 * so events emitted by older producers parse unchanged here. Consumers
 * doing exhaustive TypeScript switches on the verdict union (now four
 * values: `pass` / `fail` / `redact` / `require-approval`) need a
 * recompile; the soft-breaking call is documented in the root
 * CHANGELOG.
 */
export const SCHEMA_VERSION = "1.1.0" as const;

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

/**
 * Verdict emitted by the runtime SDK or trace-evaluator for a policy
 * decision. Mirrors `PolicyVerdict` in `@krynix/policy` — duplicated here
 * as a string union to keep `@krynix/core` free of internal package
 * dependencies (per `.claude/rules/architecture.md`).
 *
 * - `pass` — the call was forwarded unchanged.
 * - `fail` — the call was denied (runtime) or a CI-failing violation was
 *   recorded (trace-eval).
 * - `redact` — the request body was modified before the call was
 *   forwarded. Emitted only by the runtime SDK; the trace-evaluator
 *   treats matching `redact` rules as advisory.
 * - `require-approval` — the call was paused and submitted to a human
 *   approval queue.
 */
export type PolicyDecisionVerdict = "pass" | "fail" | "redact" | "require-approval";

/**
 * One redaction applied to the request body when a policy rule's
 * `action: "redact"` fired. Carried on a `policy_decision` so any
 * downstream audit consumer can see exactly what was scrubbed before
 * the upstream LLM / tool call.
 *
 * The string `value_redacted` is the **replacement** string that was
 * written in place of the original — never the original value. The
 * original is dropped at the SDK boundary; storing it here would
 * defeat the redaction.
 */
export interface PolicyDecisionRedaction {
  /** Dot-notation field path into the original request that was redacted. */
  path: string;
  /** Replacement string written in place of the match (e.g. `"<EMAIL>"`, `""`). */
  value_redacted: string;
}

/**
 * Fields shared by every `PolicyDecisionSubtype` variant.
 *
 * Extracted so the discriminated-union variants below don't repeat
 * `latency_ms` and `rule_id`. Not exported on its own — consumers
 * should use `PolicyDecisionSubtype` so the verdict-tagged shape is
 * enforced by the type system.
 */
interface PolicyDecisionBase {
  /**
   * ID of the matched rule.
   *
   * **Present** whenever a rule matched the event (any action — including
   * `allow`, which produces `verdict: "pass"`), and when the default-deny
   * path fired (`rule_id === "__default_deny__"`).
   *
   * **Absent** only when `verdict === "pass"` AND no rule matched. Two
   * sub-cases:
   * - the event was out-of-scope per `policy.spec.scope`, or
   * - no rule matched and `defaults.unmatched_action` was not `"deny"`.
   *
   * So `verdict === "pass"` is ambiguous on its own: `rule_id` set means
   * an explicit `allow` matched; `rule_id` absent means out-of-scope or
   * unmatched-with-no-default. SDKs that care about audit completeness
   * should record both. See `SingleEventResult.ruleId` on `@krynix/policy`.
   */
  rule_id?: string;
  /** Policy-evaluation latency in milliseconds, measured at the SDK boundary. */
  latency_ms: number;
}

/**
 * Sub-shape attached to a `decision` event when the decision was
 * produced by the runtime SDK's policy pipeline (`@krynix/sdk`'s
 * `matchSingleEvent` callsite) or by the trace-evaluator's
 * `evaluate()`.
 *
 * **Discriminated union by `verdict`.** The compiler enforces that
 * `redactions` is present iff `verdict === "redact"` — no runtime
 * check needed. The JSON schema mirrors this via `if/then/else` so
 * the wire format is enforced too. Constructed via an object literal
 * with `verdict: "redact"` requires `redactions: [...]`; constructed
 * with any other verdict forbids `redactions` (excess-property
 * check).
 *
 * Optional on `DecisionPayload` for backward compatibility — agents
 * emitting their own internal `decision` events (the original use of
 * the `decision` type) do not set it. Consumers that only want the
 * runtime policy stream can filter on its presence.
 */
export type PolicyDecisionSubtype =
  | (PolicyDecisionBase & {
      verdict: "pass" | "fail" | "require-approval";
      /**
       * Always `undefined` on non-redact variants. Marked as `never`
       * so an object literal with `verdict: "pass"` and a
       * `redactions` field fails to typecheck at construction.
       */
      redactions?: never;
    })
  | (PolicyDecisionBase & {
      verdict: "redact";
      /**
       * Redactions applied to the request body. Required on this
       * variant. Empty array is a producer bug — the JSON-schema
       * variant requires `minItems: 1`.
       */
      redactions: PolicyDecisionRedaction[];
    });

/**
 * Payload for `decision` events.
 *
 * Two distinct producers write to this type:
 *
 * 1. **Agent-internal decisions** — the agent records its own reasoning
 *    step (`action` + `reasoning` + optional `confidence` / `alternatives`).
 *    `policy_decision` is absent.
 * 2. **Runtime policy decisions** — `@krynix/sdk` records the outcome of
 *    a policy verdict produced by `matchSingleEvent`. `policy_decision`
 *    carries the verdict, matched rule, redactions, and latency;
 *    `action` mirrors the matched rule's action (or `"pass"` for an
 *    out-of-scope event) and `reasoning` carries the matched rule's
 *    message.
 *
 * The two producers share the same event type so the governance
 * dashboard's "policy decisions" view is just a filter on
 * `payload.policy_decision !== undefined`.
 */
export interface DecisionPayload {
  action: string;
  reasoning: string;
  confidence?: number;
  alternatives?: string[];
  /**
   * Present when this decision was produced by the runtime policy
   * pipeline. Absent on agent-internal decisions. See
   * `PolicyDecisionSubtype` above.
   */
  policy_decision?: PolicyDecisionSubtype;
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
