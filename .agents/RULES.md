# RULES.md — Non-Negotiable Constraints

- Never push to main.
- Always use feature branches.
- Follow Conventional Commits.
- All new functionality must have tests.
- Golden trace tests must be updated if behavior changes.
- No dependency added without justification.
- Determinism must not be broken.
- If changing schemas, update:
  - spec
  - fixtures
  - tests