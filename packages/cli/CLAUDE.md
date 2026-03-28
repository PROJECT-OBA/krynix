# @krynix/cli

Command-line interface. Depends on `@krynix/core`, `@krynix/policy`, `@krynix/replay`.

## Commands

- `krynix evaluate --trace <file> --policy <file-or-dir>` — evaluate a trace against policies
- `krynix replay --trace <file>` — verify trace integrity and run baseline comparison
- `krynix validate --policy <file-or-dir>` — validate policy file syntax

## Key Behavior

- Exit codes from policy evaluation map directly to process exit codes.
- Typed errors from core modules are caught and mapped to user-friendly messages.
- This is the only package that may have side effects (stdout, stderr, process.exit).
