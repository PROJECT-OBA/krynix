# Development Guide

This guide covers building, testing, and developing Krynix locally.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | >= 20 LTS | Runtime |
| **pnpm** | >= 9 | Package manager |
| **Git** | >= 2.40 | Version control |

## Setup

```bash
git clone https://github.com/artificialvirus/krynix.git
cd krynix
pnpm install
pnpm build
```

## Building

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @krynix/core build

# Type-check without emitting
pnpm typecheck
```

Each package uses [tsup](https://tsup.egoist.dev/) to produce ESM output. TypeScript project references (`tsc -b`) ensure type-safe cross-package imports.

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Specific package
pnpm --filter @krynix/core test

# Watch mode
pnpm --filter @krynix/core test -- --watch

# Integration tests only
pnpm test:integration

# Golden trace replay tests only
pnpm test:golden
```

### Test Types

| Type | Location | Purpose |
|------|----------|---------|
| **Unit** | `packages/*/src/*.test.ts` | Pure function and module tests, colocated with source |
| **Integration** | `test/integration/*.test.ts` | Cross-package interaction tests |
| **Golden Trace** | `test/golden/*.trace.jsonl` | Deterministic replay regression tests |

### Test Framework

Krynix uses [Vitest](https://vitest.dev/). Tests are colocated with source files (e.g., `hash-chain.ts` and `hash-chain.test.ts` in the same directory).

### Writing Tests

Key conventions:
- All new code must have tests
- Tests should be deterministic (no flaky tests)
- Use dependency injection (`Partial<XDeps>` pattern) to mock external calls
- Golden trace tests verify replay determinism end-to-end
- Integration tests import from source paths, not built dist

## Linting and Formatting

```bash
# ESLint
pnpm lint
pnpm lint:fix

# Prettier
pnpm format:check
pnpm format
```

The project enforces:
- TypeScript strict mode
- ESLint with `@typescript-eslint` rules
- Prettier with default config
- No `any` types (enforced by ESLint)
- No non-null assertions (`!`) (enforced by ESLint)

## Dependency Injection Pattern

All CLI commands that interact with external services (HTTP, filesystem, credentials) use dependency injection:

```typescript
export interface MyCommandDeps {
  loadConfig: (path?: string) => Config | null;
  fetchFn: typeof fetch;
}

const defaultDeps: MyCommandDeps = {
  loadConfig,
  fetchFn: globalThis.fetch,
};

export async function runMyCommand(
  args: string[],
  deps: Partial<MyCommandDeps> = {},
): Promise<Result> {
  const d = { ...defaultDeps, ...deps };
  // Use d.loadConfig() and d.fetchFn() instead of direct imports
}
```

Tests inject mock implementations:

```typescript
test("handles network error", async () => {
  const result = await runMyCommand(["--flag", "value"], {
    fetchFn: () => Promise.reject(new Error("network down")),
    loadConfig: () => ({ url: "https://example.com", org_id: "test" }),
  });
  expect(result.exitCode).toBe(1);
  expect(result.error).toContain("network down");
});
```

## Branch Workflow

```bash
# Create a feature branch from main
git checkout -b feat/your-feature main

# Make changes, test, lint
pnpm test && pnpm typecheck && pnpm lint

# Commit with conventional format
git commit -m "feat(core): add new capability"

# Push and open PR
git push -u origin feat/your-feature
```

### Commit Format

```
type(scope): description

Types: feat, fix, docs, test, refactor, ci, chore
Scopes: core, policy, replay, cli, adapters
```

## IDE Setup

### VS Code

The repository includes recommended settings:
- ESLint enabled with project config
- Prettier format on save
- TypeScript uses workspace version

Recommended extensions are in `.vscode/extensions.json`.

### IntelliJ / WebStorm

- Import the project as a Node.js project
- Enable ESLint integration
- Configure Prettier as the formatter
- Set TypeScript service to use workspace version

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KRYNIX_LOG_LEVEL` | No | Log verbosity: `debug`, `info`, `warn`, `error` (default: `info`) |
| `KRYNIX_TRACE_DIR` | No | Output directory for traces (default: `traces/`) |
| `KRYNIX_EMAIL` | No | Default email for `auth login` |
| `KRYNIX_PASSWORD` | No | Default password for `auth login` |

No secrets are required for local development. The test suite uses fixtures and golden traces, not live services.

## CI Pipeline

The CI pipeline runs on every PR:

1. **Install** -- `pnpm install`
2. **Build** -- `pnpm build`
3. **Typecheck** -- `pnpm typecheck` (zero errors required)
4. **Lint** -- `pnpm lint` (zero warnings required)
5. **Format** -- `pnpm format:check` (all files formatted)
6. **Test** -- `pnpm test` (all tests pass)

All six checks must pass for a PR to merge.

## See Also

- [[Package Structure]] -- Monorepo layout and dependencies
- [[Testing Strategy]] -- Detailed testing approach
- [CONTRIBUTING.md](https://github.com/artificialvirus/krynix/blob/main/CONTRIBUTING.md) -- Contribution guidelines
- [dev_env.md](https://github.com/artificialvirus/krynix/blob/main/docs/20_development/dev_env.md) -- Detailed environment setup
