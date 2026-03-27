---
name: pre-commit
description: Run pre-commit checks, stage changes, and create a well-formatted commit
allowed-tools: Bash, Read, Grep
user-invocable: true
argument-hint: [commit message]
---

Run pre-commit validation and create a commit with the provided message.

## Steps

1. Run the full CI check sequence:
   ```bash
   pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm test && pnpm build
   ```

2. If any check fails, report the failure and do NOT commit. Suggest fixes.

3. If all checks pass, show `git status` and `git diff --staged` to confirm what will be committed.

4. Create the commit using Conventional Commits format with the user's message: $ARGUMENTS

5. Use a HEREDOC for the commit message to preserve formatting.
