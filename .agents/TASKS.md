# Tasks

Initial implementation tasks for Krynix. Each task is small, self-contained, and independently mergeable.

Prerequisites: Read [trace_spec](../docs/10_architecture/trace_spec.md), [policy_spec](../docs/10_architecture/policy_spec.md), [determinism_spec](../docs/10_architecture/determinism_spec.md), [dev_env](../docs/20_development/dev_env.md), and [STYLE.md](STYLE.md) before starting.

---

## TASK-000: Bootstrap Monorepo

**Description:** Set up the pnpm workspace, strict TypeScript config, Vitest, ESLint + Prettier, and a minimal CI workflow. This provides the foundation all other tasks build on.

**Allowed files:**
- `pnpm-workspace.yaml`
- `tsconfig.json` (root)
- `tsconfig.base.json`
- `packages/core/package.json`
- `packages/core/tsconfig.json`
- `packages/policy/package.json`
- `packages/policy/tsconfig.json`
- `packages/replay/package.json`
- `packages/replay/tsconfig.json`
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `vitest.config.ts`
- `.eslintrc.cjs` or `eslint.config.mjs`
- `.prettierrc`
- `.github/workflows/ci.yml`
- `package.json` (root)

**Acceptance criteria:**
- `pnpm install` succeeds with zero warnings
- `pnpm -r build` compiles all packages (may be empty entry points)
- `pnpm -r test` runs Vitest across all packages (may have zero tests initially)
- `pnpm lint` runs ESLint with zero errors
- `pnpm format --check` runs Prettier with zero diffs
- Root `tsconfig.base.json` sets `strict: true`, `noUncheckedIndexedAccess: true`
- Each package extends `tsconfig.base.json`
- CI workflow runs build, test, lint, and format check on push and PR
- Packages follow the dependency direction from STYLE.md (core ← policy ← cli, etc.)

**Required tests:**
- None (infrastructure task). First tests arrive in TASK-001.

---

## TASK-001: Implement TraceEvent Type Definitions

**Description:** Define TypeScript types for `TraceEvent` and all 8 payload variants (`tool_call`, `tool_result`, `llm_request`, `llm_response`, `decision`, `observation`, `error`, `lifecycle`). Types must match the schema in `trace_spec.md` exactly.

**Allowed files:**
- `packages/core/src/types.ts`
- `packages/core/src/types.test.ts`
- `packages/core/src/index.ts` (export additions only)

**Acceptance criteria:**
- All TraceEvent fields from trace_spec.md are represented with correct TypeScript types
- All 8 event type payload interfaces are defined
- `event_type` is a string union, not a plain string
- Types compile with strict TypeScript (`strict: true`)
- Types are exported from `packages/core/src/index.ts`

**Required tests:**
- Type-level tests using `expectTypeOf` or `satisfies` to verify type structure
- A valid TraceEvent object passes type checking
- An invalid TraceEvent (missing required field) fails type checking

---

## TASK-002: Implement Canonical JSON Serialization

**Description:** Implement deterministic JSON serialization: sorted keys, no whitespace, UTF-8 encoding. This is the foundation of hash chain computation.

**Allowed files:**
- `packages/core/src/canonical-json.ts`
- `packages/core/src/canonical-json.test.ts`
- `packages/core/src/index.ts` (export additions only)

**Acceptance criteria:**
- `canonicalize(obj: unknown): string` produces deterministic output
- Keys are sorted lexicographically (Unicode code point order)
- No whitespace between tokens
- Numbers use minimal representation (no trailing zeros)
- Handles nested objects, arrays, null, boolean, and string types
- Byte-identical output for semantically equivalent objects (different key insertion order)

**Required tests:**
- Round-trip test: two objects with same keys in different order produce identical output
- Nested object test: deeply nested structures serialize correctly
- Unicode edge case test: non-ASCII characters preserved correctly
- Number formatting test: `1.0` → `1`, `0.10` → `0.1`
- Null and boolean handling

