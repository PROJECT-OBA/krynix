# Policy YAML Schema

Complete reference for Krynix policy YAML files. See the [Policy Specification](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/policy_spec.md) for the authoritative source.

## Full Schema

```yaml
apiVersion: krynix.dev/v1       # Required. Must be "krynix.dev/v1".
kind: Policy                     # Required. Must be "Policy".

metadata:
  name: string                   # Required. Unique ID, kebab-case.
  version: string                # Required. Semver (e.g., "1.0.0").
  description: string            # Required. One-line purpose.
  extends: string                # Optional. Parent policy ref ("name@version").
  labels:                        # Optional. Key-value pairs for filtering.
    environment: string
    team: string

spec:
  scope:
    agents:                      # Required. Agent ID patterns. ["*"] for all.
      - string
    event_types:                 # Required. Event types to evaluate. ["*"] for all.
      - string

  rules:
    - id: string                 # Required. Unique within this policy.
      description: string        # Required. Human-readable purpose.
      match:
        event_type: string       # Optional. Overrides scope.event_types for this rule.
        payload:                 # Optional. Field matchers (AND logic).
          - field: string        # Dot-notation path into payload.
            operator: string     # eq | neq | in | not_in | matches | contains | exists
            value: any           # Comparison value.
      action: string             # Required. allow | deny | require-approval
      severity: string           # Required. info | warning | error | critical
      ci_failure: boolean        # Optional. Override default CI failure behavior.
      message: string            # Required. Violation message for CI output.
      on_violation:              # Optional. Escalation configuration.
        notify:
          - string
        create_issue: boolean

  defaults:
    unmatched_action: string     # Optional. allow (default) | deny
    unmatched_severity: string   # Optional. info | warning (default)
```

## Field Reference

### `metadata`

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Policy identifier. Kebab-case. Must match filename: `<name>.policy.yaml` |
| `version` | Yes | string | Semver version |
| `description` | Yes | string | One-line purpose statement |
| `extends` | No | string | Parent policy reference: `"name@version"` |
| `labels` | No | object | Key-value pairs for organizational filtering |

### `spec.scope`

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `agents` | Yes | string[] | Agent ID patterns. `["*"]` matches all |
| `event_types` | Yes | string[] | Event types to evaluate. `["*"]` for all |

### `spec.rules[]`

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `id` | Yes | string | Unique rule identifier |
| `description` | Yes | string | Human-readable purpose |
| `match` | Yes | object | Matching criteria |
| `action` | Yes | string | `allow`, `deny`, or `require-approval` |
| `severity` | Yes | string | `info`, `warning`, `error`, or `critical` |
| `ci_failure` | No | boolean | Override default CI failure behavior |
| `message` | Yes | string | Violation message |
| `on_violation` | No | object | Escalation config |

### `spec.defaults`

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `unmatched_action` | No | `allow` | Action for events matching no rule |
| `unmatched_severity` | No | `warning` | Severity for unmatched events |

## Match Operators

| Operator | Input Type | Description | Example |
|----------|-----------|-------------|---------|
| `eq` | any | Exact equality | `value: "shell_exec"` |
| `neq` | any | Not equal | `value: "safe_tool"` |
| `in` | array | Value is in list | `value: ["shell_exec", "eval"]` |
| `not_in` | array | Value not in list | `value: ["file_read"]` |
| `matches` | string (regex) | Regex match | `value: "^/etc/"` |
| `contains` | string | Contains substring | `value: "password"` |
| `exists` | boolean | Field exists | `value: true` |

Payload field paths use dot-notation: `arguments.path`, `usage.completion_tokens`.

## Evaluation Rules

1. **Scope filtering** -- events outside `spec.scope` are ignored
2. **First-match-wins** -- rules evaluated in order; first match stops evaluation for that event
3. **AND logic** -- all payload matchers in a rule must match
4. **Most-restrictive-wins** -- when multiple policies evaluate the same trace:
   - `deny` > `require-approval` > `allow`

## Verdicts and Exit Codes

| Verdict | Condition | Exit Code |
|---------|-----------|-----------|
| `pass` | Zero violations with `ci_failure: true` | 0 |
| `fail` | One or more `deny` violations with `ci_failure: true` | 2 |
| `require-approval` | At least one `require-approval`, zero fail-level | 3 |

## Severity Defaults

| Severity | `ci_failure` Default |
|----------|---------------------|
| `info` | `false` |
| `warning` | `false` |
| `error` | `true` |
| `critical` | `true` |

## Inheritance

```yaml
metadata:
  name: strict-production
  extends: base-safety@1.0.0
```

- Parent rules are evaluated first, then child rules
- Child can override `defaults` and `scope`
- `extends` is stripped from merged result (no double-resolution)
- Circular dependencies are detected and rejected

## See Also

- [Policy Specification](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/policy_spec.md) -- Authoritative spec document
- [[Writing Policies]] -- Practical guide with examples
- [[Policy]] -- Policy concepts overview
