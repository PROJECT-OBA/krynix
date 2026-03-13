# Documentation Governance

## Purpose
Define documentation authority, review requirements, and change control for architecture and trust claims.

## Source-Of-Truth Precedence
1. `docs/10_architecture/platform_architecture_spec.md` (authoritative narrative source)
2. Domain specifications under `docs/10_architecture/*` (must not conflict with canonical spec)
3. `README.md` and `wiki/*` (entry/onboarding surfaces; must defer to canonical spec)
4. Agent rule docs (`AGENTS.md`, `CLAUDE.md`, `.agents/*`) (must follow canonical claims)
5. Backlog docs under `docs/20_development/phase1_backlog.md` and `phase1_milestones.md` (canonical planning source)
6. ADRs (`docs/30_decisions/*`) for irreversible decisions and tradeoffs only

## Required Reviewers For Trust/Architecture Claims
- Product owner (scope and roadmap alignment)
- Platform owner (implementation feasibility and operational semantics)
- Security owner (trust and redaction claims)

Any PR that changes guarantees or enforcement semantics requires all three sign-offs.

## PR Checklist For Docs That Touch Guarantees
- [ ] Claims are tagged with `CURRENT`, `PARTIAL`, or `PLANNED`.
- [ ] Every canonical `CURRENT` claim includes an `Evidence:` line with code/test/doc path references.
- [ ] Any changed claim is reconciled with canonical spec.
- [ ] README language remains entry-level and non-contradictory.
- [ ] Wiki pages either match canonical claims or explicitly defer to canonical docs.
- [ ] Agent rule files prevent unsupported guarantee statements.

## Backlog -> GitHub Issue Sync Rules
- Every task in `phase1_backlog.md` must have a stable task ID (`PH1-E{n}-M{n}.{n}-T{n}.{n}`).
- GitHub issue titles must start with the task ID.
- GitHub issue body must link to the canonical backlog row.
- PRs must reference their issue and include acceptance criteria checklist.
- Task status in backlog must be updated when issue/PR status changes.

## Orchestration Ownership And On-Call
- Primary owner: platform engineering (workflow reliability and automation incidents).
- Secondary owner: security engineering (governance and trust-claim integrity).
- Escalation policy:
  - broken sync/delegation/checkpoint workflows are triaged within one business day,
  - automation-caused incorrect issue state changes are reverted and documented in the weekly checkpoint.

## Normative Label Taxonomy
- Type:
  - `type:epic`
  - `type:task`
- Status:
  - `status:todo`
  - `status:in_progress`
  - `status:blocked`
  - `status:done`
- Assignment:
  - `epic:E1` ... `epic:E5`
  - `milestone:Mx.y`
- Agent lifecycle:
  - `agent:ready`
  - `agent:in-progress`
  - `agent:failed`
  - `agent:done`

Labels above are required for orchestration and must not be renamed without updating automation scripts and this document.

## Sync Precedence Rules
- Docs canonical wins for:
  - task identity, scope, and acceptance criteria (`phase1_backlog.md`).
- GitHub canonical wins for:
  - execution status and lifecycle labels during active delivery.
- Reconciliation mechanism:
  - orchestration updates docs from GitHub execution state via bot-authored PRs,
  - human reviewers verify status changes before merge.

## Weekly Checkpoint Requirement
- Weekly updates are mandatory in `docs/20_development/weekly_checkpoints.md`.
- Each update must include:
  - completed tasks,
  - blockers,
  - risk changes,
  - scope changes,
  - next week focus.
- Weekly checkpoint PRs require platform + security review.

## CI Documentation Checks
- Broken link check across `README.md`, `docs/`, and `wiki/`.
- Terminology check against `docs/00_overview/glossary_platform.md`.
- Claim-status tag check for canonical architecture docs.
- Evidence marker check for canonical `CURRENT` claims.
- README-to-canonical consistency assertions for key statements.

## Change Control Rules
- No architecture guarantee change without updating both canonical spec and at least one evidence reference.
- No runtime security claim may be stated as `CURRENT` unless backed by code paths and tests in this repository.
- Backlog model changes require update of both backlog docs and governance rules.
- Orchestration behavior changes require updates to:
  - `docs/20_development/github_orchestration.md`,
  - `.github/workflows/planning-*.yml`,
  - `scripts/planning/orchestrator.mjs` command docs/usage.
- Use ADRs only after a decision is final and difficult to reverse.