---

## TASK-003: Implement Hash Chain Computation

**Description:** Implement SHA-256 hash chain for TraceEvents per `trace_spec.md`. Depends on TASK-002 (canonical JSON).

**Allowed files:**
- `packages/core/src/hash-chain.ts`
- `packages/core/src/hash-chain.test.ts`
- `packages/core/src/index.ts` (export additions only)

**Acceptance criteria:**
- `computeHashChain(events: TraceEvent[]): TraceEvent[]` sets `prev_hash` and `event_hash` on each event
- First event (`sequence_num: 0`) has `prev_hash: ""`
- Each subsequent event has `prev_hash` equal to the previous event's `event_hash`
- `event_hash` is SHA-256 of canonical JSON with `event_hash` field set to `""`
- `validateHashChain(events: TraceEvent[]): ValidationResult` verifies chain integrity

**Required tests:**
- Valid 3-event chain: compute and validate succeeds
- Tampered event detection: modify one event's payload, validation reports the broken link
- Empty `prev_hash` for sequence 0
- Single-event trace (session_start only)
- Out-of-order sequence_num values rejected

---

## TASK-004: Implement Redaction Engine

**Description:** Implement payload field scanning and redaction per `trace_spec.md` redaction rules. Redaction must occur before hash chain computation.

**Allowed files:**
- `packages/core/src/redaction.ts`
- `packages/core/src/redaction.test.ts`
- `packages/core/src/index.ts` (export additions only)

**Acceptance criteria:**
- `redact(event: TraceEvent): TraceEvent` returns a new event with sensitive fields replaced
- Fields matching `*_key`, `*_secret`, `*_token`, `*_password`, `*_credential` patterns are redacted (case-insensitive)
- Redacted values use format `[REDACTED:SHA256_PREFIX_8]` (first 8 hex chars of SHA-256 of original value)
- `redacted` field is set to `true` if any field was redacted
- Nested payload fields are scanned at all depths
- Non-matching fields are untouched

**Required tests:**
- Known secret patterns: `api_key`, `db_password`, `auth_token` → redacted
- Nested field: `arguments.aws_secret` → redacted
- Safe field: `tool_name`, `path` → not redacted
- Deterministic placeholder: same value produces same `[REDACTED:...]` token
- Multiple fields in one payload: all matching fields redacted, `redacted` flag set once
- Case insensitivity: `API_KEY` and `api_key` both match

---

## TASK-005: Implement Policy YAML Parser

**Description:** Parse and validate `.policy.yaml` files per `policy_spec.md`. Produce typed `Policy` objects or descriptive validation errors.

**Allowed files:**
- `packages/policy/src/parser.ts`
- `packages/policy/src/parser.test.ts`
- `packages/policy/src/schema.ts`
- `packages/policy/src/index.ts` (export additions only)

**Acceptance criteria:**
- `parsePolicy(yaml: string): Policy` parses valid YAML into a typed `Policy` object
- Invalid YAML produces a typed error with the failing field path and reason
- `apiVersion` must be `krynix.dev/v1` — other values are rejected
- All required fields are validated (metadata.name, metadata.version, spec.scope, spec.rules)
- Rule operators are validated against the allowed set (eq, neq, in, not_in, matches, contains, exists)
- Actions are validated (allow, deny, require-approval)
- Severity values are validated (info, warning, error, critical)

**Required tests:**
- Valid policy with all fields: parses successfully
- Missing `metadata.name`: descriptive error
- Invalid `apiVersion`: descriptive error
- Invalid operator in rule: descriptive error
- Invalid severity: descriptive error
- Minimal valid policy (required fields only): parses successfully

---

## TASK-006: Implement Policy Rule Matcher

**Description:** Evaluate a single policy rule against a single TraceEvent. Implement all 7 operators.

**Allowed files:**
- `packages/policy/src/matcher.ts`
- `packages/policy/src/matcher.test.ts`
- `packages/policy/src/index.ts` (export additions only)

