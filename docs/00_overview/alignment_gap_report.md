# Alignment Gap Report

## Purpose
Document contradictions and ambiguity across repository docs and agent rules before canonical rewrites.

## Scope Reviewed
- `README.md`
- `docs/00_overview/*`
- `docs/10_architecture/*`
- `docs/20_development/*`
- `wiki/*`
- `CLAUDE.md`
- `.agents/*`
- CLI help semantics in `packages/cli/src/help.ts`

## Current-State Claims By File
| File | Claim Snapshot | Confidence |
|---|---|---|
| `README.md` | Presents replay as deterministic re-execution and determinism envelope as current behavior. | High |
| `docs/10_architecture/architecture.md` | States replay component re-executes decisions/tool paths today. | High |
| `docs/10_architecture/determinism_spec.md` | Specifies execution replay envelope as implemented behavior. | High |
| `docs/10_architecture/policy_spec.md` | Mixes CI-time semantics with optional runtime semantics; runtime unclear. | High |
| `docs/00_overview/product_model.md` | Claims deterministic replay engine as fully available in OSS. | High |
| `docs/00_overview/glossary.md` | Defines replay as deterministic re-execution as if current. | High |
| `wiki/Replay.md` | Mirrors deterministic execution replay as current. | High |
| `wiki/Architecture-Overview.md` | Mirrors deterministic execution replay as current. | High |
| `wiki/Trust-Pipeline.md` | Treats replay as proof-by-execution rather than integrity + diff today. | High |
| `wiki/FAQ.md` | Uses broad replay and redaction guarantees without current-limit qualifiers. | High |
| `wiki/Getting-Started.md` | Onboarding path implies deterministic replay verification as implemented. | Medium |
| `wiki/CLI-Reference.md` | Replay section omits `--baseline`; diverges from current CLI semantics. | High |
| `CLAUDE.md` | Uses "guarantees" language that can overstate implemented behavior. | High |
| `.agents/SYSTEM.md` | States deterministic re-execution and runtime trust-layer framing as current. | High |
| `.agents/RULES.md` | Missing explicit truth-label requirement for docs claims. | High |
| `packages/cli/src/help.ts` | Correctly scopes `--verify` to integrity and `--baseline` to drift detection. | High |

## Contradictions And Ambiguities

### CR-1: Replay guarantee mismatch
- Severity: `critical`
- Contradiction: docs/wiki/agent rules describe deterministic re-execution as current; CLI/help and replay implementation perform structural/integrity checks and optional baseline trace diff.
- Evidence:
  - Claim side: `README.md`, `docs/10_architecture/determinism_spec.md`, `wiki/Replay.md`
  - Actual behavior side: `packages/replay/src/replay-runner.ts`, `packages/cli/src/replay.ts`, `packages/cli/src/help.ts`

### CR-2: Redaction guarantee overstatement
- Severity: `major`
- Contradiction: docs imply generic secret redaction coverage; implementation is key-name-pattern based and misses many non-suffix variants unless custom patterns are configured.
- Evidence:
  - Claim side: `README.md`, `wiki/FAQ.md`, `docs/00_overview/glossary.md`
  - Actual behavior side: `packages/core/src/redaction.ts`

### CR-3: Platform role ambiguity (spine vs full platform)
- Severity: `major`
- Contradiction: some docs frame Krynix as runtime trust layer itself; strategic direction requires Krynix as trust spine across input/runtime/output platform layers.
- Evidence:
  - Claim side: `README.md`, `CLAUDE.md`, `.agents/SYSTEM.md`, `wiki/Home.md`
  - Direction target: docs plan and platform architecture objective.

### CR-4: Runtime enforcement ambiguity
- Severity: `major`
- Contradiction: policy docs mention optional runtime evaluation, while architecture and usage docs often imply CI-first post-run enforcement only. Runtime blocking ownership is unclear.
- Evidence:
  - Ambiguous files: `docs/10_architecture/policy_spec.md`, `docs/10_architecture/architecture.md`, `wiki/Policy.md`, `wiki/Trust-Pipeline.md`

### CR-5: CLI semantics drift in wiki
- Severity: `minor`
- Contradiction: wiki CLI reference omits current `--baseline` replay mode and related behavior-drift semantics.
- Evidence:
  - Outdated docs: `wiki/CLI-Reference.md`
  - Current semantics: `packages/cli/src/help.ts`, `packages/cli/src/replay.ts`

## Implemented vs Partial vs Planned Capability Classification
| Capability | Status | Notes |
|---|---|---|
| Trace schema + hash-chain integrity | Implemented | Mature and tested in `@krynix/core`. |
| Policy parsing/evaluation + CI exit codes | Implemented | Primary enforcement contract in OSS. |
| Replay integrity validation (`--verify`) | Implemented | Structural/lifecycle/hash checks and deterministic hash recomputation. |
| Replay drift detection (`--baseline`) | Partial | Trace-vs-trace behavior comparison exists, not execution replay. |
| Deterministic execution replay of agent logic | Planned | Not implemented in OSS currently. |
| Redaction guarantees | Partial | Built-in pattern matching + custom patterns; coverage not universal. |
| Runtime inline blocking by Krynix OSS | Partial | Integration architecture discussed, but core OSS guarantee remains CI/post-run. |
| Input/Runtime/Output layered platform contracts | Planned | Document contract drafts only in this phase. |

## Mandatory Findings (Explicit)
1. Replay is currently integrity + diff (with baseline), not true deterministic execution replay.
2. Redaction guarantees are scoped to pattern-matched fields and should be documented as limited, not comprehensive.
3. Krynix role in the layered platform is trust spine, not full platform ownership.
4. Current enforcement is CI/post-run in OSS; runtime-preventative controls are external or planned.

## Closure Criteria For This Report
- All `critical` and `major` contradictions mapped to concrete doc/rule edits.
- Canonical spec introduced and referenced as source of truth.
- README/wiki/agent instructions updated to match current behavior labels.
