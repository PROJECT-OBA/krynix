# CI/CD

## Purpose
Define CI behavior for code quality and documentation truth-governance.

## Required Stages
1. Typecheck
2. Lint
3. Format check
4. Tests
5. Build
6. CLI smoke tests
7. Documentation checks

## Documentation Checks
- Broken markdown links in `README.md`, `docs/`, and `wiki/`
- Terminology validation against `docs/00_overview/glossary_platform.md`
- Claim-status tag validation (`CURRENT|PARTIAL|PLANNED`) in canonical docs
- README-to-canonical consistency assertions

## Required Outcomes
- All code checks pass.
- Docs checks pass.
- No contradiction between README/wiki and canonical architecture claims.

## Artifacts (When Produced)
- Evaluation reports
- Replay results
- Compliance bundles
- Build outputs
