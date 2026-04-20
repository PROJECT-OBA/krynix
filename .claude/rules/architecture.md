# Architecture Rules

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
