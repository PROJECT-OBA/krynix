# CLAUDE.md — Krynix Documentation + Implementation Guardrails

## 0. Purpose
Contribute to Krynix with implementation-rigorous changes and truthful architecture claims.

Determinism remains a core design principle.

## 1. Source Priority (Authoritative Order)
1. `docs/10_architecture/platform_architecture_spec.md`
2. `docs/10_architecture/*` specs
3. `README.md` and `wiki/*`
4. `AGENTS.md`, `CLAUDE.md`, `.agents/*`

If documents conflict, update the lower-priority source.

## 2. Authoritative Documents (Read Before Coding)
Architecture and contracts:
- `docs/10_architecture/platform_architecture_spec.md`
- `docs/10_architecture/architecture.md`
- `docs/10_architecture/trace_spec.md`
- `docs/10_architecture/policy_spec.md`
- `docs/10_architecture/determinism_spec.md`
- `docs/10_architecture/integration_contracts.md`
- `docs/10_architecture/integration_blueprints.md`

Engineering rules:
- `docs/20_development/ci_cd.md`
- `docs/20_development/testing_strategy.md`
- `docs/20_development/documentation_governance.md`
- `docs/20_development/docs_rewrite_plan.md`

Agent workflow:
- `AGENTS.md`
- `.agents/SYSTEM.md`
- `.agents/RULES.md`
- `.agents/WORKFLOW.md`
- `.agents/REVIEW.md`

## 3. Hard Rules
1. Schema-affecting changes require:
   - spec updates,
   - fixture updates,
   - test updates.
2. Every feature change includes tests.
3. Determinism constraints for trace/session generation must hold:
   - canonical JSON + hash chain remain deterministic,
   - seeded session/event behavior remains deterministic when seed is provided,
   - write order must remain stable under concurrency.
4. No dependency bloat without explicit justification.
5. Do not claim unsupported guarantees in docs, PR text, or generated artifacts.

## 4. Claim Truth Labeling
Use explicit status labels for major capability claims:
- `CURRENT`
- `PARTIAL`
- `PLANNED`

No untagged aspirational language in normative sections.

Unsupported claim examples:
- Incorrect: "Replay re-executes agent logic deterministically today."
- Correct: "Current replay guarantee is integrity + baseline diff."
- Incorrect: "Krynix OSS blocks runtime actions by default."
- Correct: "Runtime blocking is integration-specific in OSS today."

## 5. Definition Of Done
A change is complete when:
- tests pass,
- CI passes,
- behavior claims match implementation evidence,
- canonical docs remain consistent,
- replay/runtime guarantees are stated with correct status labels.

## 6. Current Product Contract
- `CURRENT`: trace integrity, policy evaluation, replay integrity checks.
- `PARTIAL`: replay baseline drift comparison and runtime integrations.
- `PLANNED`: deterministic execution replay and full layered guard platform behavior.
