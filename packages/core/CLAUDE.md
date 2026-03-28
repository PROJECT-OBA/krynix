# @krynix/core

Zero-dependency foundation package. All other packages depend on this.

## Key Exports

- `TraceEvent` — discriminated union of 8 event types
- `SCHEMA_VERSION` — current schema version string
- `KrynixError` / `KrynixErrorCode` — typed error system
- `SeededRandom` — Mulberry32 PRNG for deterministic operations
- `computeHash` / `verifyChain` — SHA-256 hash chain with canonical JSON
- `TraceAdapter` / `AdapterConfig` — adapter interface

## Constraints

- **Zero internal dependencies** — this package must never import from other `@krynix/*` packages.
- **Determinism** — `computeHash`, `SeededRandom`, and canonical JSON must produce identical output given identical input across platforms.
- **Wire format types** — `event_type`, `action`, `severity` use string unions, not enums.
