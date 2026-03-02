# Package Structure

Krynix is a pnpm monorepo with five packages. This page describes each package, its responsibilities, and the dependency relationships between them.

## Repository Layout

```
krynix/
├── packages/
│   ├── core/                @krynix/core
│   ├── policy/              @krynix/policy
│   ├── replay/              @krynix/replay
│   ├── adapter-openclaw/    @krynix/adapter-openclaw
│   └── cli/                 @krynix/cli
├── test/
│   ├── golden/              Golden trace files for replay testing
│   └── integration/         Cross-package integration tests
├── policies/                Policy YAML files
├── traces/                  Runtime trace output (gitignored)
├── docs/                    Project documentation
├── wiki/                    GitHub wiki source
├── .agents/                 Agent contributor guidelines
└── .github/                 CI workflows
```

## Packages

### `@krynix/core`

**Location:** `packages/core/`
**Role:** Foundation layer -- all other packages depend on this.

Contains:
- `TraceEvent` type definitions and schema validation
- Canonical JSON serialization (`canonicalize()`)
- Hash chain computation and verification
- Automatic secret redaction (`redact`, `redactWithPatterns`)
- Session management (`startSession`, `endSession`, `destroySession`)
- Trace writer (`TraceWriter`)
- Trace reader and parser
- Trace statistics (`computeTraceStats`)
- Trace event filtering (`filterTraceEvents`)
- Streaming hash chain validator
- OTLP export (`convertToOtlp`)
- Compliance evidence bundle generator
- Evaluation pipeline (`runEvaluationPipeline`)
- Seeded PRNG (`SeededRandom`)

**Key property:** Zero imports from any other Krynix package. This is a strict leaf dependency.

### `@krynix/policy`

**Location:** `packages/policy/`
**Role:** Policy parsing, evaluation, and management.

Contains:
- Policy YAML parser and validator (`parsePolicy`, `validatePolicy`)
- Rule matcher (first-match-wins, AND logic)
- Policy evaluator (`evaluate`)
- Policy inheritance and merge (`resolvePolicy`, `mergePolicy`)
- Policy diff engine (`diffPolicies`)
- HTTP policy resolver (`createHttpPolicyResolver`)
- Policy schema types

**Dependencies:** `@krynix/core` (for `TraceEvent` types)

### `@krynix/replay`

**Location:** `packages/replay/`
**Role:** Replay integrity verification and drift-comparison utilities.

Contains:
- Replay runner (`verifyTrace`, `regenerateTrace`)
- Golden trace directory runner (`verifyGoldenDir`, `regenerateGoldenDir`)
- Replay envelope extraction and validation
- Event-by-event comparison with divergence reporting

**Dependencies:** `@krynix/core` (for `TraceEvent` types, hash chain, canonicalization)

### `@krynix/adapter-openclaw`

**Location:** `packages/adapter-openclaw/`
**Role:** Reference Trace Adapter for the OpenClaw agent framework.

Contains:
- OpenClaw hook-to-TraceEvent conversion
- Default policy file for OpenClaw agents
- Integration test with golden trace

**Dependencies:** `@krynix/core` (for `TraceEvent` types, session management)

### `@krynix/cli`

**Location:** `packages/cli/`
**Role:** CLI binary and command implementations.

Contains:
- Command router (`routeCommand`)
- All CLI command implementations: `evaluate`, `replay`, `validate`, `stats`, `export`, `policy test/diff/pull/push`, `compliance export`, `push`, `auth status/logout/login/create-key`
- Argument parser (`getArg`, `hasFlag`, `getAllArgs`, `parseCommand`)
- Help text definitions
- Binary entry point (`main.ts`) with `#!/usr/bin/env node` shebang
- Control Plane configuration and credentials management
- HTTP client for Control Plane communication

**Dependencies:** `@krynix/core`, `@krynix/policy` (lazy import for policy push)

## Dependency Graph

```
                    ┌───────────────────┐
                    │   @krynix/core    │
                    │                   │
                    │  Types, hash,     │
                    │  redaction, stats  │
                    └─────┬─────┬───────┘
                          |     |
              ┌───────────┘     └───────────┐
              |                             |
              v                             v
   ┌──────────────────┐         ┌───────────────────┐
   │ @krynix/policy   │         │ @krynix/replay    │
   │                  │         │                   │
   │ Parser, eval,    │         │ Replay engine,    │
   │ inheritance, diff│         │ golden traces     │
   └────────┬─────────┘         └─────────┬─────────┘
            |                             |
            └──────────┐  ┌───────────────┘
                       |  |
                       v  v
              ┌──────────────────┐
              │  @krynix/cli     │
              │                  │
              │  Commands,       │
              │  router, binary  │
              └──────────────────┘

   @krynix/adapter-openclaw  -->  @krynix/core
```

**Rules:**
- No circular dependencies
- No package may import from `cli`
- Core is always a leaf dependency
- Dependency inversion: core uses callbacks, not direct imports from policy/replay

## Build System

Each package uses:
- **TypeScript** with strict mode (`tsc -b` for project references)
- **tsup** for bundling (ESM output)
- **Vitest** for testing (colocated `*.test.ts` files)

Build commands:

```bash
pnpm build              # Build all packages
pnpm typecheck          # Type-check all packages
pnpm lint               # ESLint all packages
pnpm format:check       # Prettier check
pnpm test               # Run all tests
```

## See Also

- [[Architecture Overview]] -- System-level design
- [[Development Guide]] -- How to build and test
