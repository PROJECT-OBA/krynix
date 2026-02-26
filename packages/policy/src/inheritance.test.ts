/**
 * Tests for policy inheritance (mergePolicy, resolvePolicy).
 */

import { describe, test, expect } from "vitest";
import { mergePolicy, resolvePolicy } from "./inheritance.js";
import { parsePolicy } from "./parser.js";
import type { Policy, PolicyRule } from "./schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePolicy(overrides: {
  name?: string;
  version?: string;
  description?: string;
  extends?: string;
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
      ...(overrides.extends !== undefined ? { extends: overrides.extends } : {}),
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

function makeRule(id: string, action: "allow" | "deny" | "require-approval" = "deny"): PolicyRule {
  return {
    id,
    description: `Rule ${id}`,
    match: { payload: [] },
    action,
    severity: "error",
    message: `Rule ${id} triggered`,
  };
}

// ---------------------------------------------------------------------------
// mergePolicy tests
// ---------------------------------------------------------------------------

describe("mergePolicy", () => {
  test("child scope replaces parent scope entirely", () => {
    const parent = makePolicy({ agents: ["agent-a"], event_types: ["tool_call"] });
    const child = makePolicy({ agents: ["agent-b"], event_types: ["error"] });

    const merged = mergePolicy(child, parent);
    expect(merged.spec.scope.agents).toEqual(["agent-b"]);
    expect(merged.spec.scope.event_types).toEqual(["error"]);
  });

  test("child rule overrides parent rule with same ID", () => {
    const parent = makePolicy({ rules: [makeRule("rule-1", "deny")] });
    const child = makePolicy({ rules: [makeRule("rule-1", "allow")] });

    const merged = mergePolicy(child, parent);
    expect(merged.spec.rules).toHaveLength(1);
    expect(merged.spec.rules[0]?.id).toBe("rule-1");
    expect(merged.spec.rules[0]?.action).toBe("allow");
  });

  test("parent rules with unmatched IDs are appended after child rules", () => {
    const parent = makePolicy({ rules: [makeRule("parent-1"), makeRule("shared")] });
    const child = makePolicy({ rules: [makeRule("child-1"), makeRule("shared", "allow")] });

    const merged = mergePolicy(child, parent);
    expect(merged.spec.rules).toHaveLength(3);
    // Child rules first
    expect(merged.spec.rules[0]?.id).toBe("child-1");
    expect(merged.spec.rules[1]?.id).toBe("shared");
    expect(merged.spec.rules[1]?.action).toBe("allow"); // child's version
    // Parent rule appended
    expect(merged.spec.rules[2]?.id).toBe("parent-1");
  });

  test("child defaults override parent defaults field-by-field", () => {
    const parent = makePolicy({
      defaults: { unmatched_action: "deny", unmatched_severity: "warning" },
    });
    const child = makePolicy({
      defaults: { unmatched_action: "allow" },
    });

    const merged = mergePolicy(child, parent);
    expect(merged.spec.defaults?.unmatched_action).toBe("allow"); // child override
    expect(merged.spec.defaults?.unmatched_severity).toBe("warning"); // inherited from parent
  });

  test("child without defaults inherits parent defaults", () => {
    const parent = makePolicy({
      defaults: { unmatched_action: "deny" },
    });
    const child = makePolicy({});

    const merged = mergePolicy(child, parent);
    expect(merged.spec.defaults?.unmatched_action).toBe("deny");
  });

  test("child metadata is preserved (not merged from parent)", () => {
    const parent = makePolicy({
      name: "parent-policy",
      version: "2.0.0",
      description: "Parent description",
    });
    const child = makePolicy({
      name: "child-policy",
      version: "1.0.0",
      description: "Child description",
    });

    const merged = mergePolicy(child, parent);
    expect(merged.metadata.name).toBe("child-policy");
    expect(merged.metadata.version).toBe("1.0.0");
    expect(merged.metadata.description).toBe("Child description");
  });

  test("mergePolicy strips extends from result metadata", () => {
    const parent = makePolicy({ name: "parent" });
    const child = makePolicy({
      name: "child",
      extends: "parent.policy.yaml",
    });

    const merged = mergePolicy(child, parent);
    expect(merged.metadata.extends).toBeUndefined();
    expect(merged.metadata.name).toBe("child");
  });
});

// ---------------------------------------------------------------------------
// resolvePolicy tests
// ---------------------------------------------------------------------------

