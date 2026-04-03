# Determinism Specification

## Purpose
Define replay semantics with explicit separation between current implementation guarantees and future deterministic execution goals.

## Where Used
- Replay command behavior (`krynix replay`).
- CI behavioral regression workflows.
- Trust claim validation in docs and agent guidance.

## Guarantees (Current)
Determinism remains a core design principle.

- [CURRENT] Deterministic trace production exists through canonical JSON + hash chain + seeded session/event behavior (when seed is provided).  
  Evidence: `packages/core/src/canonical-json.ts`, `packages/core/src/session.ts`, `packages/core/src/trace-writer.ts`
- [CURRENT] `krynix replay --verify` validates trace structure, lifecycle, contiguous sequence, session consistency, envelope extractability, and hash integrity.  
  Evidence: `packages/replay/src/replay-runner.ts`, `packages/replay/src/golden-validator.ts`
- [CURRENT] Hash recomputation determinism is verified by strip-and-recompute checks.  
  Evidence: `packages/replay/src/replay-runner.ts`, `packages/replay/src/replay-runner.test.ts`
- [PARTIAL] `compareTraces` library function compares two trace event arrays for structural drift. Not yet wired into the CLI's `--golden-dir` flag.
  Evidence: `packages/replay/src/comparator.ts`, `packages/replay/src/comparator.test.ts`
- [CURRENT] Replay verification is artifact-based; it does not execute live agent decision/tool code paths.  
  Evidence: `packages/replay/src/replay-runner.ts`, `packages/cli/src/replay.ts`

Current CLI replay guarantee is integrity verification. Drift comparison exists at library level (`compareTraces`) but is not CLI-accessible.
Execution replay is planned and tracked.

## Planned Guarantees (Future)
- [PLANNED] Execution replay mode that re-runs deterministic decision/tool paths through a replay executor contract.
- [PLANNED] Explicit replay mode selection (`integrity`, `execution`) with stricter mode-specific assertions.
- [PLANNED] Deterministic external I/O adapters for execution replay.

## Non-Goals
- [CURRENT] Cross-platform floating-point bit identity.  
  Evidence: `docs/10_architecture/trace_spec.md`
- [CURRENT] Guaranteeing deterministic LLM provider outputs.  
  Evidence: `docs/00_overview/non_goals.md`
- [CURRENT] Claiming execution replay as currently implemented.  
  Evidence: `packages/replay/src/replay-runner.ts`

## Interfaces / Contracts

### Current Replay Modes
- `--verify`:
  - Verifies integrity and structure.
  - `--golden-dir` verifies integrity of all traces in a directory (does not perform drift comparison).
- `--regenerate`:
  - Recomputes hash chains and overwrites trace artifacts.

### Drift Detection Contract (PLANNED for CLI)
- Library API: `compareTraces(baseline, candidate)` in `@krynix/replay` (`PARTIAL` — exists and tested).
- CLI integration: not yet wired into `krynix replay` command.
- Planned inputs: `--trace <current>` and `--golden-dir <golden-dir>`.
- Planned output: pass or divergence report from trace comparator.

## Operational Usage
```bash
# Integrity verification
krynix replay --verify --trace traces/session.trace.jsonl

# Verify all golden traces for integrity
krynix replay --verify --golden-dir test/golden/
```

## Known Gaps And Roadmap
- [PARTIAL] Behavior comparison exists as library function (`compareTraces`); CLI integration is planned.
- [PLANNED] Replay executor RFC and interface rollout.
- [PLANNED] Transition path from artifact diffing to execution replay assurance.
