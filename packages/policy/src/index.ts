// @krynix/policy — public API
// This is the single entry point for the policy package.
// All public exports must go through this file.

export {
  // Constants
  POLICY_API_VERSION,
  POLICY_KIND,
  VALID_ACTIONS,
  VALID_SEVERITIES,
  VALID_OPERATORS,
  // String union types
  type PolicyAction,
  type Severity,
  type MatchOperator,
  // Policy structure types
  type Policy,
  type PolicyMetadata,
  type PolicySpec,
  type PolicyScope,
  type PolicyRule,
  type PolicyMatch,
  type PayloadCondition,
  type PolicyDefaults,
  type OnViolation,
} from "./schema.js";

export { parsePolicy, PolicyValidationError } from "./parser.js";

export { matchRule } from "./matcher.js";

export {
  evaluate,
  type PolicyVerdict,
  type Violation,
  type EvaluationResult,
} from "./evaluator.js";

export { mergePolicy, resolvePolicy, type PolicyResolver } from "./inheritance.js";

export { diffPolicies, type PolicyDiff, type RuleDiff } from "./diff.js";

export { createHttpPolicyResolver, type HttpPolicyResolverOptions } from "./http-resolver.js";
