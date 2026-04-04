# @krynix/replay

Replay and integrity verification engine for Krynix. Verifies hash chain integrity, validates golden traces, and provides library-level drift comparison.

## Key Exports

- `verifyTrace()` — verify hash chain integrity for a single trace
- `verifyGoldenDir()` — verify all traces in a golden directory
- `validateGoldenTraces()` — validate golden trace files
- `regenerateTrace()` — regenerate hash chains in a trace file
- `compareTraces()` — structural drift comparison between two traces (library function, not CLI-accessible)
- `extractEnvelope()` — extract replay metadata from session_start events

## Usage

```typescript
import { verifyTrace, verifyGoldenDir } from "@krynix/replay";
import { readTrace } from "@krynix/core";

// Verify a single trace
const events = await readTrace("./traces/session.trace.jsonl");
const result = verifyTrace(events);
// result.status: "pass" | "fail"

// Verify all golden traces in a directory
const results = await verifyGoldenDir("./test/golden/");
```

## Current Status

- **CURRENT**: Hash chain integrity verification, golden trace validation
- **PARTIAL**: Structural drift comparison exists as library function (`compareTraces`) but is not yet CLI-integrated

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
