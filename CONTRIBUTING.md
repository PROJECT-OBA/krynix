# Contributing to Krynix

Thank you for your interest in contributing to Krynix. This document explains how to get started.

## Code of Conduct

All contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful, constructive, and focused on technical quality.

## Getting Started

1. **Set up your development environment** — follow [dev_env.md](docs/20_development/dev_env.md)
2. **Read the coding conventions** — follow [code-style.md](.claude/rules/code-style.md)
3. **Understand the architecture** — read [platform_architecture_spec.md](docs/10_architecture/platform_architecture_spec.md) (canonical) and [architecture.md](docs/10_architecture/architecture.md)

## Making Changes

### Finding Work

- Check the issue tracker for issues labeled `good first issue` or `help wanted`
- Check the project board for small, scoped starter tasks
- For larger changes, open an issue first to discuss the approach

### Branch Workflow

1. Create a branch from `main`: `git checkout -b feat/your-feature`
2. Make changes, following [code-style.md](.claude/rules/code-style.md)
3. Write tests for all new functionality
4. Ensure all tests pass: `pnpm test`
5. Ensure lint passes: `pnpm lint`
6. Commit using [conventional commit format](docs/20_development/commit_conventions.md): `type(scope): description`

### Commit Format

```
type(scope): description

[optional body]

[optional footer]
```

**Types:** `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore`
**Scopes:** `core`, `policy`, `replay`, `cli`, `adapters`

Examples:
- `feat(core): add hash chain computation`
- `fix(policy): handle missing payload fields in rule matching`
- `test(replay): add golden trace for redaction`

## Submitting Pull Requests

1. Push your branch and open a PR against `main`
2. Fill in the PR template:
   - Summary of changes
   - Link to related issue
   - Test plan
3. Ensure CI passes (build, test, lint, policy evaluation, golden trace replay)
4. Address review feedback

PRs are squash-merged to `main`. See [PR review process](docs/20_development/pr_review.md) for the full review checklist.

### PR Requirements

- All CI checks pass
- At least one approval from a maintainer
- No unresolved review comments
- Tests cover new functionality
- Documentation updated if public API changes

## RFC Process

For significant changes (new features, schema modifications, architectural changes), submit an RFC before implementation:

1. Copy [RFC_TEMPLATE.md](docs/40_rfc/RFC_TEMPLATE.md) to `docs/40_rfc/RFC-NNN-short-title.md`
2. Fill in all sections
3. Submit as a PR with the `rfc` label
4. Discuss in the PR
5. Once accepted, proceed with implementation

## AI Agent Contributors

AI agents (Claude Code, etc.) contributing to this repository should:

1. Read [CLAUDE.md](CLAUDE.md) for project instructions and entry points
2. Follow the rules in [.claude/rules/](.claude/rules/) (auto-loaded by Claude Code)
3. Follow [code-style.md](.claude/rules/code-style.md) strictly
4. Run full CI before committing: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm test && pnpm build`

## Questions

- Open a discussion in the repository's Discussions tab
- For security issues, see [SECURITY.md](SECURITY.md)
