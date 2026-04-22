# @krynix/policy

Policy evaluation engine for [Krynix](https://github.com/PROJECT-OBA/krynix) — YAML policy parsing, rule matching, and trace evaluation with deterministic CI exit codes.

## Install

```bash
npm install @krynix/policy
```

## Key Exports

- **`evaluate(trace, policy)`** — evaluate a trace against a policy, returns verdict + violations
- **`matchRule(event, rule)`** — match a single event against a rule
- **`parsePolicy`** — parse a YAML policy file into a typed `Policy` object

## Usage

```typescript
import { evaluate, parsePolicy } from "@krynix/policy";
import { readTrace } from "@krynix/core";

const events = await readTrace("/path/to/trace.jsonl");
const policy = parsePolicy(`
  apiVersion: krynix.dev/v1
  kind: Policy
  metadata:
    name: no-shell-exec
    version: "1.0"
    description: Block shell command execution
  spec:
    scope:
      agents: ["*"]
      event_types: ["tool_call"]
    rules:
      - id: block-shell
        description: Deny shell tool calls
        match:
          event_type: tool_call
          payload:
            - field: tool_name
              operator: eq
              value: shell_exec
        action: deny
        severity: error
        message: "Shell execution is not permitted"
`);

const result = evaluate(events, policy);
// result.verdict: "pass" | "fail" | "require-approval"
// result.exitCode: 0 (pass), 1 (error), 2 (critical), 3 (require-approval)
// result.violations: array of matched deny/require-approval rules
```

## Evaluation Semantics

- **First-match-wins**: for each event, the first matching rule determines the outcome. Order your rules from most specific to most general.
- **Scope filtering**: events outside `scope.agents` / `scope.event_types` are skipped entirely.
- **Deterministic exit codes**: same trace + same policy always produces the same result.

## Operators

| Operator | Description | Example Value |
|----------|-------------|---------------|
| `eq` | Strict equality | `"shell_exec"` |
| `neq` | Strict inequality | `"shell_exec"` |
| `in` | Value is in array | `["shell_exec", "bash"]` |
| `not_in` | Value is not in array | `["shell_exec", "bash"]` |
| `matches` | Regex match (Unicode) | `"^(shell\|bash\|exec).*"` |
| `contains` | Substring search | `"shell"` |
| `exists` | Field is present and non-null | `true` or `false` |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Pass — no CI-failing violations |
| `1` | Error-severity violation or runtime error |
| `2` | Critical-severity violation |
| `3` | Requires approval — no CI-failing violations but approval needed |

## Rule Types

- **Per-event rules**: Match individual events based on `event_type` and `payload` field conditions.
- **Sequence rules**: Match patterns across multiple events in a session (e.g., "tool_call followed by tool_call without an intervening llm_request").

## License

Apache 2.0
