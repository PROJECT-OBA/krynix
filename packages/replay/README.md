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

// Verify trace integrity
const result = await verifyTrace("/path/to/trace.jsonl");
// result.valid === true if hash chain is intact

// Compare two traces for behavioral drift
const diff = compareTraces(baselineEvents, candidateEvents);
// diff.status: "pass" | "diverged"
```

## License

MIT
