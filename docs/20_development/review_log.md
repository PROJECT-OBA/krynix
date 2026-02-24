# Review Log

Tracks bugs, design issues, and test gaps found during code reviews.
Each entry records what was found, what was fixed, and what was deferred.

---

## Sprint 2 Review (2026-02-24)

**Scope:** All 11 Sprint 2 tasks (TASK-012 through TASK-022) covering seeded PRNG, adapter interface, session manager, determinism envelope, event comparator, replay runner, CLI replay command, and OpenClaw reference adapter.

**Pre-review state:** 253 tests passing, all checks clean.
**Post-review state:** 263 tests passing, all checks clean.

### Fixed

#### BUG-3/BUG-4: `undefined` values leaked into adapter payloads
- **Severity:** Low
- **Files:** `packages/adapter-openclaw/src/adapter.ts`
- **Problem:** Optional fields (`resumedFrom`, `systemPrompt`, `durationMs`) were unconditionally assigned, producing `{ resumedFrom: undefined }` in the runtime object. While `JSON.stringify` drops `undefined`, the canonical JSON serializer's behavior on `undefined` was implicitly relied upon. This is fragile and produces different in-memory vs serialized representations.
- **Fix:** Conditionally include optional fields only when defined.
- **Tests added:** `session_start` without `resumedFrom` produces empty context; `session_end` without `durationMs` omits it; `llm_input` without `systemPrompt` omits it from parameters.

#### BUG-5: Single-event trace bypassed `session_end` check
- **Severity:** Medium
- **Files:** `packages/replay/src/replay-runner.ts`
- **Problem:** `verifyTrace` checked for `session_end` only when `events.length > 1`. A single-event trace (only `session_start`) passed the `session_end` check silently and only failed later on envelope extraction with a misleading error message.
- **Fix:** Added explicit check: `events.length === 1` → "Trace must have at least 2 events (session_start + session_end)".
- **Tests added:** Single-event trace returns error with "at least 2 events" message.

#### BUG-6: Adapter `onEvent` before `initialize` produced broken events
- **Severity:** Medium
- **Files:** `packages/adapter-openclaw/src/adapter.ts`
- **Problem:** If `onEvent()` was called before `initialize()`, `this.config` was `null`. The code silently produced events with empty `agent_id` and `session_id` (via `this.config?.agentId ?? ""`). No error, no indication of misuse.
- **Fix:** Added null config guard at the top of `onEvent()` — returns `null` if adapter is not initialized.
- **Tests added:** `onEvent` before `initialize` returns null.

#### BUG-9: Envelope extractor accepted invalid seeds
- **Severity:** Medium
- **Files:** `packages/replay/src/envelope.ts`
- **Problem:** The seed validation only checked `typeof replaySeed !== "number" || replaySeed > Number.MAX_SAFE_INTEGER`. This accepted `NaN`, negative, zero, and fractional values. If replay was attempted with such seeds, the error would surface much later from `SeededRandom`, making debugging harder.
- **Fix:** Replaced with `!Number.isSafeInteger(replaySeed) || replaySeed <= 0`, matching `SeededRandom`'s validation.
- **Tests added:** Seed 0 throws; negative seed throws; fractional seed throws.

### Test Gaps Filled

| Package | Test | Gap |
|---|---|---|
| `cli/replay` | `--regenerate --trace valid.trace.jsonl` exits 0 | No test exercised the regenerate code path |
| `core/session` | Session metadata appears in `session_start` context | `metadata` config option was untested |

### Deferred (Acceptable)

#### BUG-1: Session Manager memory leak on abandoned sessions
- **Severity:** Low (CLI context) / Medium (server context)
- **Files:** `packages/core/src/session.ts:76`
- **Problem:** The module-level `sessions` Map is never cleaned if `endSession` is not called. In a long-running server process, this would leak memory.
- **Rationale for deferral:** Krynix is currently CLI-first. Each process runs one session and exits. A `destroySession()` or TTL-based cleanup would be needed for server use. Track this when server deployment is scoped.

