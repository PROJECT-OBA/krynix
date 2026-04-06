/**
 * Parse and validate `.policy.yaml` files into typed Policy objects.
 *
 * @module
 */

import { parse as parseYaml } from "yaml";
import type {
  Policy,
  PolicyRule,
  PayloadCondition,
  PolicyAction,
  Severity,
  MatchOperator,
  SequenceMatch,
  SequenceStep,
} from "./schema.js";
import { POLICY_API_VERSION, VALID_ACTIONS, VALID_SEVERITIES, VALID_OPERATORS } from "./schema.js";

/**
 * Error thrown when a policy YAML document fails validation.
 *
 * Includes the `fieldPath` identifying which field caused the failure.
 */
export class PolicyValidationError extends Error {
  constructor(
    /** Dot-notation path to the invalid field. */
    public readonly fieldPath: string,
    message: string,
  ) {
    super(`${fieldPath}: ${message}`);
    this.name = "PolicyValidationError";
  }
}

function assertString(val: unknown, path: string): asserts val is string {
  if (typeof val !== "string" || val.length === 0) {
    throw new PolicyValidationError(path, "must be a non-empty string");
  }
}

function assertObject(val: unknown, path: string): asserts val is Record<string, unknown> {
  if (val == null || typeof val !== "object" || Array.isArray(val)) {
    throw new PolicyValidationError(path, "must be an object");
  }
}

function assertArray(val: unknown, path: string): asserts val is unknown[] {
  if (!Array.isArray(val)) {
    throw new PolicyValidationError(path, "must be an array");
  }
}

function assertOneOf<T extends string>(
  val: unknown,
  allowed: readonly T[],
  path: string,
): asserts val is T {
  if (!allowed.includes(val as T)) {
    throw new PolicyValidationError(
      path,
      `must be one of: ${allowed.join(", ")} (got "${String(val)}")`,
    );
  }
}

function validatePayloadCondition(raw: unknown, path: string): PayloadCondition {
  assertObject(raw, path);

  assertString(raw["field"], `${path}.field`);
  assertOneOf<MatchOperator>(raw["operator"], VALID_OPERATORS, `${path}.operator`);

  if (!("value" in raw)) {
    throw new PolicyValidationError(`${path}.value`, "is required");
  }

  // Validate regex patterns at parse time to catch invalid patterns early
  if (raw["operator"] === "matches") {
    if (typeof raw["value"] !== "string") {
      throw new PolicyValidationError(
        `${path}.value`,
        "must be a string when operator is 'matches'",
      );
    }
    try {
      new RegExp(raw["value"] as string, "u");
    } catch (e) {
      throw new PolicyValidationError(`${path}.value`, `invalid regex: ${(e as Error).message}`);
    }
  }

  return {
    field: raw["field"] as string,
    operator: raw["operator"] as MatchOperator,
    value: raw["value"],
  };
}

function validateSequenceStep(raw: unknown, path: string): SequenceStep {
  assertObject(raw, path);

  if (raw["event_type"] !== undefined) {
    assertString(raw["event_type"], `${path}.event_type`);
  }

  assertArray(raw["payload"], `${path}.payload`);
  const payload = (raw["payload"] as unknown[]).map((c, i) =>
    validatePayloadCondition(c, `${path}.payload[${String(i)}]`),
  );

  return {
    ...(raw["event_type"] !== undefined ? { event_type: raw["event_type"] as string } : {}),
    payload,
  };
}

function validateSequence(raw: unknown, path: string): SequenceMatch {
  assertObject(raw, path);

  assertArray(raw["steps"], `${path}.steps`);
  if ((raw["steps"] as unknown[]).length < 2) {
    throw new PolicyValidationError(`${path}.steps`, "must have at least 2 steps");
  }

  const steps = (raw["steps"] as unknown[]).map((s, i) =>
    validateSequenceStep(s, `${path}.steps[${String(i)}]`),
  );

  const result: SequenceMatch = { steps };

  if (raw["window"] !== undefined) {
    if (typeof raw["window"] !== "number" || raw["window"] < 1) {
      throw new PolicyValidationError(`${path}.window`, "must be a positive number");
    }
    result.window = raw["window"];
  }

  return result;
}

