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
- Krynix does not universally own the request ingress point.
- Krynix does not treat inferred intent alone as the primary trust control.
- Deployment modes (passive, sidecar, hybrid) must not be conflated.
- Enforcement hierarchy: deterministic hard controls > policy-based > advisory intelligence.

## Implementation Guardrails
- Schema changes require spec + fixtures + tests.
- Every feature change requires tests.
- Deterministic trace/session generation must be preserved.
- No unsupported guarantee claims in docs or generated outputs.

## Consistency Markers
- `REPLAY_CURRENT_MODE=integrity_plus_baseline_diff`
- `KRYNIX_ROLE=trust_spine_not_full_platform`
- `KRYNIX_RUNTIME_ENFORCEMENT=external_runtime_controls_ci_postrun_in_oss`
- `KRYNIX_INPUT_LAYER_MODE=deployment_specific_not_universal`
- `KRYNIX_ENFORCEMENT_PRINCIPLE=block_on_actions_not_inferred_intent`

## Documentation Change Rule
When behavior or guarantees change:
1. Update canonical spec first.
2. Update affected docs/wiki/agent rules.
3. Ensure docs CI checks pass.
