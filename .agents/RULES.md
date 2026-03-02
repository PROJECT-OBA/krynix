# RULES.md — Non-Negotiable Constraints

- Never push to `main` directly.
- Use feature branches.
- Follow Conventional Commits.
- All new functionality must include tests.
- Schema changes require spec + fixtures + tests.
- Preserve deterministic trace/session behavior.
- Update docs when behavior claims change.
- Do not claim unsupported guarantees.
- Tag major capability claims as `CURRENT`, `PARTIAL`, or `PLANNED`.
- Canonical docs source precedence must be respected (`platform_architecture_spec.md` first).