**Acceptance criteria:**
- `matchRule(event: TraceEvent, rule: PolicyRule): boolean` returns true if the event matches the rule
- All operators work: `eq`, `neq`, `in`, `not_in`, `matches` (ECMAScript RegExp via `new RegExp()`), `contains`, `exists`
- Dot-notation field paths resolve correctly through nested objects (e.g., `arguments.path`)
- Multiple payload conditions use AND logic
- `event_type` filter in `match` is respected when present
- Missing fields in payload: `exists` returns false, other operators do not match

**Required tests:**
- One test per operator (7 tests)
- Dot-notation nested field resolution
- AND logic: multiple conditions, all must match
- AND logic: one condition fails, rule does not match
- Event type filter: matching type, non-matching type
- Missing field handling

---

## TASK-007: Implement Policy Evaluator

**Description:** Evaluate a full policy against a full trace. Produce a `PolicyVerdict` with violations. Depends on TASK-006 (rule matcher).

**Allowed files:**
- `packages/policy/src/evaluator.ts`
- `packages/policy/src/evaluator.test.ts`
- `packages/policy/src/index.ts` (export additions only)

**Acceptance criteria:**
- `evaluate(trace: TraceEvent[], policy: Policy): EvaluationResult` produces a verdict and violation list
- First-match-wins: events stop evaluating against subsequent rules after a match
- Verdict computation matches `policy_spec.md`: `pass`, `fail`, `require-approval`
- Exit code mapping: 0 for pass, 1 for error, 2 for critical, 3 for require-approval
- `defaults.unmatched_action` applied to events matching no rule
- Scope filtering: events outside `spec.scope.event_types` are skipped

**Required tests:**
- `pass` verdict: trace with no violations
- `fail` verdict (error): trace with an error-severity deny
- `fail` verdict (critical): trace with a critical-severity deny, exit code 2
- `require-approval` verdict: trace with require-approval action
- First-match-wins: allowlisted event not hit by subsequent deny
- Default action: unmatched event with `defaults.unmatched_action: deny`
- Scope filtering: events outside scope are not evaluated

---

## TASK-008: Implement Trace JSONL Reader

**Description:** Parse `.trace.jsonl` files into arrays of `TraceEvent` objects with clear, line-numbered error messages for malformed input.

**Allowed files:**
- `packages/core/src/trace-reader.ts`
- `packages/core/src/trace-reader.test.ts`
- `packages/core/src/index.ts` (export additions only)

**Acceptance criteria:**
- `readTrace(path: string): Promise<TraceEvent[]>` reads a JSONL file and returns parsed TraceEvents
- Invalid JSON on a specific line produces an error identifying that line number (1-indexed)
- Missing required fields produce an error identifying the field name and line number
- Empty file returns an empty array (no error)
- Handles trailing newline correctly (no phantom empty event)

**Required tests:**
- Valid 3-event JSONL file: parses all events correctly
- Invalid JSON on line 2: error message includes "line 2"
- Missing required field `event_type`: error message identifies the field
- Empty file: returns empty array
- File with trailing newline: same result as without

---

## TASK-008b: Implement Golden Trace Validator

**Description:** Load `.trace.jsonl` files from a directory and validate their structural integrity: schema conformance, lifecycle events, and hash chain. This task does NOT perform deterministic replay — that is a separate follow-up task.

**Allowed files:**
- `packages/replay/src/golden-validator.ts`
- `packages/replay/src/golden-validator.test.ts`
- `test/golden/minimal.trace.jsonl` (create a minimal test fixture)
- `packages/replay/src/index.ts` (export additions only)

**Acceptance criteria:**
- `validateGoldenTraces(dir: string): ValidationResult[]` loads all `.trace.jsonl` files from a directory
- Each trace is validated: hash chain integrity, required fields, contiguous sequence numbers, lifecycle events (`session_start` first, `session_end` last)
- Valid traces produce a `pass` result
- Corrupted traces (broken hash chain) produce a `fail` result with the broken event identified
- Missing lifecycle events produce a `fail` result with descriptive error

