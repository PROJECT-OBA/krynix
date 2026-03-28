---
name: pre-commit
description: Run pre-commit checks, stage changes, and create a well-formatted conventional commit
allowed-tools: Bash, Read, Grep, Glob
user-invocable: true
argument-hint: [commit message, e.g. "fix(core): handle optional replaySeed"]
---

Run pre-commit validation and create a commit with the provided message.

## Steps

1. Run the full CI check sequence:
   ```bash
   pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm test && pnpm build
   ```

2. If any check fails, report the failure and do NOT commit. Suggest fixes.

3. If all checks pass, show `git status` and `git diff --staged` to confirm what will be committed.

4. Validate the commit message follows Conventional Commits: `type(scope): description`
   - Valid types: `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore`
   - Valid scopes: `core`, `policy`, `replay`, `cli`, `adapters`

5. Create the commit using: $ARGUMENTS

6. Use a HEREDOC for the commit message to preserve formatting.
