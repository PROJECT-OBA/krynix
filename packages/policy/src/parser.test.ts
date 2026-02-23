import { describe, test, expect } from "vitest";
import { parsePolicy, PolicyValidationError } from "./parser.js";

const VALID_FULL_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: no-shell-exec
  version: "1.0.0"
  description: Deny all shell command execution
  labels:
    environment: production
    team: platform

spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]

  rules:
    - id: deny-shell
      description: Block all shell_exec tool calls
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: critical
      ci_failure: true
      message: "Shell execution is not permitted"
      on_violation:
        notify: ["slack:#agent-reviews"]
        create_issue: true

  defaults:
    unmatched_action: allow
    unmatched_severity: warning
`;

const MINIMAL_POLICY = `
apiVersion: krynix.dev/v1
metadata:
  name: minimal-policy
  version: "1.0.0"
  description: A minimal valid policy
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: allow-all
      description: Allow everything
      match:
        payload: []
      action: allow
      severity: info
      message: "All events allowed"
`;

describe("parsePolicy", () => {
  test("parses a valid full policy with all fields", () => {
    const policy = parsePolicy(VALID_FULL_POLICY);

    expect(policy.apiVersion).toBe("krynix.dev/v1");
    expect(policy.kind).toBe("Policy");
    expect(policy.metadata.name).toBe("no-shell-exec");
    expect(policy.metadata.version).toBe("1.0.0");
    expect(policy.metadata.description).toBe("Deny all shell command execution");
    expect(policy.metadata.labels).toEqual({ environment: "production", team: "platform" });

    expect(policy.spec.scope.agents).toEqual(["*"]);
    expect(policy.spec.scope.event_types).toEqual(["tool_call"]);

    expect(policy.spec.rules).toHaveLength(1);
    const rule = policy.spec.rules[0];
    expect(rule).toBeDefined();
    expect(rule?.id).toBe("deny-shell");
    expect(rule?.action).toBe("deny");
    expect(rule?.severity).toBe("critical");
    expect(rule?.ci_failure).toBe(true);
    expect(rule?.match.event_type).toBe("tool_call");
    expect(rule?.match.payload).toHaveLength(1);
    const condition = rule?.match.payload[0];
    expect(condition?.field).toBe("tool_name");
    expect(condition?.operator).toBe("eq");
    expect(condition?.value).toBe("shell_exec");
    expect(rule?.on_violation?.notify).toEqual(["slack:#agent-reviews"]);
    expect(rule?.on_violation?.create_issue).toBe(true);

    expect(policy.spec.defaults?.unmatched_action).toBe("allow");
    expect(policy.spec.defaults?.unmatched_severity).toBe("warning");
  });

  test("parses a minimal valid policy (required fields only)", () => {
    const policy = parsePolicy(MINIMAL_POLICY);

    expect(policy.apiVersion).toBe("krynix.dev/v1");
    expect(policy.kind).toBe("Policy");
    expect(policy.metadata.name).toBe("minimal-policy");
    expect(policy.spec.rules).toHaveLength(1);
    expect(policy.metadata.labels).toBeUndefined();
    expect(policy.spec.defaults).toBeUndefined();
  });

  test("rejects missing metadata.name", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  version: "1.0.0"
  description: Missing name
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("metadata.name");
  });

  test("rejects missing metadata.version", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test-policy
  description: Missing version
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`;
    expect(() => parsePolicy(yaml)).toThrow("metadata.version");
  });

  test("rejects missing metadata.description", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test-policy
  version: "1.0.0"
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`;
    expect(() => parsePolicy(yaml)).toThrow("metadata.description");
  });

  test("rejects invalid apiVersion", () => {
    const yaml = `
apiVersion: krynix.dev/v2
metadata:
  name: test
  version: "1.0.0"
  description: Wrong version
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("apiVersion");
    expect(() => parsePolicy(yaml)).toThrow("krynix.dev/v1");
  });

  test("rejects invalid operator in rule", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: Bad operator
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: bad-rule
      description: Has invalid operator
      match:
        payload:
          - field: tool_name
            operator: gt
            value: 5
      action: deny
      severity: error
      message: "bad"
`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("operator");
    expect(() => parsePolicy(yaml)).toThrow("gt");
  });

  test("rejects invalid severity", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: Bad severity
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: bad-rule
      description: Has invalid severity
      match:
        payload: []
      action: deny
      severity: fatal
      message: "bad"
`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("severity");
    expect(() => parsePolicy(yaml)).toThrow("fatal");
  });

  test("rejects invalid action", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: Bad action
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: bad-rule
      description: Has invalid action
      match:
        payload: []
      action: block
      severity: error
      message: "bad"
`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("action");
    expect(() => parsePolicy(yaml)).toThrow("block");
  });

  test("rejects duplicate rule IDs", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: Duplicate IDs
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: same-id
      description: First rule
      match:
        payload: []
      action: allow
      severity: info
      message: "first"
    - id: same-id
      description: Second rule
      match:
        payload: []
      action: deny
      severity: error
      message: "second"
`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("duplicate rule id");
  });

  test("rejects missing spec", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: No spec
`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("spec");
  });

  test("rejects missing scope.agents", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: No agents
spec:
  scope:
    event_types: ["*"]
  rules: []
`;
    expect(() => parsePolicy(yaml)).toThrow("spec.scope.agents");
  });

  test("rejects invalid YAML syntax", () => {
    const yaml = `{{{invalid yaml`;
    expect(() => parsePolicy(yaml)).toThrow(PolicyValidationError);
    expect(() => parsePolicy(yaml)).toThrow("invalid YAML");
  });

  test("rejects rule missing required field (message)", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: Missing message
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: no-msg
      description: Has no message
      match:
        payload: []
      action: allow
      severity: info
`;
    expect(() => parsePolicy(yaml)).toThrow("message");
  });

  test("rejects payload condition missing value field", () => {
    const yaml = `
apiVersion: krynix.dev/v1
metadata:
  name: test
  version: "1.0.0"
  description: Missing value
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: bad-cond
      description: Has condition without value
      match:
        payload:
          - field: tool_name
            operator: eq
      action: deny
      severity: error
      message: "bad"
`;
    expect(() => parsePolicy(yaml)).toThrow("value");
    expect(() => parsePolicy(yaml)).toThrow("is required");
  });
});
