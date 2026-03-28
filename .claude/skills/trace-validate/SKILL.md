---
name: trace-validate
description: Verify a trace file's integrity and evaluate it against a policy in one step
allowed-tools: Bash, Read, Glob
user-invocable: true
argument-hint: <trace-file> <policy-file>
---

Verify and evaluate a trace file against a policy.

## Arguments

- `$ARGUMENTS` format: `<trace-file> <policy-file>`

## Steps

1. Parse arguments to extract trace file path and policy file path
2. Verify both files exist
3. Run `pnpm --filter @krynix/cli exec krynix replay --trace <trace-file>` to verify trace integrity
4. Run `pnpm --filter @krynix/cli exec krynix evaluate --trace <trace-file> --policy <policy-file>`
5. Report results clearly: integrity status, policy evaluation outcome, and any violations found

## Output Format

```
Trace:  <path>
Policy: <path>

Integrity: PASS / FAIL
Evaluation: PASS (exit 0) / ERROR (exit 1) / DENY (exit 2) / REQUIRE APPROVAL (exit 3)
```

If evaluation fails, list the violated rules.
