---
paths:
  - "packages/*/src/**/*.ts"
---

# Code Style

## Naming

| Element | Convention | Example |
|---|---|---|
| Files | kebab-case | `hash-chain.ts` |
| Types / Interfaces | PascalCase | `TraceEvent`, `AdapterConfig` |
| Functions | camelCase | `computeHash`, `evaluatePolicy` |
| Constants | UPPER_SNAKE_CASE | `SCHEMA_VERSION` |
| Policy files | kebab-case + `.policy.yaml` | `no-shell-exec.policy.yaml` |
| Trace files | kebab-case + `.trace.jsonl` | `minimal-session.trace.jsonl` |
| Test files | source name + `.test.ts` | `hash-chain.test.ts` |

## Modules

- Each package has a single public entry point: `index.ts`.
- Functions are pure by default. Side effects only in boundary modules (CLI, adapters, trace writer).
- Soft limit: 300 lines per file. Hard limit: 500 lines.
- Maximum 50 lines per function.

## Wire Format Types

Wire format types (`event_type`, `action`, `severity`, `operator`) use string unions. TypeScript `enum` is only for internal values that never cross serialization boundaries.

## Commits

Conventional Commits: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore`
- Scopes: `core`, `policy`, `replay`, `cli`, `adapters`

## Error Handling

- Use typed error codes (`KrynixError` with `KrynixErrorCode`).
- No swallowed errors — every `catch` handles or rethrows.
- Core modules throw typed errors; boundary modules map them to exit codes.
