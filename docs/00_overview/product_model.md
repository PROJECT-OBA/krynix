# Product Model

## Purpose
Define the boundary between current OSS capabilities and planned platform capabilities.

## Where Used
- Product scope decisions.
- OSS vs Control Plane messaging.
- Go-to-market and onboarding clarity.

## Guarantees (Current)
- [CURRENT] OSS provides trace integrity, policy evaluation, replay integrity verification, and CLI workflows.
- [CURRENT] OSS is usable offline.
- [CURRENT] Control Plane integration is additive, not required.
- [PARTIAL] Behavioral drift detection exists via baseline trace comparison.

## Planned Guarantees (Future)
- [PLANNED] Execution replay mode and richer runtime integrations.
- [PLANNED] Centralized governance features in Control Plane (registry, compliance workflows, org controls).

## Non-Goals
- [CURRENT] OSS does not replace agent orchestration runtimes.
- [CURRENT] OSS does not host LLM inference.
- [CURRENT] OSS does not currently provide full inline runtime prevention as a built-in guarantee.

## Interfaces / Contracts
- Canonical architecture source: `docs/10_architecture/platform_architecture_spec.md`
- OSS package responsibilities: `docs/10_architecture/component_contract_matrix.md`
- Control Plane design draft: `docs/10_architecture/control_plane_spec.md`

## Operational Usage
- OSS-first deployment:
  - Use `evaluate` and `replay` in CI.
  - Use compliance export for evidence packaging.
- Optional Control Plane usage:
  - Pull/push policies and golden traces when governance services are available.

## Known Gaps And Roadmap
- [PARTIAL] Replay assurance is integrity + drift diff, not execution replay.
- [PLANNED] Layered input/runtime/output enforcement contracts and telemetry loops.
