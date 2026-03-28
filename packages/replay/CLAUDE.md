# @krynix/replay

Replay and integrity verification engine. Depends on `@krynix/core` only.

## Key Exports

- `extractEnvelope(events)` — extract replay envelope from session_start event
- `runReplay(events, options)` — verify hash chain integrity + baseline comparison
- `compareTraces(baseline, candidate)` — diff two traces for drift detection

## Current Guarantees

- `CURRENT`: Hash chain integrity verification, envelope extraction.
- `PARTIAL`: Baseline drift comparison.
- `PLANNED`: Deterministic execution replay.

## Constraints

- `SeededRandom` must produce deterministic results for same seed across runs.
- `replaySeed` validation: positive safe integer only (rejects 0, negative, NaN, Infinity).
