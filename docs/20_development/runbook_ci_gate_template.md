# Runbook: CI Gate Template

## Purpose
Standardize CI trust-gate setup for Krynix policy and replay checks.

## Prerequisites
- Trace artifacts produced in build/test workflow.
- Policies checked into repository.
- Baseline traces available for drift-sensitive scenarios.

## Setup Steps
1. Add policy gate step.
2. Add replay integrity step.
3. Add optional baseline drift step.
4. Enforce non-zero exit codes as merge blockers for target profiles.

## Minimal Commands
```bash
krynix evaluate --trace $TRACE --policy policies/
krynix replay --verify --trace $TRACE
krynix replay --verify --trace $TRACE --baseline $BASELINE_TRACE
```

## Expected Artifacts
- policy evaluation logs
- replay verification report
- drift comparison report (when baseline provided)
- CI annotations for violations/divergence

## Troubleshooting
- Missing trace file:
  - verify artifact path and upstream generation steps.
- Unexpected approval blockers:
  - inspect `require-approval` evidence and policy rule mapping.
- Drift failures after intended behavior update:
  - regenerate/refresh approved baseline trace through review workflow.

## Rollback / Disable Switches
- Disable baseline drift step temporarily while retaining integrity checks.
- Keep CI warnings for non-critical findings in `dev`/`staging`.
- Re-enable strict blockers after policy/baseline tuning.
