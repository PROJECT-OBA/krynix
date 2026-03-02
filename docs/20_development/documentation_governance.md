# Documentation Governance

## Purpose
Define documentation authority, review requirements, and change control for architecture and trust claims.

## Source-Of-Truth Precedence
1. `docs/10_architecture/platform_architecture_spec.md` (authoritative narrative source)
2. Domain specifications under `docs/10_architecture/*` (must not conflict with canonical spec)
3. `README.md` and `wiki/*` (entry/onboarding surfaces; must defer to canonical spec)
4. Agent rule docs (`AGENTS.md`, `CLAUDE.md`, `.agents/*`) (must follow canonical claims)
5. ADRs (`docs/30_decisions/*`) for irreversible decisions and tradeoffs only

## Required Reviewers For Trust/Architecture Claims
- Product owner (scope and roadmap alignment)
- Platform owner (implementation feasibility and operational semantics)
- Security owner (trust and redaction claims)

Any PR that changes guarantees or enforcement semantics requires all three sign-offs.

## PR Checklist For Docs That Touch Guarantees
- [ ] Claims are tagged with `CURRENT`, `PARTIAL`, or `PLANNED`.
- [ ] Every canonical `CURRENT` claim includes an `Evidence:` line with code/test/doc path references.
- [ ] Any changed claim is reconciled with canonical spec.
- [ ] README language remains entry-level and non-contradictory.
- [ ] Wiki pages either match canonical claims or explicitly defer to canonical docs.
- [ ] Agent rule files prevent unsupported guarantee statements.

## CI Documentation Checks
- Broken link check across `README.md`, `docs/`, and `wiki/`.
- Terminology check against `docs/00_overview/glossary_platform.md`.
- Claim-status tag check for canonical architecture docs.
- Evidence marker check for canonical `CURRENT` claims.
- README-to-canonical consistency assertions for key statements.

## Change Control Rules
- No architecture guarantee change without updating both canonical spec and at least one evidence reference.
- No runtime security claim may be stated as `CURRENT` unless backed by code paths and tests in this repository.
- Use ADRs only after a decision is final and difficult to reverse.
