# Testing Strategy

Krynix uses a three-tier testing approach: unit tests, integration tests, and golden trace tests. All tests run via [Vitest](https://vitest.dev/).

## Test Tiers

| Tier | Location | Purpose |
|------|----------|---------|
| **Unit** | `packages/*/src/*.test.ts` | Pure function and module tests |
| **Integration** | `test/integration/*.test.ts` | Cross-package interaction tests |
| **Golden Trace** | `test/golden/*.trace.jsonl` | Deterministic replay regression tests |

Run `pnpm test` to see the current count.

## Unit Tests

Unit tests are colocated with source files:

```
packages/core/src/
  hash-chain.ts
  hash-chain.test.ts      # Tests for hash-chain.ts
  redaction.ts
  redaction.test.ts        # Tests for redaction.ts
```

### Conventions

- **Pure function testing** -- most core functions are pure (no side effects), tested with input/output assertions
- **Dependency injection** -- impure functions (HTTP, filesystem) use `Partial<XDeps>` pattern for mock injection
- **No mocking libraries** -- mocks are plain objects or functions, not library-generated
- **Edge cases** -- each test file includes edge case sections (empty inputs, NaN, boundary values)

### Example

```typescript
import { describe, test, expect } from "vitest";
import { computeTraceStats } from "./trace-stats.js";

describe("computeTraceStats", () => {
  test("returns zeroed stats for empty trace", () => {
    const stats = computeTraceStats([]);
    expect(stats.event_count).toBe(0);
    expect(stats.duration_ms).toBeNull();
  });

  test("counts tool_call events correctly", () => {
    const events = [makeEvent("tool_call"), makeEvent("tool_call"), makeEvent("llm_request")];
    const stats = computeTraceStats(events);
    expect(stats.tool_call_count).toBe(2);
  });
});
```

## Integration Tests

Integration tests verify cross-package interactions:

```
test/integration/
  golden-traces.test.ts         # End-to-end trace replay
  pipeline.test.ts              # Trace -> evaluate -> replay pipeline
  cli-commands.test.ts          # CLI router integration
  stats-pipeline.test.ts        # Stats computation pipeline
  redaction-custom.test.ts      # Custom redaction patterns
  export-otlp.test.ts           # OTLP export pipeline
  policy-inheritance.test.ts    # Policy inheritance resolution
  review-edge-cases.test.ts     # Edge cases found during reviews
  sprint4-edge-cases.test.ts    # Sprint 4 review edge cases
```

Integration tests import from source paths (`../../packages/*/src/index.js`), not package names, because the `test/` directory is not a pnpm workspace member.

## Golden Trace Tests

Golden traces are verified `.trace.jsonl` files committed to version control:

```
test/golden/
  session-001.trace.jsonl
  session-002.trace.jsonl
```

The golden trace test verifies that:
1. Each golden trace has a valid hash chain
2. Lifecycle events are present and properly ordered
3. Hash recomputation produces identical results

```bash
# Run golden trace tests only
pnpm test:golden
```

### Updating Golden Traces

When intentional behavior changes occur:

```bash
# Regenerate hash chains for all golden traces
pnpm krynix replay --regenerate --golden-dir test/golden/

# Review the diff
git diff test/golden/

# Commit if the changes are intentional
git add test/golden/ && git commit -m "test: update golden traces for new behavior"
```

## Running Tests

```bash
# All tests
pnpm test

# Specific package
pnpm --filter @krynix/core test

# Watch mode
pnpm --filter @krynix/core test -- --watch

# Integration tests
pnpm test:integration

# Golden trace tests
pnpm test:golden

# With coverage (if configured)
pnpm test -- --coverage
```

## Test Patterns

### DI Mock Pattern

```typescript
test("handles HTTP error", async () => {
  const result = await runMyCommand(["--flag", "value"], {
    fetchFn: () => Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: "Internal error" }),
    }) as unknown as Response,
  });
  expect(result.exitCode).toBe(1);
});
```

### Trace Builder Helper

Many tests construct trace events using helper functions:

```typescript
function makeEvent(type: string, overrides = {}): TraceEvent {
  return {
    event_id: "evt-1",
    session_id: "sess-1",
    sequence_num: 0,
    timestamp: "2026-01-15T12:00:00.000Z",
    event_type: type,
    agent_id: "agent-1",
    payload: {},
    redacted: false,
    prev_hash: "",
    event_hash: "",
    schema_version: "1.0.0",
    ...overrides,
  };
}
```

### Edge Case Testing

Every code review adds edge case tests. Common patterns:

- NaN/undefined values in numeric fields
- Empty arrays and objects
- Boundary timestamps
- Missing optional fields
- Double-call scenarios (e.g., `open()` called twice)
- Error propagation verification

## CI Integration

All tests run in CI on every PR:

```yaml
# .github/workflows/ci.yml
- name: Test
  run: pnpm test
```

The test step must pass (zero failures) for a PR to merge. There is no test skip or flaky test ignore mechanism.

## See Also

- [[Development Guide]] -- Full development setup
- [[Trust Pipeline]] -- How golden traces fit into CI enforcement