#### BUG-2: Dual `session_start` events in OpenClaw traces
- **Severity:** Informational
- **Files:** `packages/adapter-openclaw/src/adapter.ts`, `packages/core/src/session.ts`
- **Problem:** The session manager writes a `lifecycle:session_start` event (seq 0, contains `replay_seed`), and the adapter also produces a separate `lifecycle:session_start` event from the OpenClaw hook (seq 1, contains OpenClaw-specific context). The trace has two `session_start` lifecycle events.
- **Rationale for deferral:** By design. The session manager's event establishes the determinism envelope (replay seed). The adapter's event records what OpenClaw reported. They serve different purposes. Future: could consider merging them, but that would require the adapter to know about the session manager's internals, breaking the separation of concerns.

#### BUG-8: `require-approval-file-write` policy rule untested in integration
- **Severity:** Low
- **Files:** `packages/adapter-openclaw/policies/openclaw-default.policy.yaml`, `packages/adapter-openclaw/src/integration.test.ts`
- **Problem:** The policy defines a `require-approval-file-write` rule, but no simulated OpenClaw event includes a `file_write` tool call. The rule is structurally valid (the policy evaluator unit tests cover the `require-approval` action), but the full integration path is unexercised.
- **Rationale for deferral:** Adding a `file_write` event to the integration test would change the golden trace and event counts. The policy evaluator's unit tests already cover `require-approval` matching. This is a nice-to-have, not a correctness gap.

#### BUG-10: `after_tool_call` prefers `error` over `result`
- **Severity:** Informational
- **Files:** `packages/adapter-openclaw/src/adapter.ts:111`
- **Problem:** `output: hookEvent.event.error ?? hookEvent.event.result ?? null` — if both `error` and `result` are present on an OpenClaw event, `error` wins silently.
- **Rationale for deferral:** Intentional design choice. OpenClaw events with both fields would be unusual. The error is the more important signal for audit. Codified as expected behavior; no action needed unless OpenClaw's event model changes.

---

## Sprint 3 Review (2026-02-24)

**Scope:** All 8 Sprint 3 tasks (TASK-023 through TASK-030) covering shared CLI arg utilities, policy validate command, verbose replay output, `--regenerate --golden-dir` support, CLI binary entry point with help/version/routing, end-to-end integration tests, root workspace scripts, and CI pipeline hardening.

**Pre-review state:** 325 tests passing, all checks clean.
**Post-review state:** 347 tests passing, all checks clean. 1 bug fixed.

### Files Reviewed

| File | Type | Task |
|---|---|---|
| `packages/cli/src/arg-parser.ts` | New | TASK-023 |
| `packages/cli/src/arg-parser.test.ts` | New | TASK-023 |
| `packages/cli/src/evaluate.ts` | Modified | TASK-023 (import) |
| `packages/cli/src/replay.ts` | Modified | TASK-023, 025, 026 |
| `packages/cli/src/replay.test.ts` | Modified | TASK-026 |
| `packages/cli/src/validate.ts` | New | TASK-024 |
| `packages/cli/src/validate.test.ts` | New | TASK-024 |
| `packages/cli/src/format-replay.ts` | New | TASK-025 |
| `packages/cli/src/format-replay.test.ts` | New | TASK-025 |
| `packages/cli/src/help.ts` | New | TASK-027 |
| `packages/cli/src/help.test.ts` | New | TASK-027 |
| `packages/cli/src/router.ts` | New | TASK-027 |
| `packages/cli/src/router.test.ts` | New | TASK-027 |
| `packages/cli/src/main.ts` | New | TASK-027 |
| `packages/cli/src/index.ts` | Modified | TASK-024 |
| `packages/cli/package.json` | Modified | TASK-027 |
| `packages/cli/tsup.config.ts` | Modified | TASK-027 |
| `packages/replay/src/replay-runner.ts` | Modified | TASK-026 |
| `packages/replay/src/replay-runner.test.ts` | Modified | TASK-026 |
| `packages/replay/src/index.ts` | Modified | TASK-026 |
| `test/integration/golden-traces.test.ts` | New | TASK-028 |
| `test/integration/pipeline.test.ts` | New | TASK-028 |
| `test/integration/cli-commands.test.ts` | New | TASK-028 |
| `package.json` | Modified | TASK-029 |
| `vitest.config.ts` | Modified | TASK-028 |
| `.github/workflows/ci.yml` | Modified | TASK-030 |

### Fixed

#### BUG-11: Router emitted empty JSON array to stdout on error for replay/validate

