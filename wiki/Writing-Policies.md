# Writing Policies

This guide explains how to write Krynix policy YAML files, from basic rules to advanced patterns like inheritance and regression testing.

## Basic Policy Structure

Every policy file has three sections: `metadata`, `spec.scope`, and `spec.rules`.

```yaml
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: my-policy
  version: "1.0.0"
  description: "Description of what this policy enforces"

spec:
  scope:
    agents: ["*"]          # Which agents this applies to
    event_types: ["*"]     # Which event types to evaluate

  rules:
    - id: rule-1
      description: "What this rule checks"
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: dangerous_tool
      action: deny
      severity: critical
      message: "This tool is not permitted"
```

## Match Patterns

### By Event Type

```yaml
match:
  event_type: tool_call    # Only match tool_call events
```

### By Payload Field

```yaml
match:
  event_type: tool_call
  payload:
    - field: tool_name
      operator: eq
      value: shell_exec
```

### Multiple Conditions (AND Logic)

All payload matchers must match for the rule to trigger:

```yaml
match:
  event_type: tool_call
  payload:
    - field: tool_name
      operator: eq
      value: file_write
    - field: arguments.path
      operator: matches
      value: "^/etc/"
```

### Available Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Exact equality | `value: shell_exec` |
| `neq` | Not equal | `value: safe_tool` |
| `in` | Value in list | `value: [shell_exec, eval, exec]` |
| `not_in` | Value not in list | `value: [file_read, file_list]` |
| `matches` | Regex match | `value: "^/tmp/"` |
| `contains` | Contains substring | `value: "password"` |
| `exists` | Field exists | `value: true` |

## Actions and Severity

### Actions

| Action | Meaning |
|--------|---------|
| `allow` | Event is permitted (stops rule evaluation for this event) |
| `deny` | Event is a violation |
| `require-approval` | Event needs human approval |

### Severity Levels

| Severity | CI Default |
|----------|-----------|
| `info` | Logged, CI passes |
| `warning` | Logged, CI passes |
| `error` | CI fails (exit 1) |
| `critical` | CI fails (exit 2) |

### CI Failure Override

Override the default CI behavior per rule:

```yaml
- id: log-shell-usage
  match:
    event_type: tool_call
    payload:
      - field: tool_name
        operator: eq
        value: shell_exec
  action: deny
  severity: warning
  ci_failure: true    # Force CI failure even though severity is warning
  message: "Shell usage detected"
```

## Common Policy Patterns

### Deny Specific Tools

```yaml
rules:
  - id: deny-shell
    description: "Block shell execution"
    match:
      event_type: tool_call
      payload:
        - field: tool_name
          operator: in
          value: [shell_exec, bash, system]
    action: deny
    severity: critical
    message: "Shell execution is not permitted"
```

### Require Approval for File Writes

```yaml
rules:
  - id: approve-file-write
    description: "File writes need human approval"
    match:
      event_type: tool_call
      payload:
        - field: tool_name
          operator: eq
          value: file_write
    action: require-approval
    severity: warning
    message: "File write requires approval"
```

### Allow Specific Tools, Deny Everything Else

```yaml
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]

  rules:
    - id: allow-safe-tools
      description: "Permit read-only tools"
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: in
            value: [file_read, file_list, web_search]
      action: allow
      severity: info
      message: "Safe tool permitted"

  defaults:
    unmatched_action: deny        # Everything else is denied
    unmatched_severity: error
```

### Path-Based Rules

```yaml
rules:
  - id: deny-etc-writes
    description: "No writes to /etc/"
    match:
      event_type: tool_call
      payload:
        - field: tool_name
          operator: eq
          value: file_write
        - field: arguments.path
          operator: matches
          value: "^/etc/"
    action: deny
    severity: critical
    message: "Writing to /etc/ is not permitted"
```

### Monitor LLM Token Usage

```yaml
rules:
  - id: warn-high-tokens
    description: "Flag large LLM responses"
    match:
      event_type: llm_response
      payload:
        - field: usage.completion_tokens
          operator: exists
          value: true
    action: allow
    severity: info
    message: "LLM response recorded"
```

## Policy Inheritance

Policies can extend a parent:

```yaml
# child.policy.yaml
metadata:
  name: strict-production
  version: "1.0.0"
  extends: base-safety@1.0.0    # Parent policy reference
  description: "Production policy extending base safety"

spec:
  rules:
    - id: extra-rule
      # ... additional rules appended after parent's rules
```

Parent rules are evaluated first, then child rules. The child can override `defaults` and `scope`.

### Remote Resolution

With the HTTP policy resolver, `extends` references like `"base-safety@1.0.0"` can be fetched from a Control Plane policy registry.

## Testing Policies

### Reporting Mode

```bash
# See what verdict a policy produces against a trace
krynix policy test --policy my.policy.yaml --trace test.trace.jsonl
```

### Assertion Mode

```bash
# Fail if verdict doesn't match expectation
krynix policy test --policy my.policy.yaml --trace test.trace.jsonl --expect-verdict pass
```

### Syntax Validation

```bash
# Validate policy YAML is well-formed
krynix validate --policy my.policy.yaml
krynix validate --policy policies/    # All files in directory
```

### Regression Testing with Diff

```bash
# Compare two policy versions
krynix policy diff --old v1.policy.yaml --new v2.policy.yaml
```

Exit code 2 if a severity downgrade or action weakening is detected.

## File Naming

Policy files must follow the naming convention:

```
<name>.policy.yaml
```

When scanning a directory, only files matching `*.policy.yaml` are evaluated.

## See Also

- [Policy Specification](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/policy_spec.md) -- Full YAML schema reference
- [[Policy]] -- Policy concepts overview
- [[Trust Pipeline]] -- How policies fit into CI enforcement
- [[CLI Reference]] -- Command reference for policy commands
