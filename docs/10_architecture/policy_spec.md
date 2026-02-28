# Policy Specification

**API Version:** `krynix.dev/v1`

This document defines the canonical format for Krynix Policies — declarative rule sets that constrain agent behavior. Policies are evaluated against [TraceEvents](trace_spec.md) at CI time and optionally at runtime.

See [glossary](../00_overview/glossary.md) for term definitions.

## Overview

A **Policy** is a YAML file that defines rules for evaluating agent behavior. Each rule matches specific TraceEvent patterns and assigns an action (`allow`, `deny`, or `require-approval`) with a Severity Level. The Policy Gate evaluates Traces against Policies and produces a Policy Verdict that maps to CI exit codes.

## Policy YAML Schema

```yaml
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: string               # Unique policy ID, kebab-case (e.g., "no-shell-in-prod")
  version: string            # Semver (e.g., "1.0.0")
  description: string        # One-line human-readable purpose
  labels:                    # Optional key-value pairs for filtering
    environment: string      # e.g., "production", "staging", "development"
    team: string             # Owning team

spec:
  scope:
    agents:                  # List of agent_id patterns. ["*"] for all agents.
      - string
    event_types:             # List of event_type values to evaluate. ["*"] for all.
      - string

  rules:
    - id: string                    # Unique within this policy
      description: string           # Human-readable rule purpose
      match:
        event_type: string          # Optional filter; overrides scope.event_types for this rule
        payload:                    # Field matchers. ALL must match (AND logic).
          - field: string           # Dot-notation path into payload
            operator: string        # eq | neq | in | not_in | matches | contains | exists
            value: any              # Comparison value
      action: string               # allow | deny | require-approval
      severity: string             # info | warning | error | critical
      ci_failure: boolean          # Override. Default: true for error/critical, false for info/warning
      message: string              # Violation message shown in CI output
      on_violation:                # Optional escalation
        notify:                    # Notification channels
          - string
        create_issue: boolean      # Auto-create tracking issue

  defaults:
    unmatched_action: string       # allow | deny. Default: allow
    unmatched_severity: string     # info | warning. Default: warning
```

## Field Reference

### `metadata`

| Field | Required | Description |
|---|---|---|
| `name` | yes | Unique policy identifier. Kebab-case. Must match filename: `<name>.policy.yaml` |
| `version` | yes | Semver version of this policy |
| `description` | yes | One-line purpose statement |
| `labels` | no | Key-value pairs for organizational filtering |

### `spec.scope`

| Field | Required | Description |
|---|---|---|
| `agents` | yes | Agent ID patterns. Supports `*` wildcard. `["*"]` matches all agents |
| `event_types` | yes | Event types to evaluate. `["*"]` for all. Valid values match TraceEvent `event_type` enum |

### `spec.rules[]`

| Field | Required | Description |
|---|---|---|
| `id` | yes | Unique rule identifier within this policy |
| `description` | yes | Human-readable purpose |
| `match` | yes | Matching criteria (see Rule Matching) |
| `action` | yes | `allow`, `deny`, or `require-approval` |
| `severity` | yes | `info`, `warning`, `error`, or `critical` |
| `ci_failure` | no | Explicit override of default CI failure behavior |
| `message` | yes | Message displayed when this rule triggers a violation |
| `on_violation` | no | Escalation configuration |

### `spec.defaults`

| Field | Required | Default | Description |
|---|---|---|---|
| `unmatched_action` | no | `allow` | Action applied to events matching no rule |
| `unmatched_severity` | no | `warning` | Severity assigned to logged unmatched events |

## Rule Matching

### Evaluation Order

Rules are evaluated **in order** as listed in the YAML file. **First matching rule wins.** Once an event matches a rule, no subsequent rules are evaluated for that event.

This means:
- Place specific allowlist rules before broad deny rules
- Rule order is semantically significant — reordering changes behavior

### Match Conditions

Within a single rule's `match.payload`, all conditions must hold (**AND logic**). An event matches a rule if:

1. `match.event_type` (if specified) matches the event's `event_type`
2. All `match.payload` conditions are satisfied

### Operator Reference

| Operator | Description | Value Type | Example |
|---|---|---|---|
| `eq` | Exact equality | any | `{ field: "tool_name", operator: "eq", value: "shell_exec" }` |
| `neq` | Not equal | any | `{ field: "exit_code", operator: "neq", value: 0 }` |
| `in` | Value is in list | array | `{ field: "tool_name", operator: "in", value: ["file_read", "file_write"] }` |
| `not_in` | Value is not in list | array | `{ field: "model", operator: "not_in", value: ["gpt-3.5-turbo"] }` |
| `matches` | Regex match (ECMAScript RegExp) | string | `{ field: "arguments.path", operator: "matches", value: "^/etc/.*" }` |
| `contains` | Substring match | string | `{ field: "content", operator: "contains", value: "password" }` |
| `exists` | Field is present | boolean | `{ field: "approval_status", operator: "exists", value: true }` |

### Dot-Notation Field Paths

The `field` value uses dot notation to traverse nested payload objects:

- `tool_name` — top-level payload field
- `arguments.path` — nested field
- `usage.prompt_tokens` — nested field in LLM response payloads

## Actions

### `allow`

Explicitly permits the matched event. Useful for allowlisting specific operations before a broad deny rule.

