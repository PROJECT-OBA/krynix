# Agent System Context

## Canonical Reference
Primary source: `docs/10_architecture/platform_architecture_spec.md`.

## Product Position
Krynix is the trust spine for agentic systems.

- `CURRENT`: trace integrity, policy CI evaluation, replay integrity checks.
- `PARTIAL`: baseline drift detection and integration-specific runtime controls.
- `PLANNED`: deterministic execution replay, richer input/runtime/output guard integrations, and profile-based enforcement modes (`dev`, `staging`, `prod`).

Determinism remains a core design principle.
Current replay guarantee is integrity + baseline diff.
Execution replay is planned and tracked.

## Boundary Rules
- Krynix does not execute agents.
- Krynix does not host LLM inference.
- OSS enforcement is CI/post-run by default.
- Runtime controls may integrate around Krynix but are not full built-in OSS guarantees today.
- Krynix does not universally own the request ingress point. Ingress ownership depends on deployment mode.
- Krynix does not treat inferred intent alone as the primary trust control.
- Deployment modes (passive, sidecar, hybrid) must not be conflated.

## Engineering Rules
- Schema changes: update spec + fixtures + tests.
- Every feature change must include tests.
- Deterministic trace/session behavior must remain stable.
- Avoid dependency bloat without clear justification.

## Docs Truth Rule
All major capability statements in generated docs must include one of: `CURRENT`, `PARTIAL`, `PLANNED`.

## Consistency Markers
- `KRYNIX_INPUT_LAYER_MODE=deployment_specific_not_universal`
- `KRYNIX_ENFORCEMENT_PRINCIPLE=block_on_actions_not_inferred_intent`
