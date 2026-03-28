---
name: docs-check
description: Run documentation governance checks to verify docs consistency and claim accuracy
allowed-tools: Bash, Read
user-invocable: true
model: haiku
---

Run the documentation governance checks.

## Steps

1. Run `pnpm docs:check` from the repository root
2. If checks fail, summarize which files have issues and what needs fixing
3. If checks pass, confirm all documentation is consistent

## Output Format

Report pass/fail status. On failure, list each issue with the file path and description.
