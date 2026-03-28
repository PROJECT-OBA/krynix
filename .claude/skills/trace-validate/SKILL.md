---
name: trace-validate
description: Validate a trace file's format and evaluate it against a policy in one step
allowed-tools: Bash, Read, Glob
user-invocable: true
argument-hint: <trace-file> [policy-file]
---

Validate and evaluate a trace file against a policy.

## Arguments

- `$ARGUMENTS` format: `<trace-file> [policy-file]`
- If no policy file is provided, look for `policies/default.yaml` or the first `.yaml` file in `policies/`

## Steps

1. Parse arguments to extract trace file path and optional policy file path
2. Verify the trace file exists
3. Run `pnpm --filter @krynix/cli exec krynix validate <trace-file>` to check format validity
4. If a policy file is provided or found, run `pnpm --filter @krynix/cli exec krynix evaluate <trace-file> --policy <policy-file>`
5. Report results clearly: validation status, policy evaluation outcome, and any violations found

## Output Format

```
Trace:  <path>
Policy: <path or "none">

Validation: PASS / FAIL
Evaluation: PASS (exit 0) / WARN (exit 2) / FAIL (exit 1) / skipped
```

If evaluation fails, list the violated rules.
