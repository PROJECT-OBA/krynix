# Replay

Canonical source: `docs/10_architecture/determinism_spec.md`.

Determinism remains a core design principle.
Current replay guarantee is integrity verification via CLI. Drift comparison exists at library level (`compareTraces`) but is not CLI-accessible.
Execution replay is planned and tracked.

## Current Replay Modes
- `CURRENT` integrity mode: `krynix replay --verify`
  - validates structure/lifecycle/session/hash/envelope integrity.
- `CURRENT` golden directory mode: `krynix replay --verify --golden-dir <dir>`
  - verifies integrity of all `*.trace.jsonl` files in the directory.
- `PARTIAL` drift comparison: `compareTraces` library function in `@krynix/replay`
  - compares two trace event arrays for structural drift. Not yet integrated into the CLI.

## Not Current
- `PLANNED` execution replay mode that deterministically re-runs agent logic.

## Commands
```bash
krynix replay --verify --trace traces/session.trace.jsonl
krynix replay --verify --golden-dir test/golden/
krynix replay --regenerate --trace traces/session.trace.jsonl
```
