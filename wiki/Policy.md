# Policy

A **Policy** is a declarative YAML rule set that defines what agents are and are not allowed to do. Policies are evaluated against traces at CI time and produce verdicts that gate code merges.

## Overview

Policies follow a `match -> action -> severity` pattern:

1. **Match** -- which trace events trigger this rule (event type, payload field values)
2. **Action** -- what happens when an event matches (`allow`, `deny`, `require-approval`)
3. **Severity** -- how serious a violation is (`info`, `warning`, `error`, `critical`)

Policies are stored as `.policy.yaml` files and evaluated post-hoc against completed traces.

## Policy YAML Format

```yaml
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: no-shell-exec
  version: "1.0.0"
  description: "Deny shell execution in production agents"
  labels:
    environment: production

spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]

  rules:
    - id: deny-shell
      description: "Block shell_exec tool calls"
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: critical
      message: "Shell execution is not permitted"

  defaults:
    unmatched_action: allow
    unmatched_severity: warning
```

## Key Concepts

### Scope

The `spec.scope` section defines which events this policy applies to:
- `agents` -- list of `agent_id` patterns (`["*"]` for all)
- `event_types` -- list of event types to evaluate (`["*"]` for all)

Events outside scope are ignored (not evaluated at all).

### Rules

Rules are evaluated **in order** (first-match-wins). Each rule has:

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier within this policy |
| `match` | Event type and payload field matchers (AND logic) |
| `action` | `allow`, `deny`, or `require-approval` |
| `severity` | `info`, `warning`, `error`, or `critical` |
| `ci_failure` | Override default CI failure behavior per rule |
| `message` | Human-readable violation message |

### Match Operators

| Operator | Description |
|----------|-------------|
| `eq` | Exact equality |
| `neq` | Not equal |
| `in` | Value is in a list |
| `not_in` | Value is not in a list |
| `matches` | Regex match |
| `contains` | String contains substring |
| `exists` | Field exists (boolean) |

Payload fields use dot-notation paths (e.g., `arguments.path`).

### Verdicts

After evaluating all events against all rules, a **Policy Verdict** is computed:

| Verdict | Meaning | Exit Code |
|---------|---------|-----------|
| `pass` | Zero CI-failing violations; non-CI-failing violations do not affect the exit code | 0 |
| `fail` | One or more CI-failing violations | `1` (error severity) or `2` (critical severity) |
| `require-approval` | At least one `require-approval` action, zero fail-level violations | 3 |

### Severity and CI Mapping

| Severity | Default CI Behavior |
|----------|-------------------|
| `info` | Logged, CI passes (exit 0) |
| `warning` | Logged, CI passes (exit 0) |
| `error` | CI fails (exit 1) |
| `critical` | CI fails (exit 2) |

The `ci_failure` field on individual rules can override these defaults.

### Defaults

The `spec.defaults` section controls behavior for events that match no rule:

- `unmatched_action` -- `allow` (default) or `deny`
- `unmatched_severity` -- `info` or `warning` (default)

## Policy Inheritance

Policies can extend parent policies via `metadata.extends`:

```yaml
metadata:
  name: strict-production
  extends: base-safety@1.0.0
```

The child policy's rules are appended after the parent's. The child can override defaults and scope. Circular dependencies are detected and rejected.

With the HTTP policy resolver, `extends` references like `"base-safety@1.0.0"` can be resolved from a remote registry.

## Policy Diff

Compare two policy versions to detect regressions:

```bash
krynix policy diff --old v1.policy.yaml --new v2.policy.yaml
```

Detects:
- Severity downgrades (e.g., `critical` -> `warning`)
- Action weakenings (e.g., `deny` -> `allow`)
- Rule additions and removals
- Scope changes (agents, event types)
- `ci_failure` and `on_violation` changes

Exit code 2 indicates a security-relevant regression.

## CLI Commands

```bash
# Evaluate a trace against policies
krynix evaluate --trace session.trace.jsonl --policy policies/

# Validate policy syntax
krynix validate --policy policies/

# Test a policy against a sample trace
krynix policy test --policy my.policy.yaml --trace test.trace.jsonl --expect-verdict pass

# Compare two policy versions
krynix policy diff --old v1.policy.yaml --new v2.policy.yaml

# Pull policies from Control Plane (PLANNED — requires Control Plane)
krynix policy pull --output-dir ./policies

# Push a policy to Control Plane (PLANNED — requires Control Plane)
krynix policy push --file my.policy.yaml --changelog "Added shell_exec deny rule"
```

## See Also

- [Policy Specification](https://github.com/PROJECT-OBA/krynix/blob/main/docs/10_architecture/policy_spec.md) -- Full YAML schema reference
- [[Trace]] -- What policies evaluate against
- [[Trust Pipeline]] -- How policy evaluation fits into the trust loop
- [[Writing Policies]] -- Step-by-step guide to writing policies
