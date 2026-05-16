/**
 * Policy type definitions for Krynix ARTL.
 *
 * All types match the schema defined in `docs/10_architecture/policy_spec.md` (krynix.dev/v1).
 * Wire format types use string unions, not TypeScript enums.
 *
 * @module
 */

/** The only supported API version. */
export const POLICY_API_VERSION = "krynix.dev/v1" as const;

/** The only supported kind. */
export const POLICY_KIND = "Policy" as const;

// ---------------------------------------------------------------------------
// String unions for wire-format values
// ---------------------------------------------------------------------------

/**
 * Actions a policy rule can take on a matching event.
 *
 * - `allow` — forward the call unchanged.
 * - `deny` — block the call. Runtime SDK throws `PolicyDenied`.
 * - `redact` — forward the call after applying the rule's `redactions[]` to
 *   the request body. Advisory at trace-evaluation time (no CI failure).
 * - `require-approval` — pause the call. Runtime SDK submits an approval row
 *   to ingest and polls until resolved (or `on_timeout` fires).
 *
 * `allow` / `deny` / `require-approval` are also valid at trace-evaluation
 * time (CI / compliance bundle path). `redact` is purely a runtime concept;
 * the trace-evaluator treats it like `allow` (no violation).
 */
export type PolicyAction = "allow" | "deny" | "redact" | "require-approval";

/**
 * A single redaction directive attached to a `redact` rule.
 *
 * The runtime SDK applies redactions in order to the request body before
 * forwarding the upstream LLM / tool call. `pattern` is an ECMAScript
 * RegExp (per ADR-0002) matched against the resolved field value.
 * `replacement` defaults to `"<REDACTED>"` when omitted.
 */
export interface Redaction {
  /** Dot-notation field path into the event payload (e.g. `messages[*].content`). */
  path: string;
  /** ECMAScript regex matched against the resolved field value. Optional — when omitted the full value is replaced. */
  pattern?: string;
  /** String written in place of each match. Defaults to `"<REDACTED>"`. */
  replacement?: string;
}

/** Severity levels for policy violations. */
export type Severity = "info" | "warning" | "error" | "critical";

/** Operators for payload condition matching. */
export type MatchOperator = "eq" | "neq" | "in" | "not_in" | "matches" | "contains" | "exists";

// ---------------------------------------------------------------------------
// Policy structure
// ---------------------------------------------------------------------------

/** Escalation configuration triggered on policy violations. */
export interface OnViolation {
  notify?: string[];
  create_issue?: boolean;
}

/** A single condition matching a payload field. */
export interface PayloadCondition {
  field: string;
  operator: MatchOperator;
  value: unknown;
}

/** A single step in a sequence match — matches one event in the sequence. */
export interface SequenceStep {
  event_type?: string;
  payload: PayloadCondition[];
}

/** Sequence match: ordered pattern of events within a window. */
export interface SequenceMatch {
  steps: SequenceStep[];
  /** Maximum index distance between the first and last matched events (default: entire trace). */
  window?: number;
}

/** Match criteria for a policy rule. */
export interface PolicyMatch {
  event_type?: string;
  /** Per-event payload conditions. Always present (may be `[]` for sequence-only rules). */
  payload: PayloadCondition[];
  /** Cross-event sequence match. When present, per-event match fields are ignored. */
  sequence?: SequenceMatch;
}

/** A single policy rule. */
export interface PolicyRule {
  id: string;
  description: string;
  match: PolicyMatch;
  action: PolicyAction;
  severity: Severity;
  ci_failure?: boolean;
  message: string;
  on_violation?: OnViolation;
  /**
   * Redaction directives applied by the runtime SDK when `action === "redact"`.
   * Ignored at trace-evaluation time. Required when `action === "redact"`;
   * other actions may omit.
   */
  redactions?: Redaction[];
  /**
   * Fallback action when a `require-approval` rule times out at runtime
   * (default soft-block is 30 s; see `@krynix/sdk`). Ignored at
   * trace-evaluation time. Optional; the SDK default is `"deny"` when
   * omitted.
   */
  on_timeout?: "allow" | "deny";
}

/** Scope defining which agents and event types a policy applies to. */
export interface PolicyScope {
  agents: string[];
  event_types: string[];
}

/** Default actions for events matching no rule. */
export interface PolicyDefaults {
  unmatched_action?: "allow" | "deny";
  unmatched_severity?: "info" | "warning";
}

/** Policy specification containing scope, rules, and defaults. */
export interface PolicySpec {
  scope: PolicyScope;
  rules: PolicyRule[];
  defaults?: PolicyDefaults;
}

/** Policy metadata. */
export interface PolicyMetadata {
  name: string;
  version: string;
  description: string;
  labels?: Record<string, string>;
  extends?: string;
}

/**
 * A fully parsed and validated Policy object.
 *
 * Corresponds to a `.policy.yaml` file conforming to `krynix.dev/v1`.
 */
export interface Policy {
  apiVersion: string;
  kind: "Policy";
  metadata: PolicyMetadata;
  spec: PolicySpec;
}

// ---------------------------------------------------------------------------
// Valid value sets (used by parser validation)
// ---------------------------------------------------------------------------

export const VALID_ACTIONS: readonly PolicyAction[] = [
  "allow",
  "deny",
  "redact",
  "require-approval",
];

/** Valid values for `PolicyRule.on_timeout`. */
export const VALID_ON_TIMEOUT: readonly ("allow" | "deny")[] = ["allow", "deny"];
export const VALID_SEVERITIES: readonly Severity[] = ["info", "warning", "error", "critical"];
export const VALID_OPERATORS: readonly MatchOperator[] = [
  "eq",
  "neq",
  "in",
  "not_in",
  "matches",
  "contains",
  "exists",
];
