# @krynix/core

Core primitives for the Krynix trust and observability toolkit. This package provides trace events, hash chains, sessions, canonical JSON serialization, and schema validation.

## Key Exports

### Session & Trace Management

- `startSession()` / `endSession()` / `recordEvent()` — manage trace sessions and record events
- `TraceWriter` — writes trace events to `.trace.jsonl` files at a consumer-specified `outputPath`
- `readTrace()` — read and parse a trace file

### Hash Chain Integrity

- `computeHashChain()` — compute SHA-256 hash chain over trace events
- `validateHashChain()` — verify an existing hash chain is intact
- `StreamingHashValidator` — validate hash chains in streaming mode

### Schema Validation

- `validateTraceEvent()` / `validatePolicy()` / `validateReport()` — JSON Schema validation
- `canonicalize()` — deterministic JSON serialization (sorted keys, no whitespace)

### Evaluation & Export

- `evaluateTrace()` / `runEvaluationPipeline()` — trace evaluation pipeline
- `computeTraceStats()` — per-session analytics (event counts, duration, token usage)
- `convertToOtlp()` — export traces to OpenTelemetry format
- `generateComplianceBundle()` — produce compliance evidence bundles

### Utilities

- `filterTraceEvents()` — filter events by type, agent, or time range
- `redact()` / `redactWithPatterns()` — redact sensitive fields from trace events
- `SeededRandom` — deterministic PRNG (Mulberry32) for reproducible behavior
- `detectEnvironment()` — detect runtime environment context

## Usage

```typescript
import { startSession, recordEvent, endSession, TraceWriter } from "@krynix/core";

const writer = new TraceWriter({ outputPath: "./traces" });
const session = startSession({ agentId: "my-agent" });

recordEvent(session, {
  event_type: "tool_call",
  payload: { tool_name: "search", arguments: { query: "hello" } },
});

const events = endSession(session);
await writer.writeEvents(events);
```

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
