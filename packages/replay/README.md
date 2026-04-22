# @krynix/replay

Replay and integrity verification engine for [Krynix](https://github.com/PROJECT-OBA/krynix) — hash chain verification, golden trace validation, and behavioral drift comparison.

## Install

```bash
npm install @krynix/replay
```

## Key Exports

- **`verifyTrace(trace, options)`** — verify hash chain integrity for a single trace
- **`verifyGoldenDir(directory)`** — verify all traces in a golden-directory tree
- **`compareTraces(baseline, candidate)`** — diff two traces for behavioral drift detection
- **`extractEnvelope(events)`** — extract replay envelope from session_start event

## Usage

```typescript
import { verifyTrace, compareTraces } from "@krynix/replay";
import { readTrace } from "@krynix/core";

// Verify trace integrity (hash chain, lifecycle, sequence numbers)
const result = await verifyTrace("/path/to/trace.jsonl");
// result.status: "pass" | "diverged" | "error"
// result.report?.firstDivergence — details of the first divergence point

// Compare two traces for behavioral drift
const baseline = await readTrace("/path/to/golden.trace.jsonl");
const candidate = await readTrace("/path/to/new.trace.jsonl");
const diff = compareTraces(baseline, candidate);
// diff.status: "pass" | "diverged"
// diff.firstDivergence?.diffs — field-level diffs at divergence point
```

## License

Apache 2.0
