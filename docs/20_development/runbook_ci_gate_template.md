# Runbook: CI Gate Template

## Purpose
Standardize CI trust-gate setup for Krynix policy and replay checks.

## Prerequisites
- Trace artifacts produced in build/test workflow.
- Policies checked into repository.
- Golden traces available for golden trace integrity verification.

## Setup Steps
1. Add policy gate step.
2. Add replay integrity step.
3. Add optional golden trace integrity step.
4. Enforce non-zero exit codes as merge blockers for target profiles.

## Minimal Commands
```bash
krynix evaluate --trace $TRACE --policy policies/
krynix replay --verify --trace $TRACE
krynix replay --verify --golden-dir test/golden/
```

## Expected Artifacts
- policy evaluation logs
- replay verification report
- golden trace integrity report (when golden directory provided)
- CI annotations for violations/integrity failures

## Troubleshooting
- Missing trace file:
  - verify artifact path and upstream generation steps.
- Unexpected approval blockers:
  - inspect `require-approval` evidence and policy rule mapping.
- Golden trace integrity failures after intended behavior update:
  - regenerate golden traces with `krynix replay --regenerate --golden-dir test/golden/` and review.

## Rollback / Disable Switches
- Disable golden trace integrity step temporarily while retaining integrity checks.
- Keep CI warnings for non-critical findings in `dev`/`staging`.
- Re-enable strict blockers after policy/golden trace tuning.
