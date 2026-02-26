/**
 * Policy inheritance — merge engine for composing policies.
 *
 * Supports `metadata.extends` for policy composition. A child policy
 * can extend a parent, inheriting rules and defaults while overriding
 * specific aspects.
 *
 * @module
 */

import type { Policy, PolicyRule, PolicyDefaults } from "./schema.js";
import { PolicyValidationError } from "./parser.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Callback for loading a policy by its `extends` reference.
 * The implementation handles file I/O, registry lookups, etc.
 */
export type PolicyResolver = (ref: string) => Promise<Policy>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum inheritance chain depth to prevent runaway recursion. */
const MAX_CHAIN_DEPTH = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge a child policy with its parent (pure function).
 *
 * Merge rules:
 * - **metadata**: child wins entirely (name, version, description, labels)
 * - **spec.scope**: child REPLACES parent scope entirely
 * - **spec.rules**: child rules override parent rules by matching `rule.id`.
 *   Unmatched parent rules are appended after all child rules (preserving
 *   first-match-wins ordering where child rules take priority).
 * - **spec.defaults**: field-level merge. Child fields override parent fields.
 *   If child doesn't specify a default field, parent's value is inherited.
 *
 * @param child - The child (extending) policy
 * @param parent - The parent (base) policy
 * @returns A new merged policy object
 */
export function mergePolicy(child: Policy, parent: Policy): Policy {
  // Child rules by ID for quick lookup
  const childRuleIds = new Set(child.spec.rules.map((r) => r.id));

  // Append parent rules not overridden by child
  const mergedRules: PolicyRule[] = [
    ...child.spec.rules,
    ...parent.spec.rules.filter((r) => !childRuleIds.has(r.id)),
  ];

  // Merge defaults: child overrides parent, field-by-field
  const mergedDefaults = mergeDefaults(child.spec.defaults, parent.spec.defaults);

  const { extends: _extendsRef, ...metadataWithoutExtends } = child.metadata;

  return {
    apiVersion: child.apiVersion,
    kind: child.kind,
    metadata: { ...metadataWithoutExtends },
    spec: {
      scope: { ...child.spec.scope },
      rules: mergedRules,
      ...(mergedDefaults !== undefined ? { defaults: mergedDefaults } : {}),
    },
  };
}

/**
 * Resolve a policy's full inheritance chain.
 *
 * Loads the inheritance chain up to `MAX_CHAIN_DEPTH` (5), detects
 * circular references, and merges bottom-up (child overrides parent).
 *
 * If the policy has no `metadata.extends`, returns it unchanged.
 *
 * @param policy - The leaf policy to resolve
 * @param resolver - Callback that loads a policy by its extends reference
 * @returns The fully resolved (merged) policy
 * @throws {PolicyValidationError} On circular dependency or excessive chain depth
 */
export async function resolvePolicy(policy: Policy, resolver: PolicyResolver): Promise<Policy> {
  if (policy.metadata.extends === undefined) {
    return policy;
  }

  const visited = new Set<string>();

  return resolveChain(policy, resolver, visited, 0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveChain(
  policy: Policy,
  resolver: PolicyResolver,
  visited: Set<string>,
  depth: number,
): Promise<Policy> {
  if (policy.metadata.extends === undefined) {
    return policy;
  }

  if (depth >= MAX_CHAIN_DEPTH) {
    throw new PolicyValidationError(
      "metadata.extends",
      `inheritance chain depth exceeded maximum of ${MAX_CHAIN_DEPTH}`,
    );
  }

  const parentRef = policy.metadata.extends;

  // Circular dependency check — track by reference string (file path)
  if (visited.has(parentRef)) {
    throw new PolicyValidationError(
      "metadata.extends",
      `circular dependency detected: ${[...visited].join(" → ")} → ${parentRef}`,
    );
  }

  visited.add(parentRef);

  // Load parent policy
  const parent = await resolver(parentRef);

  // Recursively resolve the parent's chain
  const resolvedParent = await resolveChain(parent, resolver, visited, depth + 1);

  // Merge child over resolved parent
  return mergePolicy(policy, resolvedParent);
}

function mergeDefaults(
  child: PolicyDefaults | undefined,
  parent: PolicyDefaults | undefined,
): PolicyDefaults | undefined {
  if (child === undefined && parent === undefined) {
    return undefined;
  }

  if (child === undefined) {
    return parent !== undefined ? { ...parent } : undefined;
  }

  if (parent === undefined) {
    return { ...child };
  }

  // Field-level merge: child overrides parent
  return {
    unmatched_action: child.unmatched_action ?? parent.unmatched_action,
    unmatched_severity: child.unmatched_severity ?? parent.unmatched_severity,
  };
}
