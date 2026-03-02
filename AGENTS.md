# AGENTS.md

## Purpose
Repository-level instructions for truthful trust claims and implementation-safe contribution behavior.

Determinism remains a core design principle.

## Source Of Truth
1. `docs/10_architecture/platform_architecture_spec.md`
2. `docs/10_architecture/*` specs
3. `README.md` and `wiki/*`
4. `AGENTS.md`, `CLAUDE.md`, `.agents/*`

## Mandatory Status Labels
Major capability claims must include one of:
- `CURRENT`
- `PARTIAL`
- `PLANNED`

## Mandatory Current-State Constraints
- Current replay guarantee is integrity + baseline diff.
- Execution replay is planned and tracked.
- Krynix is trust spine, not full platform ownership.
- OSS default enforcement boundary is CI/post-run.

## Implementation Guardrails
- Schema changes require spec + fixtures + tests.
- Every feature change requires tests.
- Deterministic trace/session generation must be preserved.
- No unsupported guarantee claims in docs or generated outputs.

## Documentation Change Rule
When behavior or guarantees change:
1. Update canonical spec first.
2. Update affected docs/wiki/agent rules.
3. Ensure docs CI checks pass.
