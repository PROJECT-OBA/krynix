# Runbook: Runtime Adapter Onboarding

## Purpose
Guide framework teams through runtime adapter integration with deterministic trace capture.

## Prerequisites
- Runtime exposes lifecycle/tool/LLM hooks.
- Adapter package wiring available.
- Policy directory and CI gate job configured.

## Setup Steps
1. Implement adapter lifecycle (`initialize -> onEvent -> flush -> shutdown`).
2. Map framework events to canonical trace event types.
3. Ensure metadata namespace usage (`intent/guard/runtime/output`).
4. Use write queue to preserve event ordering under concurrency.
5. Add CI trust gates for evaluate + replay.

## Minimal Commands
```bash
# Verify generated trace
krynix evaluate --trace traces/session.trace.jsonl --policy policies/
krynix replay --verify --trace traces/session.trace.jsonl
```

## Expected Artifacts
- runtime-produced `.trace.jsonl`
- CI policy verdict output
- replay integrity output
- optional golden trace integrity verification output

## Troubleshooting
- Broken hash chain:
  - verify event ordering and session finalization.
- Missing lifecycle events:
  - ensure explicit session start/end emission path.
- High false-positive rate:
  - adjust policy scope and matching precision.

## Rollback / Disable Switches
- Keep tracing enabled but switch enforcement profile to monitor-only.
- Temporarily disable specific high-noise policy rules.
- Fallback to CI-only enforcement while runtime tuning continues.
