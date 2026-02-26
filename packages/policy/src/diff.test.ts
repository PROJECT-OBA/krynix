/**
 * Tests for policy diff engine.
 */

import { describe, test, expect } from "vitest";
import { diffPolicies } from "./diff.js";
import type { Policy, PolicyRule } from "./schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: {
  name?: string;
  version?: string;
  description?: string;
  agents?: string[];
  event_types?: string[];
  rules?: PolicyRule[];
  defaults?: Policy["spec"]["defaults"];
}): Policy {
  return {
    apiVersion: "krynix.dev/v1",
    kind: "Policy",
    metadata: {
      name: overrides.name ?? "test-policy",
      version: overrides.version ?? "1.0.0",
      description: overrides.description ?? "A test policy",
    },
    spec: {
      scope: {
        agents: overrides.agents ?? ["*"],
        event_types: overrides.event_types ?? ["*"],
      },
      rules: overrides.rules ?? [],
      ...(overrides.defaults !== undefined ? { defaults: overrides.defaults } : {}),
    },
  };
}

function makeRule(
  id: string,
  action: "allow" | "deny" | "require-approval" = "deny",
  severity: "info" | "warning" | "error" | "critical" = "error",
): PolicyRule {
  return {
    id,
    description: `Rule ${id}`,
    match: { payload: [] },
    action,
    severity,
    message: `Rule ${id} triggered`,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("diffPolicies", () => {
  test("identical policies → hasChanges: false", () => {
    const policy = makePolicy({ rules: [makeRule("rule-1")] });
    const diff = diffPolicies(policy, policy);

    expect(diff.hasChanges).toBe(false);
    expect(diff.hasSeverityDowngrade).toBe(false);
    expect(diff.hasActionWeakening).toBe(false);
    expect(diff.rules.added).toHaveLength(0);
    expect(diff.rules.removed).toHaveLength(0);
    expect(diff.rules.modified).toHaveLength(0);
    expect(diff.rules.reordered).toBe(false);
  });

  test("added rule → appears in rules.added", () => {
    const oldPolicy = makePolicy({ rules: [makeRule("rule-1")] });
    const newPolicy = makePolicy({ rules: [makeRule("rule-1"), makeRule("rule-2")] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasChanges).toBe(true);
    expect(diff.rules.added).toEqual(["rule-2"]);
    expect(diff.rules.removed).toHaveLength(0);
  });

  test("removed rule → appears in rules.removed", () => {
    const oldPolicy = makePolicy({ rules: [makeRule("rule-1"), makeRule("rule-2")] });
    const newPolicy = makePolicy({ rules: [makeRule("rule-1")] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasChanges).toBe(true);
    expect(diff.rules.removed).toEqual(["rule-2"]);
    expect(diff.rules.added).toHaveLength(0);
  });

  test("modified rule (action changed) → actionChanged: true", () => {
    const oldPolicy = makePolicy({ rules: [makeRule("rule-1", "deny")] });
    const newPolicy = makePolicy({ rules: [makeRule("rule-1", "allow")] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasChanges).toBe(true);
    expect(diff.rules.modified).toHaveLength(1);
    expect(diff.rules.modified[0]?.ruleId).toBe("rule-1");
    expect(diff.rules.modified[0]?.actionChanged).toBe(true);
    expect(diff.rules.modified[0]?.oldAction).toBe("deny");
    expect(diff.rules.modified[0]?.newAction).toBe("allow");
  });

  test("severity downgrade (error → warning) → severityDowngrade: true", () => {
    const oldPolicy = makePolicy({ rules: [makeRule("rule-1", "deny", "error")] });
    const newPolicy = makePolicy({ rules: [makeRule("rule-1", "deny", "warning")] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasSeverityDowngrade).toBe(true);
    expect(diff.rules.modified[0]?.severityDowngrade).toBe(true);
    expect(diff.rules.modified[0]?.oldSeverity).toBe("error");
    expect(diff.rules.modified[0]?.newSeverity).toBe("warning");
  });

  test("severity upgrade (warning → error) → severityDowngrade: false", () => {
    const oldPolicy = makePolicy({ rules: [makeRule("rule-1", "deny", "warning")] });
    const newPolicy = makePolicy({ rules: [makeRule("rule-1", "deny", "error")] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasSeverityDowngrade).toBe(false);
    expect(diff.rules.modified[0]?.severityDowngrade).toBe(false);
  });

  test("action weakening (deny → allow) → actionWeakened: true", () => {
    const oldPolicy = makePolicy({ rules: [makeRule("rule-1", "deny")] });
    const newPolicy = makePolicy({ rules: [makeRule("rule-1", "allow")] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasActionWeakening).toBe(true);
    expect(diff.rules.modified[0]?.actionWeakened).toBe(true);
  });

  test("action strengthening (allow → deny) → actionWeakened: false", () => {
    const oldPolicy = makePolicy({ rules: [makeRule("rule-1", "allow")] });
    const newPolicy = makePolicy({ rules: [makeRule("rule-1", "deny")] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasActionWeakening).toBe(false);
    expect(diff.rules.modified[0]?.actionWeakened).toBe(false);
  });

  test("rule reordering detected → reordered: true", () => {
    const oldPolicy = makePolicy({
      rules: [makeRule("rule-a"), makeRule("rule-b"), makeRule("rule-c")],
    });
    const newPolicy = makePolicy({
      rules: [makeRule("rule-c"), makeRule("rule-a"), makeRule("rule-b")],
    });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.rules.reordered).toBe(true);
  });

  test("scope change (agents list changed) → agentsChanged: true", () => {
    const oldPolicy = makePolicy({ agents: ["agent-a", "agent-b"] });
    const newPolicy = makePolicy({ agents: ["agent-a", "agent-c"] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasChanges).toBe(true);
    expect(diff.scope.agentsChanged).toBe(true);
    expect(diff.scope.oldAgents).toEqual(["agent-a", "agent-b"]);
    expect(diff.scope.newAgents).toEqual(["agent-a", "agent-c"]);
  });

  test("defaults change (unmatched_action deny → allow) → hasActionWeakening: true", () => {
    const oldPolicy = makePolicy({
      defaults: { unmatched_action: "deny" },
    });
    const newPolicy = makePolicy({
      defaults: { unmatched_action: "allow" },
    });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.defaults.changed).toBe(true);
    expect(diff.hasActionWeakening).toBe(true);
    expect(diff.defaults.unmatchedActionChanged).toEqual({ old: "deny", new: "allow" });
  });

  test("metadata changes detected (name, version, description)", () => {
    const oldPolicy = makePolicy({
      name: "old-name",
      version: "1.0.0",
      description: "Old description",
    });
    const newPolicy = makePolicy({
      name: "new-name",
      version: "2.0.0",
      description: "New description",
    });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasChanges).toBe(true);
    expect(diff.metadata.nameChanged).toBe(true);
    expect(diff.metadata.versionChanged).toBe(true);
    expect(diff.metadata.descriptionChanged).toBe(true);
  });

  test("defaults added from none shows change details", () => {
    const oldPolicy = makePolicy({});
    const newPolicy = makePolicy({
      defaults: { unmatched_action: "allow" },
    });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.defaults.changed).toBe(true);
    expect(diff.defaults.unmatchedActionChanged).toBeDefined();
    expect(diff.defaults.unmatchedActionChanged?.old).toBe("(none)");
    expect(diff.defaults.unmatchedActionChanged?.new).toBe("allow");
  });

  test("ci_failure change detected in rule diff", () => {
    const rule = makeRule("rule-1", "deny");
    const ruleWithCiFailure: PolicyRule = { ...rule, ci_failure: true };

    const oldPolicy = makePolicy({ rules: [rule] });
    const newPolicy = makePolicy({ rules: [ruleWithCiFailure] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.hasChanges).toBe(true);
    expect(diff.rules.modified).toHaveLength(1);
    expect(diff.rules.modified[0]?.ciFailureChanged).toBe(true);
    expect(diff.rules.modified[0]?.onViolationChanged).toBe(false);
  });

  test("defaults removed shows change details with (none) sentinel", () => {
    const oldPolicy = makePolicy({
      defaults: { unmatched_action: "deny" },
    });
    const newPolicy = makePolicy({});

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.defaults.changed).toBe(true);
    expect(diff.defaults.unmatchedActionChanged).toBeDefined();
    expect(diff.defaults.unmatchedActionChanged?.old).toBe("deny");
    expect(diff.defaults.unmatchedActionChanged?.new).toBe("(none)");
  });

  test("identical scope produces no scope change flags", () => {
    const oldPolicy = makePolicy({ agents: ["agent-a"], event_types: ["tool_call"] });
    const newPolicy = makePolicy({ agents: ["agent-a"], event_types: ["tool_call"] });

    const diff = diffPolicies(oldPolicy, newPolicy);

    expect(diff.scope.agentsChanged).toBe(false);
    expect(diff.scope.eventTypesChanged).toBe(false);
    expect(diff.scope.oldAgents).toBeUndefined();
    expect(diff.scope.newAgents).toBeUndefined();
    expect(diff.scope.oldEventTypes).toBeUndefined();
    expect(diff.scope.newEventTypes).toBeUndefined();
  });
});
