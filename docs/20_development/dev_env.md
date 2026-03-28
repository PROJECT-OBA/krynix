# Development Environment

This document covers setting up a local development environment for Krynix.

See [code-style.md](../../.claude/rules/code-style.md) for coding conventions. See [architecture](../10_architecture/architecture.md) for the module structure.

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | >= 20 LTS | Runtime |
| pnpm | >= 9 | Package manager |
| Git | >= 2.40 | Version control |

## Repository Setup

```bash
git clone https://github.com/krynix-dev/krynix.git
cd krynix
pnpm install
pnpm build
```

## Project Structure

```
krynix/
├── packages/
│   ├── core/              # TraceEvent types, canonical JSON, hash chain, redaction
│   │   ├── src/
│   │   └── package.json
│   ├── policy/            # Policy YAML parser, rule matcher, evaluator
│   │   ├── src/
│   │   └── package.json
│   ├── replay/            # Replay engine, determinism envelope, golden trace runner
│   │   ├── src/
│   │   └── package.json
│   ├── adapters/          # Framework-specific Trace Adapters
│   │   └── openclaw/      # OpenClaw reference adapter
│   └── cli/               # CLI commands (evaluate, replay)
│       ├── src/
│       └── package.json
├── policies/              # Policy YAML files
├── test/
│   └── golden/            # Golden Trace files for replay testing
├── traces/                # Runtime trace output (gitignored)
├── docs/                  # Project documentation
├── .claude/               # Claude Code configuration (rules, skills, agents, hooks)
└── scripts/               # Build and utility scripts
```

### Dependency Direction

```
core ← policy ← cli
core ← replay ← cli
core ← adapters
```

No circular dependencies. No package may import from `cli`. See [code-style.md](../../.claude/rules/code-style.md) for module boundary rules.

## Building

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @krynix/core build

# Type-check without emitting
pnpm typecheck
```

## Running Tests

```bash
# All tests
pnpm test

# Specific package
pnpm --filter @krynix/core test

# Watch mode
pnpm --filter @krynix/core test --watch

# Golden trace replay tests
pnpm test:golden
```

### Test Types

| Type | Command | Location | Purpose |
|---|---|---|---|
| Unit | `pnpm test` | `*.test.ts` colocated with source | Pure function and module tests |
| Integration | `pnpm test:integration` | `test/integration/` | Cross-package interaction tests |
| Golden Trace | `pnpm test:golden` | `test/golden/*.trace.jsonl` | Deterministic replay regression tests |

## Local Policy Evaluation

Run the policy evaluator against a local trace. The `--policy` flag accepts either a directory of `.policy.yaml` files (all are evaluated) or a single `.policy.yaml` file.

```bash
# Evaluate a trace against all policies in a directory
pnpm krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Evaluate against a single policy file
pnpm krynix evaluate --trace traces/session.trace.jsonl --policy policies/no-shell-exec.policy.yaml
```

## Local Replay Verification

```bash
# Verify a trace replays identically
pnpm krynix replay --verify --trace traces/session.trace.jsonl

# Verify all golden traces
pnpm krynix replay --verify --golden-dir test/golden/

# Verbose output for debugging
pnpm krynix replay --verify --verbose --trace traces/session.trace.jsonl
```

## Linting and Formatting

```bash
# Lint
pnpm lint

# Format
pnpm format

# Check formatting without writing
pnpm format:check
```

## IDE Configuration

The repository includes recommended VS Code settings:

- **ESLint** — enabled with project config
- **Prettier** — format on save
- **TypeScript** — uses workspace version

Recommended extensions are listed in `.vscode/extensions.json`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `KRYNIX_LOG_LEVEL` | no | Log verbosity: `debug`, `info`, `warn`, `error`. Default: `info` |
| `KRYNIX_TRACE_DIR` | no | Output directory for traces. Default: `traces/` |

No secrets are required for local development. The test suite uses fixtures and golden traces, not live services.
