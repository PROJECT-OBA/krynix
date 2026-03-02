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
- [PARTIAL] `--baseline` compares current trace behavior against baseline trace behavior and reports drift.
- [CURRENT] Replay verification is artifact-based; it does not execute live agent decision/tool code paths.  
  Evidence: `packages/replay/src/replay-runner.ts`, `packages/cli/src/replay.ts`

Current replay guarantee is integrity + baseline diff.
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
  - Optionally paired with `--baseline` for drift comparison.
- `--regenerate`:
  - Recomputes hash chains and overwrites trace artifacts.

### Drift Detection Contract
- Inputs: `--trace <current>` and `--baseline <golden>`.
- Preconditions: both traces pass integrity verification.
- Output: pass or divergence report from trace comparator.

## Operational Usage
```bash
# Integrity verification
krynix replay --verify --trace traces/session.trace.jsonl

# Drift detection
krynix replay --verify --trace traces/current.trace.jsonl --baseline traces/golden.trace.jsonl

# Verify all golden traces for integrity
krynix replay --verify --golden-dir test/golden/
```

## Known Gaps And Roadmap
- [PARTIAL] Behavior comparison exists without deterministic execution of agent logic.
- [PLANNED] Replay executor RFC and interface rollout.
- [PLANNED] Transition path from artifact diffing to execution replay assurance.
