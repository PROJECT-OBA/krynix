# Contributing to Krynix

Thank you for your interest in contributing to Krynix. This document explains how to get started.

## Code of Conduct

All contributors must follow the [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful, constructive, and focused on technical quality.

## Getting Started

1. **Clone and build**: `git clone https://github.com/PROJECT-OBA/krynix.git && cd krynix && pnpm install && pnpm build`
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
6. Commit using conventional commit format: `type(scope): description`

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

PRs are squash-merged to `main`.

### PR Requirements

- All CI checks pass
- At least one approval from a maintainer
- No unresolved review comments
- Tests cover new functionality
- Documentation updated if public API changes

## Significant Changes

For significant changes (new features, schema modifications, architectural changes), open an issue first to discuss the approach before submitting a PR.

## AI Agent Contributors

AI agents (Claude Code, etc.) contributing to this repository should:

1. Read [CLAUDE.md](CLAUDE.md) for project instructions and entry points
2. Follow the rules in [.claude/rules/](.claude/rules/) (auto-loaded by Claude Code)
3. Follow [code-style.md](.claude/rules/code-style.md) strictly
4. Run full CI before committing: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm test && pnpm build`

## Releases

Krynix publishes all `@krynix/*` packages to npm via a tag-triggered workflow with Sigstore [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

Maintainer release ritual:

1. Confirm `main` is green and `pnpm audit --prod` is clean.
2. Bump `version` in every `packages/*/package.json` (and root `package.json`) to the new SemVer.
3. Add a new `## [x.y.z] - YYYY-MM-DD` section to `CHANGELOG.md` summarizing user-visible changes.
4. Open a `chore/release-x.y.z` PR. Merge after review.
5. From `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.
6. The `Release` workflow builds, runs the standalone smoke test, publishes each package with `pnpm -r publish --access public --provenance`, and creates a GitHub Release with the standalone CLI binary.
7. Verify on npm: `npm view @krynix/core@X.Y.Z` should show the new version with a `dist.signatures` / provenance attestation.

The workflow authenticates to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) — no `NPM_TOKEN` secret is required. Each `@krynix/*` package is configured on npmjs.com with a GitHub Actions Trusted Publisher pointing at `PROJECT-OBA/krynix` and the `release.yml` workflow. Adding a new package requires registering it as a Trusted Publisher before the first publish.

## Questions

- Open a discussion in the repository's Discussions tab
- For security issues, see [SECURITY.md](SECURITY.md)
