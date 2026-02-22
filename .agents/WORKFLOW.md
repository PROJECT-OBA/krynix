# WORKFLOW.md — How to Work

## Branching

Create branches as:
- feat/<short-description>
- fix/<short-description>
- chore/<short-description>
- docs/<short-description>

Never commit to main.

## Commits

Follow Conventional Commits:
- feat(trace): add tool_call event
- fix(policy): correct deny rule evaluation
- test(replay): add determinism regression test

## Pull Requests

PR must include:
- Clear description
- Tests
- Schema impact (if any)
- Risk notes

Squash merge is required.