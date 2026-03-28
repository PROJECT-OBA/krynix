# @krynix/core

Zero-dependency foundation package. All other packages depend on this.

## Key Exports

- `TraceEvent` — discriminated union of 8 event types
- `SCHEMA_VERSION` — current schema version string
- `KrynixError` — typed error system (error codes on `.code` property)
- `SeededRandom` — Mulberry32 PRNG for deterministic operations
- `computeHashChain` / `validateHashChain` — SHA-256 hash chain with canonical JSON
- `TraceAdapter` / `AdapterConfig` — adapter interface

## Constraints

- **Zero internal dependencies** — this package must never import from other `@krynix/*` packages.
- **Determinism** — `computeHashChain`, `SeededRandom`, and canonical JSON must produce identical output given identical input across platforms.
- **Wire format types** — `event_type`, `action`, `severity` use string unions, not enums.
