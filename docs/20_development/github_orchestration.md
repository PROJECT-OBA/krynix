# GitHub Orchestration

## Purpose
Operationalize Phase 1 planning in GitHub while preserving docs as canonical planning source.

## Source Of Truth
- Planning scope, acceptance criteria, and task hierarchy are defined in `docs/20_development/phase1_backlog.md`.
- GitHub issues and milestones are the execution surface.

## Commands
Use `scripts/planning/orchestrator.mjs`:

```bash
# Create/update labels, milestones, epic/task issues, and sync backlog Issue/Status cells
node scripts/planning/orchestrator.mjs sync --apply

# Report drift (non-zero exit when drift exists)
node scripts/planning/orchestrator.mjs audit

# Delegate eligible tasks to agent-task workflow
node scripts/planning/orchestrator.mjs delegate --apply --max-parallel 2

# Append weekly checkpoint entry based on GitHub issue state
node scripts/planning/orchestrator.mjs checkpoint --apply
```

## Workflow Automation
- `.github/workflows/planning-sync.yml`
  - Trigger: push to `main` when planning docs change + manual dispatch.
  - Action: run `sync`; open PR if backlog status/link updates are needed.
- `.github/workflows/planning-delegate.yml`
  - Trigger: weekday schedule + manual dispatch.
  - Action: run `delegate` with label-gated eligibility.
- `.github/workflows/planning-weekly-checkpoint.yml`
  - Trigger: weekly schedule + manual dispatch.
  - Action: append `weekly_checkpoints.md`; open PR.

## Label Taxonomy
- Type labels:
  - `type:epic`
  - `type:task`
- Status labels:
  - `status:todo`
  - `status:in_progress`
  - `status:blocked`
  - `status:done`
- Assignment labels:
  - `epic:E1` ... `epic:E5`
  - `milestone:Mx.y`
- Agent lifecycle labels:
  - `agent:ready`
  - `agent:in-progress`
  - `agent:failed`
  - `agent:done`

## Delegation Eligibility
A task is delegated only when all checks pass:
1. Has `type:task` label.
2. Has `agent:ready` label.
3. Has `status:todo` label (or `status:in_progress` when `--include-in-progress` is set).
4. Dependency IDs listed in `Depends On:` are resolved (`status:done` or closed).
5. No open PR references the issue.

## Task Issue Contract
Task issue title format:
- `[PH1-E1-M1.1-T1.1] task description`

Task issue body sections:
- `## Context`
- `## Scope`
- `## Allowed Files`
- `## Acceptance Criteria`
- `## Required Tests`
- `## Out of Scope`
- `Depends On: ...`

## Failure Modes
- If GitHub API calls fail, orchestration command exits non-zero.
- `audit` is fail-closed by design.
- `delegate` is no-op when no eligible tasks are found.

## Backward Compatibility
`agent-task.yml` supports both task ID formats in issue title prefixes:
- `PH1-E...`
- `TASK-...`