describe("resolvePolicy", () => {
  test("policy without extends is returned unchanged", async () => {
    const policy = makePolicy({ name: "standalone" });

    const resolved = await resolvePolicy(policy, async () => {
      throw new Error("should not be called");
    });

    expect(resolved).toEqual(policy);
  });

  test("single-level inheritance resolves correctly", async () => {
    const parent = makePolicy({
      name: "parent",
      rules: [makeRule("parent-rule")],
      defaults: { unmatched_action: "deny" },
    });

    const child = makePolicy({
      name: "child",
      extends: "parent.policy.yaml",
      rules: [makeRule("child-rule")],
    });

    const resolved = await resolvePolicy(child, async () => parent);

    expect(resolved.metadata.name).toBe("child");
    expect(resolved.spec.rules).toHaveLength(2);
    expect(resolved.spec.rules[0]?.id).toBe("child-rule");
    expect(resolved.spec.rules[1]?.id).toBe("parent-rule");
    expect(resolved.spec.defaults?.unmatched_action).toBe("deny");
  });

  test("two-level inheritance (grandparent → parent → child) merges correctly", async () => {
    const grandparent = makePolicy({
      name: "grandparent",
      rules: [makeRule("gp-rule")],
    });

    const parent = makePolicy({
      name: "parent",
      extends: "grandparent.policy.yaml",
      rules: [makeRule("parent-rule")],
    });

    const child = makePolicy({
      name: "child",
      extends: "parent.policy.yaml",
      rules: [makeRule("child-rule")],
    });

    const resolver = async (ref: string) => {
      if (ref === "parent.policy.yaml") return parent;
      if (ref === "grandparent.policy.yaml") return grandparent;
      throw new Error(`unknown ref: ${ref}`);
    };

    const resolved = await resolvePolicy(child, resolver);

    expect(resolved.spec.rules).toHaveLength(3);
    expect(resolved.spec.rules[0]?.id).toBe("child-rule");
    expect(resolved.spec.rules[1]?.id).toBe("parent-rule");
    expect(resolved.spec.rules[2]?.id).toBe("gp-rule");
  });

  test("circular dependency detected and throws", async () => {
    const policyA = makePolicy({ name: "a", extends: "b.policy.yaml" });
    const policyB = makePolicy({ name: "b", extends: "a.policy.yaml" });

    const resolver = async (ref: string) => {
      if (ref === "b.policy.yaml") return policyB;
      if (ref === "a.policy.yaml") return policyA;
      throw new Error(`unknown ref: ${ref}`);
    };

    await expect(resolvePolicy(policyA, resolver)).rejects.toThrow("circular dependency detected");
  });

  test("chain depth exceeded throws", async () => {
    // Create a chain of 7 policies (exceeds MAX_CHAIN_DEPTH of 5)
    const policies = new Map<string, Policy>();
    for (let i = 6; i >= 0; i--) {
      policies.set(
        `p${i}.policy.yaml`,
        makePolicy({
          name: `p${i}`,
          ...(i < 6 ? { extends: `p${i + 1}.policy.yaml` } : {}),
        }),
      );
    }

    const leaf = makePolicy({ name: "leaf", extends: "p0.policy.yaml" });

    const resolver = async (ref: string) => {
      const p = policies.get(ref);
      if (p === undefined) throw new Error(`unknown ref: ${ref}`);
      return p;
    };

    await expect(resolvePolicy(leaf, resolver)).rejects.toThrow("inheritance chain depth exceeded");
  });

  test("self-referencing policy detected as circular dependency", async () => {
    const selfRef = makePolicy({ name: "self", extends: "self.policy.yaml" });

    const resolver = async (ref: string) => {
      if (ref === "self.policy.yaml") return selfRef;
      throw new Error(`unknown ref: ${ref}`);
    };

    await expect(resolvePolicy(selfRef, resolver)).rejects.toThrow("circular dependency detected");
  });

  test("resolver error propagates to caller", async () => {
    const child = makePolicy({ name: "child", extends: "missing.policy.yaml" });

    const resolver = async () => {
      throw new Error("file not found: missing.policy.yaml");
    };

    await expect(resolvePolicy(child, resolver)).rejects.toThrow("file not found");
  });

  test("parser preserves extends field from YAML metadata", () => {
    const yaml = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: child-policy
  version: "1.0.0"
  description: Extends a base policy
  extends: base.policy.yaml
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: test-rule
      description: Test rule
      match:
        payload: []
      action: allow
      severity: info
      message: Allowed
`;

    const policy = parsePolicy(yaml);
    expect(policy.metadata.extends).toBe("base.policy.yaml");
  });
});
