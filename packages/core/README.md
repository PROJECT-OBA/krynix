# @krynix/core

Core primitives for [Krynix](https://github.com/PROJECT-OBA/krynix) — trace events, SHA-256 hash chains, Ed25519 signing, canonical JSON, and schema validation.

## Install

```bash
npm install @krynix/core
```

## Key Exports

- **`TraceEvent`** — discriminated union of 8 event types (`tool_call`, `tool_result`, `llm_request`, `llm_response`, `lifecycle`, `decision`, `observation`, `error`)
- **`computeHashChain` / `validateHashChain`** — SHA-256 hash chain with canonical JSON serialization
- **`signHashChain` / `verifyHashChainSignature`** — Ed25519 chain-tip signing for tamper evidence
- **`TraceWriter` / `readTrace`** — write and read JSONL trace files
- **`canonicalize`** — deterministic JSON serialization
- **`SeededRandom`** — Mulberry32 PRNG for deterministic operations
- **`KrynixError`** — typed error system with `.code` property
- **`traceEventSchema` / `policySchema` / `reportSchema`** — JSON Schema objects for cross-language validation
- **Schema files** — standalone JSON Schema files at `@krynix/core/schemas/*.schema.json`

## Usage

```typescript
import { TraceWriter, validateHashChain, readTrace } from "@krynix/core";

// Write events to a trace file
const writer = new TraceWriter({ validateOnWrite: true });
await writer.open("/path/to/trace.jsonl");
await writer.write(event1);
await writer.write(event2);
await writer.close();

// Read and validate hash chain integrity
const events = await readTrace("/path/to/trace.jsonl");
const result = validateHashChain(events);
// result.valid === true if chain is intact
```

## Algorithm Stability

The following algorithms are **locked** and will not change without a major version bump:

- **Canonical JSON** serialization (key ordering, whitespace, encoding)
- **SHA-256 hash chain** computation (prev_hash + canonical JSON → event_hash)
- **SeededRandom** (Mulberry32 PRNG) — changing would break all golden traces

This means traces and hash chains produced by any `0.x` release will validate correctly against any other `0.x` release. This guarantee is critical for compliance audit trails.

## Error Handling

Validation and runtime errors thrown by `@krynix/core` use the `KrynixError` class with a machine-readable `.code` property. I/O operations (e.g., `readTrace`, `TraceWriter.open`) may also throw standard Node.js errors (e.g., `ENOENT`).

```typescript
import { KrynixError } from "@krynix/core";

try {
  validateHashChain(events);
} catch (err) {
  if (err instanceof KrynixError) {
    console.error(err.code); // e.g. "HASH_CHAIN_BROKEN"
  }
}
```

## License

Apache 2.0
