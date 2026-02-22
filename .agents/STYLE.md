# Style Guide

This document defines coding conventions for the Krynix project. All code contributions must follow these guidelines.

See [architecture](../docs/10_architecture/architecture.md) for the module structure and dependency direction.

## Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Files | kebab-case | `hash-chain.ts`, `canonical-json.ts` |
| Directories | lower-case, no hyphens for package dirs | `packages/core/`, `packages/policy/` |
| Types / Interfaces | PascalCase | `TraceEvent`, `PolicyVerdict`, `AdapterConfig` |
| Functions | camelCase | `computeHash`, `evaluatePolicy`, `parseTrace` |
| Constants | UPPER_SNAKE_CASE | `MAX_EVENTS`, `DEFAULT_SEED`, `SCHEMA_VERSION` |
| Enum members | PascalCase | `EventType.ToolCall`, `Severity.Critical` |
| Policy files | kebab-case + `.policy.yaml` | `no-shell-exec.policy.yaml` |
| Trace files | kebab-case + `.trace.jsonl` | `minimal-session.trace.jsonl` |
| Test files | source name + `.test.ts` | `hash-chain.test.ts` |

## Module Boundaries

### Package Structure

Each package in `packages/` has a single public entry point: `index.ts`. All exports must go through this file. Internal modules are not part of the public API and may change without notice.

```
packages/core/
├── src/
│   ├── index.ts          # Public API — the ONLY import target
│   ├── types.ts           # Internal: TraceEvent type definitions
│   ├── hash-chain.ts      # Internal: hash chain computation
│   ├── canonical-json.ts  # Internal: deterministic JSON serialization
│   └── redaction.ts       # Internal: redaction engine
└── package.json
```

### Dependency Direction

```
core ← policy ← cli
core ← replay ← cli
core ← adapters
```

- `core` has zero internal dependencies
- `policy` depends only on `core`
- `replay` depends only on `core`
- `adapters` depend only on `core`
- `cli` depends on `policy`, `replay`, and optionally `adapters`
- **No package may import from `cli`**
- **No circular dependencies**

Violations are caught by the linter and will fail CI.

## Small, Pure Modules

### Function Purity

Functions are **pure by default**: same inputs produce same outputs, no side effects. Pure functions must not mutate their arguments.

Side effects (file I/O, network, logging) and in-place mutation are only permitted in **boundary modules** (CLI entry points, trace writer, adapter lifecycle methods). Functions that mutate arguments must be explicitly documented with `@mutates` in their JSDoc.

**Pure** (preferred — all core/policy/replay logic):
```typescript
function computeEventHash(event: TraceEvent): string { ... }
function matchRule(event: TraceEvent, rule: PolicyRule): boolean { ... }
function redact(event: TraceEvent): TraceEvent { ... } // returns new object
```

**Impure / mutating** (boundary modules only, must be documented):
```typescript
/**
 * @mutates events — sets prev_hash and event_hash in place.
 */
async function writeTrace(path: string, events: TraceEvent[]): Promise<void> { ... }
```

### File Size Limits

| Limit | Threshold | Enforcement |
|---|---|---|
| Soft limit | 300 lines per file | CI warning |
| Hard limit | 500 lines per file | CI failure (requires justification in PR) |

If a file approaches the soft limit, split it into focused submodules.

### Function Length

Maximum **50 lines** per function. If a function exceeds this, extract helper functions. Each function should do one thing.

## Test Conventions

### Colocation

Test files are colocated with their source files:

```
src/
├── hash-chain.ts
├── hash-chain.test.ts
├── redaction.ts
└── redaction.test.ts
```

### Golden Trace Tests

Golden trace files are stored in `test/golden/` and tested via the replay engine:

```
test/
└── golden/
    ├── minimal-session.trace.jsonl
    ├── tool-call-chain.trace.jsonl
    └── redaction-example.trace.jsonl
```

### Test Requirements

- Every public function (exported from `index.ts`) must have at least one test
- Tests must be deterministic: no network calls, no wall-clock dependencies, no unseeded randomness
- Test names describe the behavior being verified, not the implementation:
  - Good: `"detects tampered event in hash chain"`
  - Bad: `"test computeHash"`

### Test Structure

Use Arrange-Act-Assert:

```typescript
test("detects tampered event in hash chain", () => {
  // Arrange
  const events = createValidTrace(3);
  events[1].payload.tool_name = "tampered";

  // Act
  const result = validateHashChain(events);

  // Assert
  expect(result.valid).toBe(false);
  expect(result.brokenAt).toBe(1);
});
```

## Enums vs String Unions

**Wire format types** (TraceEvent `event_type`, Policy `action`, `severity`, `operator`) use **string unions** to match their JSON/YAML representation:

```typescript
type EventType = "tool_call" | "tool_result" | "llm_request" | "llm_response"
  | "decision" | "observation" | "error" | "lifecycle";

type PolicyAction = "allow" | "deny" | "require-approval";
type Severity = "info" | "warning" | "error" | "critical";
```

TypeScript `enum` is permitted for **internal-only** values that never cross a serialization boundary (e.g., `KrynixErrorCode`). If a value appears in JSON or YAML, it must be a string union.

## Error Handling

### Typed Error Codes

Use typed error codes for programmatic handling. Do not rely on error message strings for control flow.

```typescript
enum KrynixErrorCode {
  HASH_CHAIN_BROKEN = "HASH_CHAIN_BROKEN",
  INVALID_POLICY = "INVALID_POLICY",
  REPLAY_DIVERGED = "REPLAY_DIVERGED",
  TRACE_VALIDATION_FAILED = "TRACE_VALIDATION_FAILED",
}

class KrynixError extends Error {
  constructor(
    public readonly code: KrynixErrorCode,
    message: string,
  ) {
    super(message);
  }
}
```

### Error Rules

- All errors must be either recoverable (handled and execution continues) or explicitly fatal (process exits with a defined exit code)
- No swallowed errors — every `catch` must either handle the error or rethrow
- Boundary modules (CLI, adapters) handle errors and map them to exit codes or user-facing messages
- Core modules throw typed errors and let callers decide handling

## Documentation

### Required Documentation

- All public APIs (exported from `index.ts`) must have JSDoc comments
- All exported types must have doc comments explaining their purpose
- Each package directory must contain a README describing the package's responsibility

### JSDoc Style

```typescript
/**
 * Compute the SHA-256 hash chain for a sequence of TraceEvents.
 *
 * Sets `prev_hash` and `event_hash` on each event. Events must be
 * in sequence_num order. The first event's `prev_hash` is set to "".
 *
 * @param events - Ordered TraceEvents. Modified in place.
 * @returns The events with hash chain fields populated.
 * @throws {KrynixError} HASH_CHAIN_BROKEN if events are not in sequence order.
 */
function computeHashChain(events: TraceEvent[]): TraceEvent[] { ... }
```

## Commit Conventions

See [commit conventions](../docs/20_development/commit_conventions.md) for the full specification. Summary:

- Conventional Commits format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `chore`
- Scopes match package names: `core`, `policy`, `replay`, `cli`, `adapters`
- Squash merge to `main`