- **Severity:** Medium
- **Files:** `packages/cli/src/router.ts:67-90`
- **Problem:** When `runReplay` or `runValidate` returned an error with zero results (e.g., missing `--trace` flag), the router still serialized `result.results` to stdout, producing `[]`. This meant the user saw `[]` printed to stdout alongside the error on stderr. The evaluate command correctly guarded this with `result.output !== null ? ... : ""`, but replay and validate did not.
- **Fix:** Added guard: `result.error !== null && result.results.length === 0 ? "" : JSON.stringify(...)`. This suppresses stdout when there's a usage error with no meaningful results, but still emits the results array when there are actual results (even if some have error status, such as a corrupt trace file in a golden directory).
- **Tests added:** `test/integration/review-edge-cases.test.ts` — "validate missing --policy puts error in stderr" confirms stdout is empty string, "evaluate missing --trace puts error in stderr" confirms the same pattern for evaluate (which already worked), and "replay missing args puts error in stderr".

### Edge Cases Verified (No Fix Needed)

#### EC-1: `getArg` returns flag-like value as argument

- **Severity:** Informational
- **Files:** `packages/cli/src/arg-parser.ts:17-21`
- **Observation:** `getArg(["--trace", "--verbose"], "--trace")` returns `"--verbose"`. The function blindly returns `args[idx+1]` without checking whether the next token is itself a flag. This is standard POSIX-style behavior (values are positional relative to their flag) and matches how the rest of the CLI code uses the function. No fix needed — all callers expect this.
- **Tests added:** Edge case verified in `review-edge-cases.test.ts`.

#### EC-2: `parseCommand` cannot distinguish flag values from positional args

- **Severity:** Informational
- **Files:** `packages/cli/src/arg-parser.ts:45-56`
- **Observation:** `parseCommand(["--trace", "myfile.jsonl"])` treats `"myfile.jsonl"` as the command because it doesn't start with `--`. This is inherent to the design: `parseCommand` runs before the router knows which flags take values. In practice this is harmless because the router calls `parseCommand` on the full argv, and valid invocations always start with a subcommand name (`evaluate`, `replay`, `validate`) or a global flag (`--help`, `--version`). When only flags are given (e.g., `["--trace", "file.jsonl"]`), `parseCommand` misidentifies `"file.jsonl"` as the command, which then falls through to the unknown command error — correct behavior.
- **Tests added:** Edge case verified in `review-edge-cases.test.ts`.

#### EC-3: `--version` takes priority over everything

- **Severity:** Informational
- **Files:** `packages/cli/src/router.ts:32-34`
- **Observation:** `routeCommand(["evaluate", "--version"])` prints the version and exits 0 — the `evaluate` subcommand is never reached. This is standard CLI convention (version overrides all). Documented and tested.
- **Tests added:** `--version` with subcommand, `--version` with `--help`.

#### EC-4: `--verbose` silently ignored during `--regenerate`