function validateRule(raw: unknown, path: string, seenIds: Set<string>): PolicyRule {
  assertObject(raw, path);

  assertString(raw["id"], `${path}.id`);
  if (seenIds.has(raw["id"] as string)) {
    throw new PolicyValidationError(`${path}.id`, `duplicate rule id: "${raw["id"] as string}"`);
  }
  seenIds.add(raw["id"] as string);

  assertString(raw["description"], `${path}.description`);
  assertString(raw["message"], `${path}.message`);
  assertOneOf<PolicyAction>(raw["action"], VALID_ACTIONS, `${path}.action`);
  assertOneOf<Severity>(raw["severity"], VALID_SEVERITIES, `${path}.severity`);

  // match
  assertObject(raw["match"], `${path}.match`);
  const matchRaw = raw["match"] as Record<string, unknown>;

  // match.event_type is optional
  if (matchRaw["event_type"] !== undefined) {
    assertString(matchRaw["event_type"], `${path}.match.event_type`);
  }

  // match.payload
  assertArray(matchRaw["payload"], `${path}.match.payload`);
  const payload = (matchRaw["payload"] as unknown[]).map((c, i) =>
    validatePayloadCondition(c, `${path}.match.payload[${String(i)}]`),
  );

  // match.sequence (optional)
  let sequence: SequenceMatch | undefined;
  if (matchRaw["sequence"] !== undefined) {
    sequence = validateSequence(matchRaw["sequence"], `${path}.match.sequence`);
  }

  const rule: PolicyRule = {
    id: raw["id"] as string,
    description: raw["description"] as string,
    match: {
      payload,
      ...(matchRaw["event_type"] !== undefined
        ? { event_type: matchRaw["event_type"] as string }
        : {}),
      ...(sequence !== undefined ? { sequence } : {}),
    },
    action: raw["action"] as PolicyAction,
    severity: raw["severity"] as Severity,
    message: raw["message"] as string,
  };

  if (typeof raw["ci_failure"] === "boolean") {
    rule.ci_failure = raw["ci_failure"];
  }

  if (raw["on_violation"] != null) {
    assertObject(raw["on_violation"], `${path}.on_violation`);
    const onViolation = raw["on_violation"] as Record<string, unknown>;
    rule.on_violation = {};
    if (onViolation["notify"] !== undefined) {
      assertArray(onViolation["notify"], `${path}.on_violation.notify`);
      rule.on_violation.notify = onViolation["notify"] as string[];
    }
    if (typeof onViolation["create_issue"] === "boolean") {
      rule.on_violation.create_issue = onViolation["create_issue"];
    }
  }

  return rule;
}

/**
 * Parse a YAML string into a validated Policy object.
 *
 * @param yaml - Raw YAML string from a `.policy.yaml` file
 * @returns Fully validated Policy object
 * @throws {PolicyValidationError} If the YAML is invalid or fails validation
 */
export function parsePolicy(yaml: string): Policy {
  let doc: unknown;
  try {
    doc = parseYaml(yaml);
  } catch (e) {
    throw new PolicyValidationError("(root)", `invalid YAML: ${(e as Error).message}`);
  }

  assertObject(doc, "(root)");

  // apiVersion
  assertString(doc["apiVersion"], "apiVersion");
  if (doc["apiVersion"] !== POLICY_API_VERSION) {
    throw new PolicyValidationError(
      "apiVersion",
      `must be "${POLICY_API_VERSION}" (got "${doc["apiVersion"] as string}")`,
    );
  }

  // kind (optional but validated if present)
  if (doc["kind"] !== undefined && doc["kind"] !== "Policy") {
    throw new PolicyValidationError("kind", `must be "Policy" (got "${String(doc["kind"])}")`);
  }

  // metadata
  assertObject(doc["metadata"], "metadata");
  const meta = doc["metadata"] as Record<string, unknown>;
  assertString(meta["name"], "metadata.name");
  assertString(meta["version"], "metadata.version");
  assertString(meta["description"], "metadata.description");

  // metadata.extends (optional)
  if (meta["extends"] !== undefined) {
    assertString(meta["extends"], "metadata.extends");
  }

  // spec
  assertObject(doc["spec"], "spec");
  const spec = doc["spec"] as Record<string, unknown>;

  // spec.scope
  assertObject(spec["scope"], "spec.scope");
  const scope = spec["scope"] as Record<string, unknown>;
  assertArray(scope["agents"], "spec.scope.agents");
  assertArray(scope["event_types"], "spec.scope.event_types");

  // spec.rules
  assertArray(spec["rules"], "spec.rules");
  const seenIds = new Set<string>();
  const rules = (spec["rules"] as unknown[]).map((r, i) =>
    validateRule(r, `spec.rules[${String(i)}]`, seenIds),
  );

  // spec.defaults (optional)
  let defaults: Policy["spec"]["defaults"];
  if (spec["defaults"] != null) {
    assertObject(spec["defaults"], "spec.defaults");
    const defs = spec["defaults"] as Record<string, unknown>;
    defaults = {};
    if (defs["unmatched_action"] !== undefined) {
      assertOneOf(
        defs["unmatched_action"],
        ["allow", "deny"] as const,
        "spec.defaults.unmatched_action",
      );
      defaults.unmatched_action = defs["unmatched_action"] as "allow" | "deny";
    }
    if (defs["unmatched_severity"] !== undefined) {
      assertOneOf(
        defs["unmatched_severity"],
        ["info", "warning"] as const,
        "spec.defaults.unmatched_severity",
      );
      defaults.unmatched_severity = defs["unmatched_severity"] as "info" | "warning";
    }
  }

  return {
    apiVersion: POLICY_API_VERSION,
    kind: "Policy",
    metadata: {
      name: meta["name"] as string,
      version: meta["version"] as string,
      description: meta["description"] as string,
      ...(meta["labels"] != null ? { labels: meta["labels"] as Record<string, string> } : {}),
      ...(meta["extends"] !== undefined ? { extends: meta["extends"] as string } : {}),
    },
    spec: {
      scope: {
        agents: scope["agents"] as string[],
        event_types: scope["event_types"] as string[],
      },
      rules,
      ...(defaults !== undefined ? { defaults } : {}),
    },
  };
}
