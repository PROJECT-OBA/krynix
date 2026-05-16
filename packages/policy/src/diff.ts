/**
 * Policy diff engine — structured comparison between two policies.
 *
 * Pure function that detects rule additions, removals, modifications,
 * severity downgrades, and action weakenings. Designed for CI integration
 * (exit codes reflect security-relevant regressions).
 *
 * @module
 */

import type { Policy, PolicyAction, PolicyRule, Severity } from "./schema.js";
import { VALID_SEVERITIES } from "./schema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Diff for a single modified rule. */
export interface RuleDiff {
  ruleId: string;
  actionChanged: boolean;
  severityChanged: boolean;
  matchChanged: boolean;
  messageChanged: boolean;
  ciFailureChanged: boolean;
  onViolationChanged: boolean;
  severityDowngrade: boolean;
  actionWeakened: boolean;
  oldAction?: PolicyAction;
  newAction?: PolicyAction;
  oldSeverity?: Severity;
  newSeverity?: Severity;
}

/** Structured diff between two policies. */
export interface PolicyDiff {
  /** Whether any changes were detected at all. */
  hasChanges: boolean;

  /** Summary flags for CI integration. */
  hasSeverityDowngrade: boolean;
  hasActionWeakening: boolean;

  metadata: {
    nameChanged: boolean;
    versionChanged: boolean;
    descriptionChanged: boolean;
  };

  scope: {
    agentsChanged: boolean;
    eventTypesChanged: boolean;
    oldAgents?: string[];
    newAgents?: string[];
    oldEventTypes?: string[];
    newEventTypes?: string[];
  };

  rules: {
    added: string[];
    removed: string[];
    modified: RuleDiff[];
    reordered: boolean;
  };

  defaults: {
    changed: boolean;
    unmatchedActionChanged?: { old: string; new: string };
    unmatchedSeverityChanged?: { old: string; new: string };
  };
}

// ---------------------------------------------------------------------------
// Action strength ordering (lower index = weaker enforcement)
// ---------------------------------------------------------------------------

