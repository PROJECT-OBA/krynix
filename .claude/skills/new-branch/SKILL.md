---
name: new-branch
description: Create a new feature branch from main with proper naming
allowed-tools: Bash
user-invocable: true
argument-hint: [branch-type/description, e.g. "feat/add-metrics" or "fix/seed-validation"]
---

Create a new branch from an up-to-date main.

## Steps

1. Ensure working tree is clean (`git status`)
2. Switch to main and pull latest: `git checkout main && git pull`
3. Create and switch to the new branch: `git checkout -b $ARGUMENTS`

## Branch Naming Convention

Branches must follow: `{type}/{short-description}`

Valid types:
- `feat/` — new features
- `fix/` — bug fixes
- `chore/` — maintenance
- `docs/` — documentation only

If the user's input doesn't follow this convention, suggest a correction.