- No violation is recorded
- The event passes policy evaluation

### `deny`

Blocks the matched event. A violation is recorded with the specified severity.

- If `ci_failure` is `true` (default for `error`/`critical`), the Policy Gate fails
- The violation message is included in CI output

### `require-approval`

Flags the matched event for manual approval. The event is neither allowed nor denied until a human reviews it.

- CI blocks until approval is granted or denied
- Creates an approval request in the configured notification channel
- If no `on_violation.notify` is configured, CI fails with a descriptive message

## Severity Levels and CI Mapping

| Severity | Default `ci_failure` | CI Exit Code | Behavior |
|---|---|---|---|
| `critical` | `true` | 2 | CI fails. Immediate attention required. |
| `error` | `true` | 1 | CI fails. Must be fixed before merge. |
| `warning` | `false` | 0 | CI passes. Logged for awareness. |
| `info` | `false` | 0 | CI passes. Informational only. |

The `ci_failure` field on individual rules can override these defaults. Setting `ci_failure: true` on a `warning`-severity rule will cause CI failure. Setting `ci_failure: false` on an `error`-severity rule will allow CI to pass (use with caution).

## Policy Verdict

The Policy Verdict is the aggregate result of evaluating all events in a Trace against a Policy.

| Verdict | Condition |
|---|---|
| `pass` | Zero violations with `ci_failure: true` |
| `fail` | One or more violations with `ci_failure: true` |
| `require-approval` | At least one `require-approval` action triggered, zero `ci_failure: true` violations |

### Exit Code Mapping

```
pass             → exit 0
fail (error)     → exit 1
fail (critical)  → exit 2  (highest severity wins)
require-approval → exit 3
```

## Policy Composition

Multiple policies can be evaluated against the same Trace. Each policy is evaluated independently. The final verdict follows **most restrictive wins**:

1. If any policy produces `fail` → final verdict is `fail`
2. Else if any policy produces `require-approval` → final verdict is `require-approval`
3. Else → final verdict is `pass`

Exit code is the maximum across all individual policy exit codes.

## Examples

### Example 1: Deny Shell Execution

```yaml
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: no-shell-exec
  version: "1.0.0"
  description: Deny all shell command execution

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
      message: "Shell execution is not permitted"

  defaults:
    unmatched_action: allow
```

### Example 2: Require Approval for File Writes Outside Workspace

```yaml
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: workspace-boundary
  version: "1.0.0"
  description: Require approval for file writes outside the workspace directory

spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]

  rules:
    - id: allow-workspace-writes
      description: Allow writes within /workspace
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: file_write
          - field: arguments.path
            operator: matches
            value: "^/workspace/.*"
      action: allow
      severity: info
      message: "Workspace write permitted"

    - id: approve-external-writes
      description: Require approval for writes outside workspace
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: file_write
      action: require-approval
      severity: error
      message: "File write outside workspace requires approval"
      on_violation:
        notify: ["slack:#agent-reviews"]
        create_issue: true

  defaults:
    unmatched_action: allow
```

### Example 3: Rate-Limit Tool Calls

```yaml
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: tool-call-limits
  version: "1.0.0"
  description: Flag sessions with excessive tool calls
  labels:
    environment: production

spec:
  scope:
    agents: ["*"]
    event_types: ["lifecycle"]

  rules:
    - id: excessive-tool-calls
      description: Flag sessions exceeding 500 tool calls
      match:
        event_type: lifecycle
        payload:
          - field: action
            operator: eq
            value: session_end
          - field: context.tool_call_count
            operator: exists
            value: true
      action: deny
      severity: warning
      ci_failure: false
      message: "Session exceeded tool call threshold — review for optimization"

  defaults:
    unmatched_action: allow
```

## Policy File Conventions

| Convention | Rule |
|---|---|
| File extension | `.policy.yaml` |
| File naming | Must match `metadata.name`: `no-shell-exec.policy.yaml` |
| Storage location | `policies/` directory at repository root |
| Version control | All policies must be committed to version control |
| Review requirement | Policy changes require PR review (see [PR review process](../20_development/pr_review.md)) |

## CLI Invocation

```bash
krynix evaluate --trace <trace-file> --policy <path>
```

- `--trace` — path to a `.trace.jsonl` file
- `--policy` — path to a directory of `.policy.yaml` files (all are evaluated) or a single `.policy.yaml` file
- Exit code follows the mapping defined in this spec
- Stdout reports violations in structured JSON format

## Future Work

- ~~**Policy Testing:** A `krynix policy test` command for validating policies against sample traces without running a full agent session.~~ **Implemented** — `krynix policy test --policy <file> --trace <file> [--expect-verdict <verdict>]`
- ~~**Policy Inheritance:** Allow policies to extend a base policy, overriding or adding rules.~~ **Implemented** — `metadata.extends` field with `resolvePolicy()` and `mergePolicy()` in `@krynix/policy`.
- **Runtime Evaluation:** Real-time policy evaluation during agent execution (pre-action gating), complementing the current CI-time post-hoc model.
- **PCRE Support:** PCRE regex support may be added in v2+ via a dedicated regex engine. The v1 `matches` operator uses ECMAScript RegExp (Node.js `RegExp`) which covers the majority of use cases.