const ACTION_STRENGTH: Record<PolicyAction, number> = {
  allow: 0,
  // `redact` is stronger than `allow` (the request is modified before
  // forwarding) but weaker than `require-approval` (no human in the loop)
  // and weaker than `deny` (the call still proceeds).
  redact: 1,
  "require-approval": 2,
  deny: 3,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compare two policies and produce a structured diff.
 *
 * @param oldPolicy - The baseline policy
 * @param newPolicy - The updated policy
 * @returns A structured diff object
 */
export function diffPolicies(oldPolicy: Policy, newPolicy: Policy): PolicyDiff {
  const metadataDiff = diffMetadata(oldPolicy, newPolicy);
  const scopeDiff = diffScope(oldPolicy, newPolicy);
  const rulesDiff = diffRules(oldPolicy.spec.rules, newPolicy.spec.rules);
  const defaultsDiff = diffDefaults(oldPolicy, newPolicy);

  // Aggregate top-level flags
  const hasSeverityDowngrade =
    rulesDiff.modified.some((r) => r.severityDowngrade) ||
    (defaultsDiff.unmatchedSeverityChanged !== undefined &&
      isSeverityDowngrade(
        defaultsDiff.unmatchedSeverityChanged.old as Severity,
        defaultsDiff.unmatchedSeverityChanged.new as Severity,
      ));

  const hasActionWeakening =
    rulesDiff.modified.some((r) => r.actionWeakened) ||
    (defaultsDiff.unmatchedActionChanged !== undefined &&
      isActionWeakened(
        defaultsDiff.unmatchedActionChanged.old as PolicyAction,
        defaultsDiff.unmatchedActionChanged.new as PolicyAction,
      ));

  const hasChanges =
    metadataDiff.nameChanged ||
    metadataDiff.versionChanged ||
    metadataDiff.descriptionChanged ||
    scopeDiff.agentsChanged ||
    scopeDiff.eventTypesChanged ||
    rulesDiff.added.length > 0 ||
    rulesDiff.removed.length > 0 ||
    rulesDiff.modified.length > 0 ||
    rulesDiff.reordered ||
    defaultsDiff.changed;

  return {
    hasChanges,
    hasSeverityDowngrade,
    hasActionWeakening,
    metadata: metadataDiff,
    scope: scopeDiff,
    rules: rulesDiff,
    defaults: defaultsDiff,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function diffMetadata(oldPolicy: Policy, newPolicy: Policy): PolicyDiff["metadata"] {
  return {
    nameChanged: oldPolicy.metadata.name !== newPolicy.metadata.name,
    versionChanged: oldPolicy.metadata.version !== newPolicy.metadata.version,
    descriptionChanged: oldPolicy.metadata.description !== newPolicy.metadata.description,
  };
}

function diffScope(oldPolicy: Policy, newPolicy: Policy): PolicyDiff["scope"] {
  const agentsChanged =
    JSON.stringify(oldPolicy.spec.scope.agents) !== JSON.stringify(newPolicy.spec.scope.agents);
  const eventTypesChanged =
    JSON.stringify(oldPolicy.spec.scope.event_types) !==
    JSON.stringify(newPolicy.spec.scope.event_types);

  return {
    agentsChanged,
    eventTypesChanged,
    ...(agentsChanged
      ? { oldAgents: oldPolicy.spec.scope.agents, newAgents: newPolicy.spec.scope.agents }
      : {}),
    ...(eventTypesChanged
      ? {
          oldEventTypes: oldPolicy.spec.scope.event_types,
          newEventTypes: newPolicy.spec.scope.event_types,
        }
      : {}),
  };
}

function diffRules(oldRules: PolicyRule[], newRules: PolicyRule[]): PolicyDiff["rules"] {
  const oldById = new Map(oldRules.map((r) => [r.id, r]));
  const newById = new Map(newRules.map((r) => [r.id, r]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: RuleDiff[] = [];

  // Find added and modified rules
  for (const [id, newRule] of newById) {
    const oldRule = oldById.get(id);
    if (oldRule === undefined) {
      added.push(id);
    } else {
      const diff = diffSingleRule(oldRule, newRule);
      if (diff !== null) {
        modified.push(diff);
      }
    }
  }

  // Find removed rules
  for (const id of oldById.keys()) {
    if (!newById.has(id)) {
      removed.push(id);
    }
  }

  // Detect reordering: same set of IDs but different order
  const oldIds = oldRules.map((r) => r.id);
  const newIds = newRules.map((r) => r.id);
  const sameSet =
    oldIds.length === newIds.length &&
    oldIds.every((id) => newById.has(id)) &&
    newIds.every((id) => oldById.has(id));
  const reordered = sameSet && JSON.stringify(oldIds) !== JSON.stringify(newIds);

  return { added, removed, modified, reordered };
}

function diffSingleRule(oldRule: PolicyRule, newRule: PolicyRule): RuleDiff | null {
  const actionChanged = oldRule.action !== newRule.action;
  const severityChanged = oldRule.severity !== newRule.severity;
  const matchChanged = JSON.stringify(oldRule.match) !== JSON.stringify(newRule.match);
  const messageChanged = oldRule.message !== newRule.message;
  const ciFailureChanged = (oldRule.ci_failure ?? false) !== (newRule.ci_failure ?? false);
  const onViolationChanged =
    JSON.stringify(oldRule.on_violation) !== JSON.stringify(newRule.on_violation);

  if (
    !actionChanged &&
    !severityChanged &&
    !matchChanged &&
    !messageChanged &&
    !ciFailureChanged &&
    !onViolationChanged
  ) {
    return null;
  }

  return {
    ruleId: oldRule.id,
    actionChanged,
    severityChanged,
    matchChanged,
    messageChanged,
    ciFailureChanged,
    onViolationChanged,
    severityDowngrade: severityChanged && isSeverityDowngrade(oldRule.severity, newRule.severity),
    actionWeakened: actionChanged && isActionWeakened(oldRule.action, newRule.action),
    ...(actionChanged ? { oldAction: oldRule.action, newAction: newRule.action } : {}),
    ...(severityChanged ? { oldSeverity: oldRule.severity, newSeverity: newRule.severity } : {}),
  };
}

function diffDefaults(oldPolicy: Policy, newPolicy: Policy): PolicyDiff["defaults"] {
  const oldDefaults = oldPolicy.spec.defaults;
  const newDefaults = newPolicy.spec.defaults;

  const oldAction = oldDefaults?.unmatched_action;
  const newAction = newDefaults?.unmatched_action;
  const oldSeverity = oldDefaults?.unmatched_severity;
  const newSeverity = newDefaults?.unmatched_severity;

  const actionChanged = oldAction !== newAction;
  const severityChanged = oldSeverity !== newSeverity;

  return {
    changed: actionChanged || severityChanged,
    ...(actionChanged
      ? { unmatchedActionChanged: { old: oldAction ?? "(none)", new: newAction ?? "(none)" } }
      : {}),
    ...(severityChanged
      ? { unmatchedSeverityChanged: { old: oldSeverity ?? "(none)", new: newSeverity ?? "(none)" } }
      : {}),
  };
}

/**
 * Is the new severity lower than the old? (Lower = less severe = downgrade.)
 * VALID_SEVERITIES: ["info", "warning", "error", "critical"]
 */
function isSeverityDowngrade(oldSev: Severity, newSev: Severity): boolean {
  const oldIdx = VALID_SEVERITIES.indexOf(oldSev);
  const newIdx = VALID_SEVERITIES.indexOf(newSev);
  return newIdx < oldIdx;
}

/**
 * Is the new action weaker than the old? (Weaker = less enforcement.)
 *
 * Ordering (per `ACTION_STRENGTH` above):
 *   allow(0) < redact(1) < require-approval(2) < deny(3)
 *
 * `redact` sits between `allow` and `require-approval` — the request is
 * still forwarded (unlike `deny`) and no human is in the loop (unlike
 * `require-approval`), but the request body is modified (unlike `allow`).
 */
function isActionWeakened(oldAction: PolicyAction, newAction: PolicyAction): boolean {
  return ACTION_STRENGTH[newAction] < ACTION_STRENGTH[oldAction];
}
