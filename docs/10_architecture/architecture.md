# Architecture

## Purpose
Describe how Krynix functions as the trust spine in a layered agent platform and define current vs future guarantees.

## Where Used
- Architecture decisions for OSS packages and adapters.
- Integration planning for CI pipelines and runtime wrappers.
- Documentation alignment reference for wiki and agent rules.

## Guarantees (Current)
- [CURRENT] Krynix OSS provides trace integrity, policy evaluation, and replay integrity verification.  
  Evidence: `packages/core/src/hash-chain.ts`, `packages/cli/src/evaluate.ts`, `packages/replay/src/replay-runner.ts`
- [CURRENT] CI/post-run enforcement is the primary OSS control boundary.  
  Evidence: `packages/cli/src/evaluate.ts`, `docs/10_architecture/policy_spec.md`
- [CURRENT] Artifacts remain usable offline; Control Plane is additive.
  Evidence: `packages/core/src/session.ts`, `packages/cli/src/evaluate.ts`
- [CURRENT] Behavioral drift detection via `compareTraces` library and `krynix diff` CLI command.
  Evidence: `packages/replay/src/comparator.ts`, `packages/cli/src/diff.ts`
- [PARTIAL] Runtime controls are integration-driven and not a built-in full inline gateway in OSS.

## Planned Guarantees (Future)
- [PLANNED] Execution replay mode for deterministic re-run contracts.
- [PLANNED] Deeper runtime preventative controls via input/runtime/output guard integrations.
- [PLANNED] Profile-based enforcement modes (`dev`, `staging`, `prod`) for sidecar and hybrid deployments.

## Non-Goals
- [CURRENT] Krynix does not execute agents.
  Evidence: `docs/00_overview/non_goals.md`
- [CURRENT] Krynix does not host LLM inference.
  Evidence: `docs/00_overview/non_goals.md`
- [CURRENT] Krynix does not replace CI platforms.
  Evidence: `docs/00_overview/non_goals.md`
- [CURRENT] Krynix does not universally own the request ingress point.
  Evidence: `docs/10_architecture/platform_architecture_spec.md`
- [CURRENT] Krynix does not treat inferred intent alone as the primary trust control.
  Evidence: `docs/10_architecture/platform_architecture_spec.md`

## Interfaces / Contracts

### Layered Platform Model
- Input Layer: request intake, context normalization, prompt/context guards, and optional advisory risk assessment.
- Runtime Layer: tool mediation, pre/post execution checks, approval decisions, and runtime evidence capture.
- Output Layer: response classification, delivery control, provenance, and output guard checks.
- Krynix: cross-layer trust spine for traceability, policy evidence, replay/drift verification, compliance packaging, and control-plane synchronization.

### OSS Component Topology
```text
core  <- policy  <- cli
core  <- replay  <- cli
core  <- adapters
```

### Data Contract Surfaces
- Trace contract: `docs/10_architecture/trace_spec.md`
- Policy contract: `docs/10_architecture/policy_spec.md`
- Replay contract: `docs/10_architecture/determinism_spec.md`
- Integration blueprints: `docs/10_architecture/integration_blueprints.md`

## Operational Usage
Primary CI trust gate:
```bash
krynix evaluate --trace <trace.jsonl> --policy <policy-or-dir>
krynix replay --verify --trace <current.trace.jsonl>
```

Golden trace integrity verification:
```bash
krynix replay --verify --golden-dir test/golden/
```

## Known Gaps And Roadmap
- [CURRENT] Replay CLI provides integrity verification and behavioral drift comparison (`krynix diff`).
  Evidence: `packages/replay/src/replay-runner.ts`, `packages/cli/src/diff.ts`
- [PARTIAL] Runtime guard orchestration exists at architecture level but is not fully productized in OSS packages.
- [PLANNED] Formal replay executor and deterministic external I/O contracts.

## Relationship To Canonical Spec
This document must remain consistent with `docs/10_architecture/platform_architecture_spec.md`. If conflict exists, the canonical spec wins.