**Required tests:**
- Valid minimal trace (3 events: session_start, one tool_call, session_end): passes
- Corrupted hash in middle event: fails with correct `sequence_num`
- Missing session_start: fails with descriptive error
- Missing session_end: fails with descriptive error
- Empty directory: returns empty results (no failure)

---

## TASK-009: Implement Trace JSONL Writer

**Description:** Write TraceEvents to a `.trace.jsonl` file. Handle streaming appends and ensure one event per line.

**Allowed files:**
- `packages/core/src/trace-writer.ts`
- `packages/core/src/trace-writer.test.ts`
- `packages/core/src/index.ts` (export additions only)

**Acceptance criteria:**
- `TraceWriter` class supports `open(path)`, `write(event)`, `close()`
- Each `write` appends one JSON line (canonical JSON + newline)
- Hash chain is maintained: each `write` computes `prev_hash` and `event_hash` based on the previous event
- File is valid JSON Lines after any number of writes
- Handles the first event correctly (`prev_hash: ""`)

**Required tests:**
- Write 3 events, read back, verify valid JSON Lines
- Hash chain valid across written events
- Streaming append: write, close, verify file contents
- First event has empty `prev_hash`

---

## TASK-010: Implement CLI `evaluate` Command Skeleton

**Description:** Create the CLI entry point for `krynix evaluate --trace <file> --policy <path>`. Wire up argument parsing, trace loading, policy loading, and evaluator invocation. Return correct exit codes. Depends on TASK-005, TASK-007.

**Allowed files:**
- `packages/cli/src/evaluate.ts`
- `packages/cli/src/evaluate.test.ts`
- `packages/cli/src/index.ts` (export additions only)

**Acceptance criteria:**
- Parses `--trace` and `--policy` arguments
- Loads the trace file (JSON Lines parsing)
- Loads all `.policy.yaml` files from the policy directory
- Invokes the policy evaluator for each policy
- Computes aggregate verdict (most-restrictive-wins across policies)
- Returns correct exit code: 0 (pass), 1 (error), 2 (critical), 3 (require-approval)
- Outputs violations as structured JSON to stdout

**Required tests:**
- Pass case: clean trace + permissive policy → exit 0
- Fail case (error): trace triggering error-severity deny → exit 1
- Fail case (critical): trace triggering critical-severity deny → exit 2
- Require-approval case: trace triggering require-approval → exit 3
- Missing trace file: exit 1 with error message
- Missing policy directory: exit 1 with error message

---

## TASK-011: Generate JSON Schemas for Validation

**Description:** Generate JSON Schema files for TraceEvent, Policy YAML, and evaluation report. Use Ajv for runtime validation.

**Allowed files:**
- `spec/trace.schema.json`
- `spec/policy.schema.json`
- `spec/report.schema.json`
- `packages/core/src/schema-validator.ts`
- `packages/core/src/schema-validator.test.ts`
- `packages/core/src/index.ts` (export additions only)

**Acceptance criteria:**
- `spec/trace.schema.json` validates a single TraceEvent (all 8 event types, all required fields)
- `spec/policy.schema.json` validates a Policy YAML document (all required fields, valid enums)
- `spec/report.schema.json` validates the structured JSON output from `krynix evaluate`
- `validateTraceEvent(event: unknown): ValidationResult` uses Ajv to validate against the schema
- Invalid input produces descriptive errors identifying the failing field and constraint
- Schemas are the canonical source of truth alongside the TypeScript types

**Required tests:**
- Valid TraceEvent of each event type: passes validation
- TraceEvent missing `event_id`: fails with descriptive error
- TraceEvent with invalid `event_type` value: fails with descriptive error
- Valid Policy YAML: passes validation
- Policy with invalid operator: fails with descriptive error
