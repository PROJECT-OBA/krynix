# Agent System Context

## Canonical Reference
Primary source: `docs/10_architecture/platform_architecture_spec.md`.

## Product Position
Krynix is the trust spine for agentic systems.

- `CURRENT`: trace integrity, policy CI evaluation, replay integrity checks.
- `PARTIAL`: baseline drift detection and integration-specific runtime controls.
- `PLANNED`: deterministic execution replay and richer input/runtime/output guard integrations.

Determinism remains a core design principle.
Current replay guarantee is integrity + baseline diff.
Execution replay is planned and tracked.

## Boundary Rules
- Krynix does not execute agents.
- Krynix does not host LLM inference.
- OSS enforcement is CI/post-run by default.
- Runtime controls may integrate around Krynix but are not full built-in OSS guarantees today.

## Engineering Rules
- Schema changes: update spec + fixtures + tests.
- Every feature change must include tests.
- Deterministic trace/session behavior must remain stable.
- Avoid dependency bloat without clear justification.

## Docs Truth Rule
All major capability statements in generated docs must include one of: `CURRENT`, `PARTIAL`, `PLANNED`.
