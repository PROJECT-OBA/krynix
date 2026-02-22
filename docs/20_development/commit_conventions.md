# Commit Conventions

We follow Conventional Commits.

Format:
<type>(scope): <description>

Types:
- feat
- fix
- docs
- test
- refactor
- chore

Examples:
feat(trace): add decision event
fix(replay): ensure stable ordering
test(policy): add deny rule regression

Breaking changes:
feat!: change trace schema structure