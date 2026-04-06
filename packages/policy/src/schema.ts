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

/** Actions a policy rule can take on a matching event. */
export type PolicyAction = "allow" | "deny" | "require-approval";

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
  /** Maximum number of events between first and last match (default: entire trace). */
  window?: number;
}

/** Match criteria for a policy rule. */
export interface PolicyMatch {
  event_type?: string;
  /** Per-event payload conditions. Required for per-event rules; may be omitted when `sequence` is present. */
  payload?: PayloadCondition[];
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

export const VALID_ACTIONS: readonly PolicyAction[] = ["allow", "deny", "require-approval"];
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
