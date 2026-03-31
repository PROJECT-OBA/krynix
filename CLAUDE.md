# CLAUDE.md — Krynix

Krynix is a trust and observability spine for agentic AI systems. pnpm monorepo with 6 packages.

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

**Full CI gate (run before every commit):**
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

Each package has its own `CLAUDE.md` with package-specific constraints (loaded on-demand).

## Rules

Topic-specific rules in `.claude/rules/`:
- `architecture.md` — source priority, boundaries, dependency direction
- `code-style.md` — naming, module structure, commits (auto-loads for `*.ts` files)
- `testing.md` — test requirements, CI gate (auto-loads for `*.test.ts` files)
- `claims.md` — truth labeling (`CURRENT`/`PARTIAL`/`PLANNED`)
- `security.md` — crypto integrity, input validation, secret handling

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

## Skills

| Skill | Usage | Purpose |
|-------|-------|---------|
| `/ci` | `/ci` | Run full CI check sequence |
| `/pre-commit` | `/pre-commit fix(core): msg` | Validate and commit |
| `/new-branch` | `/new-branch feat/name` | Create branch from main |
| `/review-pr` | `/review-pr 42` | Review PR (forks to code-reviewer agent) |
| `/security-review` | `/security-review` | Security-focused review (forks to security-reviewer) |
| `/pick-task` | `/pick-task [label]` | Pick next task from GitHub project board |
| `/done-task` | `/done-task 42` | Mark issue #42 as complete |
| `/test-package` | `/test-package core` | Run tests for a single package |
| `/trace-validate` | `/trace-validate file.jsonl` | Verify trace integrity + policy evaluation |
| `/docs-check` | `/docs-check` | Check documentation consistency |

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `code-reviewer` | opus | Read-only review against project standards |
| `ci-checker` | haiku | Run CI checks and report pass/fail |
| `security-reviewer` | sonnet | Security: crypto integrity, input validation, secrets |
| `architecture-guardian` | sonnet | Enforce dependency direction and package contracts |
| `test-writer` | sonnet | Write deterministic Vitest tests following project patterns |
| `policy-author` | sonnet | Author YAML policy files with schema validation |
| `docs-writer` | sonnet | Write docs with mandatory truth labeling |

## Hooks

| Event | Hook | Purpose |
|-------|------|---------|
| `PreToolUse` | `protect-files.sh` | Block edits to `.env`, lockfiles, CI workflows |
| `PostToolUse` | `auto-format.sh` | Auto-run Prettier on edited `.ts` files |
| `PostToolUse` | `check-dependencies.sh` | Warn about new dependencies in package.json |
| `PostToolUse` | `validate-commit-msg.sh` | Validate Conventional Commits format |

## Cross-Repo Development

All PROJECT-OBA repos share the same `.claude/` structure. When working across repos:
- Same skills (`/pick-task`, `/pre-commit`, `/ci`, etc.) work in every repo
- Same rules (claims, security) are enforced everywhere
- Same hooks (protect-files, auto-format, commit validation) run everywhere
- Use the [Krynix Roadmap](https://github.com/orgs/PROJECT-OBA/projects/1) to coordinate work
