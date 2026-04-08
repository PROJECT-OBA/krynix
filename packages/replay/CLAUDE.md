# @krynix/replay

Replay and integrity verification engine. Depends on `@krynix/core` only.

## Key Exports

- `verifyTrace(trace, options)` — verify hash chain integrity for a single trace
- `verifyGoldenDir(directory, options)` — verify all traces in a golden-directory tree
- `regenerateTrace(input, options)` — regenerate hash chains in a trace file
- `extractEnvelope(events)` — extract replay envelope from session_start event
- `compareTraces(baseline, candidate)` — diff two traces for drift detection

## Current Guarantees

- `CURRENT`: Hash chain integrity verification, envelope extraction.
- `CURRENT`: Baseline drift comparison via `compareTraces` (library) and `krynix replay --compare` (CLI).
- `PLANNED`: Deterministic execution replay.

## Constraints

- `SeededRandom` must produce deterministic results for same seed across runs.
- `replaySeed` validation: positive safe integer only (rejects 0, negative, NaN, Infinity).
