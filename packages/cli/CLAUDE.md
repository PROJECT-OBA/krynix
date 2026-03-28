# @krynix/cli

Command-line interface. Depends on `@krynix/core`, `@krynix/policy`, `@krynix/replay`.

## Commands

- `krynix evaluate` — evaluate a trace against a policy
- `krynix replay` — verify trace integrity and run baseline comparison
- `krynix validate` — validate trace file format

## Key Behavior

- Exit codes from policy evaluation map directly to process exit codes.
- Typed errors from core modules are caught and mapped to user-friendly messages.
- This is the only package that may have side effects (stdout, stderr, process.exit).
