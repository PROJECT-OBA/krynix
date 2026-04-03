# Replay

Canonical source: `docs/10_architecture/determinism_spec.md`.

Determinism remains a core design principle.
Current replay guarantee is integrity + baseline diff.
Execution replay is planned and tracked.

## Current Replay Modes
- `CURRENT` integrity mode: `krynix replay --verify`
  - validates structure/lifecycle/session/hash/envelope integrity.
- `PARTIAL` baseline drift mode:
  - `krynix replay --verify --trace <current> --golden-dir <golden-dir>`
  - compares current behavior against golden trace behavior.

## Not Current
- `PLANNED` execution replay mode that deterministically re-runs agent logic.

## Commands
```bash
krynix replay --verify --trace traces/session.trace.jsonl
krynix replay --verify --trace traces/current.trace.jsonl --golden-dir test/golden/
krynix replay --verify --golden-dir test/golden/
krynix replay --regenerate --trace traces/session.trace.jsonl
```