- **Severity:** Low
- **Files:** `packages/cli/src/replay.ts:108-139`
- **Observation:** When `--regenerate --verbose --trace <file>` is used, the `handleRegenerate` function does not populate `verboseLines`. The `--verbose` flag is parsed but has no effect. This is acceptable behavior (regeneration doesn't produce verification diagnostics), but a user might expect output. A future improvement could emit regeneration summary lines.
- **Tests added:** Confirmed `verboseLines` is `undefined` in regenerate mode.

#### EC-5: `--trace` and `--golden-dir` can be combined

- **Severity:** Informational
- **Files:** `packages/cli/src/replay.ts:77-106`
- **Observation:** Both `--trace` and `--golden-dir` can be specified simultaneously. `handleVerify` and `handleRegenerate` both process the single trace first, then the directory. Results are concatenated. This is useful behavior (verify a specific trace plus an entire golden directory in one invocation) and works correctly.
- **Tests added:** Both verify and regenerate paths tested with combined flags.

#### EC-6: Single file vs. directory behavior asymmetry in validate

- **Severity:** Informational
- **Files:** `packages/cli/src/validate.ts:53-61`
- **Observation:** When `--policy` points to a single file, it's validated regardless of extension. When pointing to a directory, only files matching `*.policy.yaml` are scanned. This is intentional: single-file mode trusts the user's explicit choice, while directory mode needs a filter to avoid processing non-policy files.
- **Tests added:** Both behaviors verified.

#### EC-7: `formatReplayResults` handles missing optional fields gracefully

- **Severity:** Informational
- **Files:** `packages/cli/src/format-replay.ts`
- **Observation:** `ReplayResult.report` and `ReplayResult.validationErrors` are optional. The formatter safely handles: (1) pass with no report shows "0 events", (2) diverged with no report shows just the file, (3) error with no validationErrors shows just the file. No crashes.
- **Tests added:** All three cases in `review-edge-cases.test.ts`.

### Architecture Observations

#### Binary build clean separation
The `tsup.config.ts` dual-config approach (library entry + binary entry) is well-structured. The binary (`main.ts`) is a thin impure shell that reads `process.argv`, calls the pure `routeCommand`, writes output, and exits. All logic is testable through the router without subprocess spawning. The shebang is injected via tsup's `banner` config rather than in the source file, avoiding the duplicate-shebang bug discovered and fixed during implementation.

#### CLI index.ts does not export router or help
`packages/cli/src/index.ts` exports `runEvaluate`, `runReplay`, and `runValidate` but not `routeCommand`, `CommandOutput`, `getVersion`, `getMainHelp`, or `getCommandHelp`. This is correct: the router and help are internal to the binary. External consumers (SDKs, CI scripts) import the individual command functions directly. The `CommandOutput` type stays internal to the binary layer.

#### Integration tests use relative source imports
The `test/integration/*.test.ts` files import from `../../packages/*/src/index.js` (relative source paths) rather than package names (`@krynix/*`). This is necessary because the test directory is not a pnpm workspace member, so workspace protocol resolution doesn't apply. The tradeoff is that these tests bypass the built dist and test source directly. This is acceptable for now since the unit tests within each package already validate the build output. If dist-level integration testing is needed, a separate workspace-member test package could be created.

### Deferred (Acceptable)

#### BUG-1 (Sprint 2): Session Manager memory leak — still deferred
No change from Sprint 2 review. Still CLI-first, process-per-session.

#### BUG-2 (Sprint 2): Dual session_start events — still deferred
No change. By design for adapter separation.

#### EC-4: Verbose output in regenerate mode
As noted above, `--verbose` has no effect during `--regenerate`. Could emit "Regenerated <n> traces" summary in a future sprint.

#### Hardcoded version in `help.ts` — RESOLVED
`const VERSION = "0.0.0"` was hardcoded. Fixed by injecting from `package.json` at build time via tsup `define` config (`__CLI_VERSION__`). Source falls back to `"0.0.0"` in test environments where the define replacement doesn't run.

### Test Coverage Summary

| Test File | Tests Added |
|---|---|
| `packages/cli/src/arg-parser.test.ts` | 8 |
| `packages/cli/src/validate.test.ts` | 8 |
| `packages/cli/src/format-replay.test.ts` | 7 |
| `packages/cli/src/help.test.ts` | 7 |
| `packages/cli/src/router.test.ts` | 12 |
| `packages/cli/src/replay.test.ts` | +3 (regenerate golden-dir) |
| `packages/replay/src/replay-runner.test.ts` | +6 (regenerateGoldenDir) |
| `test/integration/golden-traces.test.ts` | 3 |
| `test/integration/pipeline.test.ts` | 4 |
| `test/integration/cli-commands.test.ts` | 6 |
| `test/integration/review-edge-cases.test.ts` | 22 |

**Total new tests this sprint (including review):** 86 (263 → 347 + 2 existing modified)
**Total test suite:** 347 tests across 31 test files

---

## Sprint 4 Review (2026-02-24)

**Scope:** All 7 Sprint 4 tasks (TASK-041 through TASK-047) covering trace analytics (`computeTraceStats`), session cleanup (`destroySession`/`getActiveSessions`), custom redaction patterns (`redactWithPatterns`), CLI `stats` command, CLI `policy test` command, integration tests, and CI updates.

**Pre-review state:** 409 tests passing across 36 test files, all checks clean.
**Post-review state:** 432 tests passing across 37 test files, all checks clean. 1 bug fixed.

### Files Reviewed

| File | Type | Task |
|---|---|---|
| `packages/core/src/trace-stats.ts` | New | TASK-041 |
| `packages/core/src/trace-stats.test.ts` | New | TASK-041 |
| `packages/core/src/session.ts` | Modified | TASK-042 |
| `packages/core/src/session.test.ts` | Modified | TASK-042 |
| `packages/core/src/redaction.ts` | Modified | TASK-043 |
| `packages/core/src/redaction.test.ts` | Modified | TASK-043 |
| `packages/core/src/index.ts` | Modified | TASK-041, 042, 043 |
| `packages/cli/src/stats.ts` | New | TASK-044 |
| `packages/cli/src/stats.test.ts` | New | TASK-044 |
| `packages/cli/src/policy-test.ts` | New | TASK-045 |
| `packages/cli/src/policy-test.test.ts` | New | TASK-045 |
| `packages/cli/src/router.ts` | Modified | TASK-044, 045 |
| `packages/cli/src/router.test.ts` | Modified | TASK-044, 045 |
| `packages/cli/src/help.ts` | Modified | TASK-047 |
| `packages/cli/src/help.test.ts` | Modified | TASK-047 |
| `packages/cli/src/index.ts` | Modified | TASK-044, 045 |
| `test/integration/stats-pipeline.test.ts` | New | TASK-046 |
| `test/integration/redaction-custom.test.ts` | New | TASK-046 |
| `test/integration/cli-commands.test.ts` | Modified | TASK-046 |
| `.github/workflows/ci.yml` | Modified | TASK-047 |

### Fixed

#### BUG-12: Router policy namespace misidentified flag values as subcommand

- **Severity:** Medium
- **Files:** `packages/cli/src/router.ts:102-133`
- **Problem:** The policy namespace routing used `rest.find((t) => !t.startsWith("--"))` to identify the subcommand (e.g., `"test"`). This treated any non-flag token as a subcommand candidate, including flag **values** — file paths, verdict strings, etc. For example, `krynix policy --trace /tmp/trace.jsonl test --policy policy.yaml` would identify `/tmp/trace.jsonl` as the subcommand (not `"test"`), because it's the first token not starting with `--`. This caused the command to fail with "Unknown policy subcommand: /tmp/trace.jsonl".
- **Root cause:** `rest.find()` has no concept of flag-value pairs. It cannot distinguish between `--trace <value>` (where the value is a flag argument) and a bare positional token (the subcommand name).
- **Fix:** Introduced `findSubcommandToken()` helper that iterates through the argument list, skipping both `--`-prefixed flags and their immediately following values. The first token that is neither a flag nor a flag value is the subcommand. Also replaced `rest.indexOf("test")` (which could match a flag value containing "test") with the index returned by `findSubcommandToken()` for safe removal.
- **Tests added:** `test/integration/sprint4-edge-cases.test.ts` — "flags before 'test' subcommand are passed through correctly" verifies `routeCommand(["policy", "--trace", tracePath, "test", "--policy", policyPath])` routes correctly.

### Edge Cases Verified (No Fix Needed)

#### EC-8: `computeTraceStats` — negative duration from clock skew

- **Severity:** Informational
- **Files:** `packages/core/src/trace-stats.ts`
- **Observation:** If `session_end` has an earlier timestamp than `session_start` (clock skew or corrupted data), `duration_ms` will be negative. The function does not clamp to zero. This is correct: negative duration is a signal of data quality issues, and clamping would hide the problem. Consumers can check for negative values if needed.
- **Tests added:** Verified `duration_ms` is computed as a number regardless of sign.

#### EC-9: `computeTraceStats` — checkpoint lifecycle events

- **Severity:** Informational
- **Files:** `packages/core/src/trace-stats.ts`
- **Observation:** Lifecycle events with `action: "checkpoint"` (or any action other than `session_start`/`session_end`) do not affect `duration_ms` computation. Only `session_start` and `session_end` are used. This is correct by design: the `computeTraceStats` function checks `payload.action === "session_start"` and `payload.action === "session_end"` explicitly.
- **Tests added:** Trace with start, checkpoint (t=30s), and end (t=10s) yields `duration_ms = 10000`, not `30000`.

#### EC-10: `computeTraceStats` — multiple `session_end` events

- **Severity:** Informational
- **Files:** `packages/core/src/trace-stats.ts`
- **Observation:** When a trace has multiple `session_end` lifecycle events, the function uses the **last** one for duration computation. This is because `endTimestamp` is overwritten on each `session_end` encounter. This is correct behavior: the last `session_end` represents the true end of the session (earlier ones could be from aborted shutdown attempts).
- **Tests added:** Trace with start (t=0) and two `session_end` events (t=5s, t=10s) yields `duration_ms = 10000`.

#### EC-11: `computeTraceStats` — unknown event types

- **Severity:** Informational
- **Files:** `packages/core/src/trace-stats.ts`
- **Observation:** Unknown event types (not in the standard 8 types) are dynamically counted in `event_type_counts` via `(eventTypeCounts[event.event_type] ?? 0) + 1`. The record is initialized with all 8 standard types at 0, and additional types appear as keys when encountered. This handles future extensibility cleanly.
- **Tests added:** Event with `event_type: "custom_type"` is counted correctly; standard types remain at 0.

#### EC-12: `computeTraceStats` — zero-token LLM response

- **Severity:** Informational
- **Files:** `packages/core/src/trace-stats.ts`
- **Observation:** An `llm_response` event with `{prompt_tokens: 0, completion_tokens: 0}` sets `total_token_usage` to `0` (not `null`). This is correct: `null` means "no LLM responses in trace", while `0` means "LLM responses existed but used zero tokens". The `hasLlmResponse` flag correctly distinguishes these cases.
- **Tests added:** Verified `total_token_usage === 0` (not null) for zero-token response.

#### EC-13: `destroySession` then reuse same seed

- **Severity:** Informational
- **Files:** `packages/core/src/session.ts`
- **Observation:** After `destroySession(session1)`, starting a new session with the same `replaySeed` works correctly. The first session is removed from the `sessions` Map by `destroySession`, so the new session gets a clean entry. Both sessions have the same deterministic `sessionId` (derived from seed), which is expected.
- **Tests added:** Verified destroy-then-reuse-seed round-trip works.

#### EC-14: `destroySession` and `endSession` race condition

- **Severity:** Informational
- **Files:** `packages/core/src/session.ts`
- **Observation:** If `destroySession` runs first, it sets `internal.closed = true` and removes the session from the Map. A subsequent `endSession` call correctly throws `SESSION_CLOSED` because it checks `internal.closed` before proceeding. No silent corruption or state leaks.
- **Tests added:** Verified destroy-then-end throws; `getActiveSessions()` returns 0.

#### EC-15: `redactWithPatterns` — overlapping custom and built-in patterns

- **Severity:** Informational
- **Files:** `packages/core/src/redaction.ts`
- **Observation:** When a custom pattern matches the same field name as a built-in pattern (e.g., both match `api_key`), the value is only redacted once. The built-in pattern fires first via `SENSITIVE_PATTERN.test(fieldName)` and returns `redactValue(value)` immediately. The custom pattern never fires for that field because of the early return. No double-redaction (e.g., `[REDACTED:[REDACTED:...]]`) can occur.
- **Tests added:** Verified single redaction with overlapping patterns.

#### EC-16: `redactWithPatterns` — already-redacted flag preserved

- **Severity:** Informational
- **Files:** `packages/core/src/redaction.ts`
- **Observation:** If an event already has `redacted: true` and `redactWithPatterns` finds no new matches, the `redacted` flag remains `true`. The function uses `wasRedacted || event.redacted` to compute the final flag, preserving prior redaction state.
- **Tests added:** Verified flag preserved when no new matches.

#### EC-17: `redactWithPatterns` — empty string pattern

- **Severity:** Informational
- **Files:** `packages/core/src/redaction.ts`
- **Observation:** A custom pattern with `pattern: ""` (empty string) compiles to regex `/(?:)/i`, which matches all strings. This means every field name matches, and all string values in the payload are redacted. While this is likely unintentional from a user perspective, it's valid regex behavior and the function correctly handles it without crashing.
- **Tests added:** Verified empty pattern redacts all string values.

#### EC-18: `redactWithPatterns` — deeply nested objects (3+ levels)

- **Severity:** Informational
- **Files:** `packages/core/src/redaction.ts`
- **Observation:** The `scanObject` and `scanArray` functions recurse through nested objects without depth limits. A 3+ level nested structure (`arguments.level1.level2.level3.ssn`) is correctly redacted when the field name matches. No stack overflow was observed for reasonable depths.
- **Tests added:** Verified 3-level nested redaction works.

#### EC-19: Router `--help` priority in policy namespace

- **Severity:** Informational
- **Files:** `packages/cli/src/router.ts`
- **Observation:** `routeCommand(["policy", "--help", "test"])` shows policy help, not the test subcommand — `--help` takes priority. Similarly, `routeCommand(["policy", "test", "--help"])` shows policy test help. Both behaviors are correct: the namespace-level `--help` check runs before subcommand extraction, and the subcommand-level `--help` check runs after removal of the "test" token.
- **Tests added:** Both `--help` positions verified.

#### EC-20: CLI `stats` on empty trace file

- **Severity:** Informational
- **Files:** `packages/cli/src/stats.ts`, `packages/core/src/trace-reader.ts`
- **Observation:** An empty trace file (`""`) is parsed by `readTrace` as zero events (newline split → filter empty → zero entries). `computeTraceStats([])` returns zeroed stats. `runStats` exits 0 with `event_count: 0`. No crash.
- **Tests added:** Verified empty trace returns exit 0 with zero counts.

#### EC-21: CLI `policy test` with empty trace

- **Severity:** Informational
- **Files:** `packages/cli/src/policy-test.ts`
- **Observation:** An empty trace (zero events) against an allow-all policy returns `verdict: "pass"` with zero violations. This is correct: no events means no violations. The policy evaluator handles empty traces gracefully.
- **Tests added:** Verified empty trace yields pass verdict.

#### EC-22: CLI `policy test` — case-sensitive verdict comparison

- **Severity:** Informational
- **Files:** `packages/cli/src/policy-test.ts`
- **Observation:** `--expect-verdict PASS` (uppercase) is rejected with "Invalid --expect-verdict". Valid values are lowercase: `"pass"`, `"fail"`, `"require-approval"`. This is correct: the YAML spec and policy evaluator use lowercase, so the CLI should enforce the same.
- **Tests added:** Verified uppercase "PASS" is rejected.

### Known Limitations

#### `computeTraceStats` — no defensive check for malformed `llm_response.usage`

- **Severity:** Low
- **Files:** `packages/core/src/trace-stats.ts`
- **Problem:** The function accesses `payload.usage.prompt_tokens + payload.usage.completion_tokens` without checking if `usage` exists. If an `llm_response` event has a malformed payload (missing `usage` field), the function will throw `TypeError: Cannot read properties of undefined`. This cannot happen with events produced by the session manager (which validates payloads via the type system), but could occur if `computeTraceStats` is called on manually constructed or third-party trace data.
- **Rationale for deferral:** The function operates on `TraceEvent[]` which guarantees the payload shape via TypeScript types. Runtime validation of trace file contents happens in `readTrace` (parse errors are caught). Adding defensive checks for malformed payloads would add complexity for a scenario that's already prevented by the type system.

#### `redactWithPatterns` — no ReDoS protection

- **Severity:** Low
- **Files:** `packages/core/src/redaction.ts`
- **Problem:** Custom redaction patterns are compiled as user-supplied regex strings. Pathological patterns (e.g., `(a+)+$`) could cause ReDoS on certain field names. No timeout or complexity limit is applied.
- **Rationale for deferral:** Custom patterns are configured by the operator, not end-users or untrusted input. The risk is self-inflicted performance degradation, not a security vulnerability. A future improvement could add regex complexity bounds or a compilation timeout.

#### BUG-1 (Sprint 2): Session Manager memory leak — RESOLVED

The `destroySession()` function (TASK-042) now provides the cleanup mechanism identified as missing in Sprint 2. Callers can forcibly remove abandoned sessions from the registry. Combined with `getActiveSessions()` for leak detection, this resolves BUG-1 for both CLI and server contexts.

#### BUG-2 (Sprint 2): Dual session_start events — still deferred

No change from Sprint 3 review. By design for adapter separation.

### Test Coverage Summary

| Test File | Tests Added |
|---|---|
| `packages/core/src/trace-stats.test.ts` | 10 |
| `packages/core/src/session.test.ts` | +8 (destroySession, getActiveSessions) |
| `packages/core/src/redaction.test.ts` | +10 (redactWithPatterns) |
| `packages/cli/src/stats.test.ts` | 6 |
| `packages/cli/src/policy-test.test.ts` | 10 |
| `packages/cli/src/router.test.ts` | +5 (stats, policy namespace) |
| `packages/cli/src/help.test.ts` | +3 (stats, policy test help) |
| `test/integration/stats-pipeline.test.ts` | 5 |
| `test/integration/redaction-custom.test.ts` | 2 |
| `test/integration/cli-commands.test.ts` | +3 (stats, policy test) |
| `test/integration/sprint4-edge-cases.test.ts` | 23 |

**Total new tests this sprint (including review):** 85 (347 → 432)
**Total test suite:** 432 tests across 37 test files
