# Architecture Rules

## Source of Truth

Primary source: `docs/10_architecture/platform_architecture_spec.md`.

If documents conflict, update the lower-priority source per this precedence:
1. `docs/10_architecture/platform_architecture_spec.md`
2. `docs/10_architecture/*` specs
3. `README.md` and `wiki/*`
4. `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*`

## Product Position

Krynix is the trust spine for agentic systems.

- `CURRENT`: trace integrity, policy CI evaluation, replay integrity checks.
- `PARTIAL`: baseline drift comparison (library only, not CLI-integrated) and integration-specific runtime controls.
- `PLANNED`: deterministic execution replay, richer guard integrations, profile-based enforcement modes.

## Boundary Rules

- Krynix does not execute agents.
- Krynix does not host LLM inference.
- OSS enforcement is CI/post-run by default.
- Runtime controls may integrate around Krynix but are not full built-in OSS guarantees today.
- Krynix does not universally own the request ingress point. Ingress ownership depends on deployment mode.
- Krynix does not treat inferred intent alone as the primary trust control.
- Deployment modes (passive, sidecar, hybrid) must not be conflated.

## Package Dependency Direction

```
core <- policy <- cli
core <- replay <- cli
core <- adapters
```

- `core` has zero internal dependencies
- `policy` depends only on `core`
- `replay` depends only on `core`
- `adapters` depend only on `core`
- `cli` depends on `policy`, `replay`, and optionally `adapters`
- No package may import from `cli`
- No circular dependencies
