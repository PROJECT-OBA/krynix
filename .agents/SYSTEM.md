# Agent System Context

Krynix is a runtime trust layer for autonomous systems. It is not an agent framework, model provider, or dashboard product.

Krynix is:
- A trace standardization layer (structured, tamper-evident records)
- A CI-enforced policy evaluation system
- A deterministic replay engine
- A declarative policy enforcement layer

Core primitives:
1. **Trace** — ordered, hash-chained sequence of TraceEvents
2. **Policy** — declarative YAML rules constraining agent behavior
3. **Replay** — deterministic re-execution for reproducibility verification

Every implementation decision must preserve these three primitives.

## Repository Structure

Krynix is a pnpm monorepo with four packages:

```
packages/core/    — TraceEvent types, canonical JSON, hash chain, redaction, trace reader/writer
packages/policy/  — Policy YAML parser, rule matcher, evaluator
packages/replay/  — Golden trace validator, replay verifier
packages/cli/     — CLI commands (evaluate, replay)
```

Dependency direction: `core ← policy ← cli`, `core ← replay ← cli`. No circular dependencies.

Each package has a single public entry point: `src/index.ts`. All exports go through this file.

## Technology Stack

- **Runtime:** Node.js >= 20
- **Language:** TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- **Package manager:** pnpm (workspace)
- **Build:** tsup (ESM + CJS + DTS)
- **Test:** Vitest (with `expectTypeOf` for type-level tests)
- **Lint:** ESLint v9 (flat config, typescript-eslint/strict)
- **Format:** Prettier

## Key Specifications

- Schema version: `1.0.0`
- Policy API version: `krynix.dev/v1`
- Wire format types use **string unions** (not TypeScript enums)
- Regex operator uses **ECMAScript RegExp** (not PCRE)
- Canonical JSON uses `JSON.stringify` for numeric formatting; rejects NaN/Infinity/BigInt
- CI exit codes: 0 (pass), 1 (error), 2 (critical), 3 (require-approval)
