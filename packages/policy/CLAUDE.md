# @krynix/policy

Policy evaluation engine. Among internal packages, depends on `@krynix/core` only.

## Key Exports

- `evaluate(trace, policy)` — evaluate a trace against a policy, returns verdict + violations
- `matchRule(event, rule)` — match a single event against a rule
- `Policy`, `PolicyRule`, `Severity` — schema types

## Evaluation Semantics

- **First-match-wins**: for each event, the first matching rule determines the outcome.
- **Scope filtering**: events outside `scope.agents` / `scope.event_types` are skipped.
- **Operators**: `eq`, `neq`, `in`, `not_in`, `matches`, `contains`, `exists`.
- **Exit codes**: 0 (pass), 1 (error), 2 (critical), 3 (require-approval).
- **`ci_failure` override**: can force CI failure/pass regardless of severity defaults.
