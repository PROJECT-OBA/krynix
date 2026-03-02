# WORKFLOW.md

## Branching
- `feat/<short-description>`
- `fix/<short-description>`
- `chore/<short-description>`
- `docs/<short-description>`

## Commits
Use Conventional Commits.

## Pull Requests
PR must include:
- change summary
- tests (or explicit N/A)
- guarantee impact note (`CURRENT/PARTIAL/PLANNED`)
- documentation impact note
- evidence refs for `CURRENT` claims in canonical docs

If trust/architecture claims changed:
1. Update canonical spec first.
2. Align README/wiki/agent rules.
3. Run docs CI checks.
