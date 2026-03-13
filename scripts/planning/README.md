# Planning Orchestrator

## Purpose
Sync canonical planning docs with GitHub execution artifacts (epics, milestones, task issues) and automate delegation/checkpoints.

## CLI
```bash
node scripts/planning/orchestrator.mjs sync --apply
node scripts/planning/orchestrator.mjs audit
node scripts/planning/orchestrator.mjs delegate --apply --max-parallel 2
node scripts/planning/orchestrator.mjs checkpoint --apply
```

## Command Behavior
- `sync`:
  - ensures required labels exist,
  - ensures milestones and epic/task issues exist,
  - reconciles backlog Issue/Status cells.
- `audit`:
  - dry-run sync and fail if drift is detected.
- `delegate`:
  - dispatches `.github/workflows/agent-task.yml` for eligible `agent:ready` tasks.
- `checkpoint`:
  - appends weekly checkpoint summary from issue status labels.

## Authentication
The script requires `gh` and GitHub auth:
- CI: `GH_TOKEN`/`GITHUB_TOKEN` environment variable.
- Local: authenticated `gh auth login` session.
