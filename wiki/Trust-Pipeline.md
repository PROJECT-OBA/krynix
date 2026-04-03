# Trust Pipeline

Canonical source: `docs/10_architecture/platform_architecture_spec.md`.

## Current Pipeline
1. Capture trace evidence (`TraceEvent` stream with hash chain).
2. Evaluate policies (`krynix evaluate`).
3. Verify replay integrity (`krynix replay --verify`).
4. Verify golden trace integrity (`krynix replay --verify --golden-dir ...`).

Status:
- `CURRENT`: integrity + policy CI gate.
- `PARTIAL`: behavior drift comparison exists as library function (`compareTraces`); not yet CLI-integrated.
- `PLANNED`: deterministic execution replay.

## CI Example
```yaml
- name: Policy Gate
  run: pnpm krynix evaluate --trace $TRACE --policy policies/

- name: Replay Integrity Gate
  run: pnpm krynix replay --verify --trace $TRACE
```
