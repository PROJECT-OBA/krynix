# CLAUDE.md — Krynix

Krynix is a trust and observability spine for agentic AI systems. This is a pnpm monorepo with 6 packages.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies |
| `pnpm typecheck` | TypeScript compilation |
| `pnpm lint` | ESLint |
| `pnpm format:check` | Prettier check |
| `pnpm docs:check` | Documentation consistency |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm build` | Build all packages |

**CI gate (run before every commit):**
```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm test && pnpm build
```

## Packages

| Package | Path | Depends On |
|---------|------|------------|
| `@krynix/core` | `packages/core` | — |
| `@krynix/policy` | `packages/policy` | `core` |
| `@krynix/replay` | `packages/replay` | `core` |
| `@krynix/adapter-openclaw` | `packages/adapter-openclaw` | `core` |
| `@krynix/adapter-langchain` | `packages/adapter-langchain` | `core` |
| `@krynix/cli` | `packages/cli` | `core`, `policy`, `replay` |

## Rules

Detailed rules are in `.claude/rules/`:
- `.claude/rules/architecture.md` — source priority, boundaries, dependency direction
- `.claude/rules/code-style.md` — naming, module structure, commits
- `.claude/rules/testing.md` — test requirements, CI gate, golden traces
- `.claude/rules/claims.md` — truth labeling (`CURRENT`/`PARTIAL`/`PLANNED`)

## Hard Rules (Always Apply)

1. **Schema changes** require spec + fixture + test updates.
2. **Every feature change** includes tests.
3. **Determinism** must be preserved: canonical JSON + hash chain + seeded behavior.
4. **No dependency bloat** without justification.
5. **No unsupported claims** in docs, PR text, or generated artifacts.
6. **Run full CI locally** before committing. No exceptions.

## Source Priority

1. `docs/10_architecture/platform_architecture_spec.md`
2. `docs/10_architecture/*` specs
3. `README.md` and `wiki/*`
4. `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*`

If documents conflict, update the lower-priority source.

## Current Product Contract

- `CURRENT`: trace integrity, policy evaluation, replay integrity checks.
- `PARTIAL`: replay baseline drift comparison and runtime integrations.
- `PLANNED`: deterministic execution replay, full layered guard platform, profile-based enforcement.

## Custom Skills

| Skill | Usage | Purpose |
|-------|-------|---------|
| `/ci` | `/ci` | Run full CI check sequence |
| `/pre-commit` | `/pre-commit fix: description` | Validate and commit |
| `/new-branch` | `/new-branch feat/name` | Create branch from main |
| `/review-pr` | `/review-pr 42` | Review a PR |

## Agents

| Agent | Purpose |
|-------|---------|
| `code-reviewer` | Review code changes against project standards |
| `ci-checker` | Run CI checks and report results |
