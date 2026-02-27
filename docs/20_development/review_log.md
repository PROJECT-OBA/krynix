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

| Package        | Test                                                | Gap                                        |
| -------------- | --------------------------------------------------- | ------------------------------------------ |
| `cli/replay`   | `--regenerate --trace valid.trace.jsonl` exits 0    | No test exercised the regenerate code path |
| `core/session` | Session metadata appears in `session_start` context | `metadata` config option was untested      |

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

| File                                        | Type     | Task               |
| ------------------------------------------- | -------- | ------------------ |
| `packages/cli/src/arg-parser.ts`            | New      | TASK-023           |
| `packages/cli/src/arg-parser.test.ts`       | New      | TASK-023           |
| `packages/cli/src/evaluate.ts`              | Modified | TASK-023 (import)  |
| `packages/cli/src/replay.ts`                | Modified | TASK-023, 025, 026 |
| `packages/cli/src/replay.test.ts`           | Modified | TASK-026           |
| `packages/cli/src/validate.ts`              | New      | TASK-024           |
| `packages/cli/src/validate.test.ts`         | New      | TASK-024           |
| `packages/cli/src/format-replay.ts`         | New      | TASK-025           |
| `packages/cli/src/format-replay.test.ts`    | New      | TASK-025           |
| `packages/cli/src/help.ts`                  | New      | TASK-027           |
| `packages/cli/src/help.test.ts`             | New      | TASK-027           |
| `packages/cli/src/router.ts`                | New      | TASK-027           |
| `packages/cli/src/router.test.ts`           | New      | TASK-027           |
| `packages/cli/src/main.ts`                  | New      | TASK-027           |
| `packages/cli/src/index.ts`                 | Modified | TASK-024           |
| `packages/cli/package.json`                 | Modified | TASK-027           |
| `packages/cli/tsup.config.ts`               | Modified | TASK-027           |
| `packages/replay/src/replay-runner.ts`      | Modified | TASK-026           |
| `packages/replay/src/replay-runner.test.ts` | Modified | TASK-026           |
| `packages/replay/src/index.ts`              | Modified | TASK-026           |
| `test/integration/golden-traces.test.ts`    | New      | TASK-028           |
| `test/integration/pipeline.test.ts`         | New      | TASK-028           |
| `test/integration/cli-commands.test.ts`     | New      | TASK-028           |
| `package.json`                              | Modified | TASK-029           |
| `vitest.config.ts`                          | Modified | TASK-028           |
| `.github/workflows/ci.yml`                  | Modified | TASK-030           |

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

| Test File                                    | Tests Added                |
| -------------------------------------------- | -------------------------- |
| `packages/cli/src/arg-parser.test.ts`        | 8                          |
| `packages/cli/src/validate.test.ts`          | 8                          |
| `packages/cli/src/format-replay.test.ts`     | 7                          |
| `packages/cli/src/help.test.ts`              | 7                          |
| `packages/cli/src/router.test.ts`            | 12                         |
| `packages/cli/src/replay.test.ts`            | +3 (regenerate golden-dir) |
| `packages/replay/src/replay-runner.test.ts`  | +6 (regenerateGoldenDir)   |
| `test/integration/golden-traces.test.ts`     | 3                          |
| `test/integration/pipeline.test.ts`          | 4                          |
| `test/integration/cli-commands.test.ts`      | 6                          |
| `test/integration/review-edge-cases.test.ts` | 22                         |

**Total new tests this sprint (including review):** 86 (263 → 347 + 2 existing modified)
**Total test suite:** 347 tests across 31 test files

---

## Sprint 4 Review (2026-02-24)

**Scope:** All 7 Sprint 4 tasks (TASK-041 through TASK-047) covering trace analytics (`computeTraceStats`), session cleanup (`destroySession`/`getActiveSessions`), custom redaction patterns (`redactWithPatterns`), CLI `stats` command, CLI `policy test` command, integration tests, and CI updates.

**Pre-review state:** 409 tests passing across 36 test files, all checks clean.
**Post-review state:** 432 tests passing across 37 test files, all checks clean. 1 bug fixed.

### Files Reviewed

| File                                        | Type     | Task               |
| ------------------------------------------- | -------- | ------------------ |
| `packages/core/src/trace-stats.ts`          | New      | TASK-041           |
| `packages/core/src/trace-stats.test.ts`     | New      | TASK-041           |
| `packages/core/src/session.ts`              | Modified | TASK-042           |
| `packages/core/src/session.test.ts`         | Modified | TASK-042           |
| `packages/core/src/redaction.ts`            | Modified | TASK-043           |
| `packages/core/src/redaction.test.ts`       | Modified | TASK-043           |
| `packages/core/src/index.ts`                | Modified | TASK-041, 042, 043 |
| `packages/cli/src/stats.ts`                 | New      | TASK-044           |
| `packages/cli/src/stats.test.ts`            | New      | TASK-044           |
| `packages/cli/src/policy-test.ts`           | New      | TASK-045           |
| `packages/cli/src/policy-test.test.ts`      | New      | TASK-045           |
| `packages/cli/src/router.ts`                | Modified | TASK-044, 045      |
| `packages/cli/src/router.test.ts`           | Modified | TASK-044, 045      |
| `packages/cli/src/help.ts`                  | Modified | TASK-047           |
| `packages/cli/src/help.test.ts`             | Modified | TASK-047           |
| `packages/cli/src/index.ts`                 | Modified | TASK-044, 045      |
| `test/integration/stats-pipeline.test.ts`   | New      | TASK-046           |
| `test/integration/redaction-custom.test.ts` | New      | TASK-046           |
| `test/integration/cli-commands.test.ts`     | Modified | TASK-046           |
| `.github/workflows/ci.yml`                  | Modified | TASK-047           |

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

| Test File                                     | Tests Added                            |
| --------------------------------------------- | -------------------------------------- |
| `packages/core/src/trace-stats.test.ts`       | 10                                     |
| `packages/core/src/session.test.ts`           | +8 (destroySession, getActiveSessions) |
| `packages/core/src/redaction.test.ts`         | +10 (redactWithPatterns)               |
| `packages/cli/src/stats.test.ts`              | 6                                      |
| `packages/cli/src/policy-test.test.ts`        | 10                                     |
| `packages/cli/src/router.test.ts`             | +5 (stats, policy namespace)           |
| `packages/cli/src/help.test.ts`               | +3 (stats, policy test help)           |
| `test/integration/stats-pipeline.test.ts`     | 5                                      |
| `test/integration/redaction-custom.test.ts`   | 2                                      |
| `test/integration/cli-commands.test.ts`       | +3 (stats, policy test)                |
| `test/integration/sprint4-edge-cases.test.ts` | 23                                     |

**Total new tests this sprint (including review):** 85 (347 → 432)
**Total test suite:** 432 tests across 37 test files

---

## Sprint 5 Review (2026-02-25)

**Scope:** All 7 Sprint 5 tasks (TASK-048 through TASK-054) covering OTLP trace export, policy inheritance/merge, streaming hash chain validator, policy diff engine, CLI export command, CLI policy diff command, and integration tests.

**Pre-review state:** 508 tests passing across 45 test files, all checks clean.
**Post-review state:** 521 tests passing across 45 test files, all checks clean. 7 bugs fixed across 2 review passes.

### Files Reviewed

| File                                            | Type                  | Task          |
| ----------------------------------------------- | --------------------- | ------------- |
| `packages/core/src/otlp-export.ts`              | New                   | TASK-048      |
| `packages/core/src/otlp-export.test.ts`         | New                   | TASK-048      |
| `packages/core/src/streaming-validator.ts`      | New                   | TASK-049      |
| `packages/core/src/streaming-validator.test.ts` | New                   | TASK-049      |
| `packages/core/src/trace-writer.ts`             | Modified              | TASK-049      |
| `packages/core/src/trace-stats.ts`              | Modified (review fix) | TASK-041      |
| `packages/core/src/trace-stats.test.ts`         | Modified (review fix) | TASK-041      |
| `packages/core/src/index.ts`                    | Modified              | TASK-048, 049 |
| `packages/policy/src/inheritance.ts`            | New                   | TASK-050      |
| `packages/policy/src/inheritance.test.ts`       | New                   | TASK-050      |
| `packages/policy/src/diff.ts`                   | New                   | TASK-051      |
| `packages/policy/src/diff.test.ts`              | New                   | TASK-051      |
| `packages/policy/src/parser.ts`                 | Modified              | TASK-050      |
| `packages/policy/src/schema.ts`                 | Modified              | TASK-050      |
| `packages/cli/src/export.ts`                    | New                   | TASK-052      |
| `packages/cli/src/export.test.ts`               | New                   | TASK-052      |
| `packages/cli/src/policy-diff.ts`               | New                   | TASK-053      |
| `packages/cli/src/policy-diff.test.ts`          | New                   | TASK-053      |
| `packages/cli/src/stats.ts`                     | Modified (review fix) | TASK-044      |
| `packages/cli/src/policy-test.ts`               | Modified (review fix) | TASK-045      |
| `packages/cli/src/router.ts`                    | Modified              | TASK-052, 053 |
| `packages/cli/src/help.ts`                      | Modified              | TASK-054      |
| `packages/cli/src/index.ts`                     | Modified              | TASK-052, 053 |
| `test/integration/export-otlp.test.ts`          | New                   | TASK-054      |
| `test/integration/policy-inheritance.test.ts`   | New                   | TASK-054      |

### Fixed — Pass 1

#### BUG-13: `toNanoTimestamp` crashes on invalid timestamps

- **Severity:** Moderate
- **Files:** `packages/core/src/otlp-export.ts:165-168`
- **Problem:** `BigInt(NaN)` throws an opaque `TypeError` when `new Date(invalidString).getTime()` returns `NaN`.
- **Fix:** Guard with `isNaN(ms)` check, return `"0"` for invalid timestamps.
- **Tests added:** "invalid timestamp returns '0' instead of throwing"

#### BUG-14: Float values mapped to `intValue` instead of `doubleValue`

- **Severity:** Moderate
- **Files:** `packages/core/src/otlp-export.ts:233-234`
- **Problem:** All numbers used `intValue` in OTel attributes. OTel protobuf-JSON distinguishes `intValue` (integers) from `doubleValue` (floats).
- **Fix:** Added `doubleValue` to `OtlpAttributeValue` interface. Used `Number.isInteger(val)` to choose between `intValue` and `doubleValue`.
- **Tests added:** "float payload values use doubleValue attribute"

#### BUG-15: Merged policy retains `metadata.extends`

- **Severity:** Moderate
- **Files:** `packages/policy/src/inheritance.ts:67`
- **Problem:** `mergePolicy` copied `{ ...child.metadata }`, preserving the `extends` field. If the result were passed to `resolvePolicy` again, it would attempt double-resolution.
- **Fix:** Used destructuring to strip `extends` from merged metadata: `const { extends: _extendsRef, ...metadataWithoutExtends } = child.metadata;`.
- **Tests added:** "mergePolicy strips extends from result metadata"

#### BUG-16: Cycle detection uses `metadata.name` instead of reference string

- **Severity:** Moderate
- **Files:** `packages/policy/src/inheritance.ts:127`
- **Problem:** `visited` set tracked `parent.metadata.name`, but multiple policy files could share the same metadata name. This could produce false cycle detections.
- **Fix:** Track the `extends` reference string (file path) in the visited set instead of the metadata name.
- **Tests added:** Existing circular dependency test confirmed to still pass.

#### BUG-17: Defaults change details omitted when one side has no defaults

- **Severity:** Moderate
- **Files:** `packages/policy/src/diff.ts:249-254`
- **Problem:** Adding `defaults: { unmatched_action: "allow" }` to a policy that had no defaults wouldn't show change details due to an `oldAction !== undefined && newAction !== undefined` guard.
- **Fix:** Populate change details using `"(none)"` sentinel for the missing side.
- **Tests added:** "defaults added from none shows change details"

#### BUG-18: `ci_failure` and `on_violation` changes not detected by diff

- **Severity:** Moderate
- **Files:** `packages/policy/src/diff.ts:212-233`
- **Problem:** `diffSingleRule` compared action, severity, match, and message, but ignored `ci_failure` and `on_violation` fields. Changes to these fields went undetected.
- **Fix:** Added `ciFailureChanged` and `onViolationChanged` to `RuleDiff` and `diffSingleRule`.
- **Tests added:** "ci_failure change detected in rule diff"

#### BUG-19: `convertToOtlp` not wrapped in try/catch in CLI export

- **Severity:** Low
- **Files:** `packages/cli/src/export.ts:58`
- **Problem:** If `convertToOtlp` threw, the error propagated unhandled to the process level.
- **Fix:** Wrapped in try/catch with structured error result.

### Fixed — Pass 2 (Edge Case Hardening)

#### BUG-20: `convertEvent` tool_result endTime bypasses NaN guard

- **Severity:** Bug (crash)
- **Files:** `packages/core/src/otlp-export.ts:180-184`
- **Problem:** `toNanoTimestamp` had the NaN guard from BUG-13, but `convertEvent` at lines 182-184 called `new Date(event.timestamp).getTime()` separately without a guard. For a `tool_result` event with an invalid timestamp, `startMs = NaN`, `endMs = NaN + 500 = NaN`, `BigInt(NaN)` → **throws TypeError**.
- **Fix:** Added `if (!isNaN(startMs))` guard around the endTime computation.
- **Tests added:** "tool_result with invalid timestamp does not crash"

#### BUG-21: Invalid timestamps produce `NaN` duration in `computeTraceStats`

- **Severity:** Moderate
- **Files:** `packages/core/src/trace-stats.ts:103-106`
- **Problem:** `computeTraceStats` computed `durationMs = end - start` without checking for `NaN`. Invalid timestamps produced `durationMs = NaN` instead of `null`. This violated the documented return type contract.
- **Fix:** Added `if (!isNaN(start) && !isNaN(end))` guard around duration computation.
- **Tests added:** "invalid lifecycle timestamps produce null duration_ms"

#### BUG-22: `TraceWriter.open()` double-call leaks file handle

- **Severity:** Moderate
- **Files:** `packages/core/src/trace-writer.ts:38-41`
- **Problem:** Calling `open()` a second time without `close()` silently overwrote `this.fileHandle`, leaking the previous OS file handle.
- **Fix:** Added guard: `if (this.fileHandle !== null) throw new Error("TraceWriter is already open; call close() first")`.
- **Tests added:** "TraceWriter double open without close throws error"

#### BUG-23: `visited.add(parentRef)` after resolver call

- **Severity:** Low
- **Files:** `packages/policy/src/inheritance.ts:133-135`
- **Problem:** `visited.add(parentRef)` happened after `resolver(parentRef)` — an extra recursion level was needed to detect cycles (e.g., self-referencing policies). Moving it before prevents unnecessary resolver calls for cycles.
- **Fix:** Moved `visited.add(parentRef)` before the `resolver()` call.
- **Tests added:** "self-referencing policy detected as circular dependency"

#### BUG-24: CLI stats/policy-test missing try/catch for compute functions

- **Severity:** Low
- **Files:** `packages/cli/src/stats.ts:43`, `packages/cli/src/policy-test.ts:81`
- **Problem:** `computeTraceStats(trace)` and `evaluate(trace, policy)` were called without try/catch. Malformed trace data could cause unhandled runtime errors.
- **Fix:** Wrapped both in try/catch with structured error results.

### Edge Cases Verified (No Fix Needed)

#### EC-23: Streaming validator — failed event does not advance state

- **Severity:** Informational
- **Files:** `packages/core/src/streaming-validator.ts`
- **Observation:** On validation failure, `eventsValidated` is not incremented and `currentHash` is unchanged. This means the failing event can be retried (the correct event can be fed again and it will validate successfully). Events cannot be skipped — feeding event N+1 after a failure at N will fail the sequence_num check.
- **Tests added:** "failed validation does not advance state"

#### EC-24: Resolver error propagates correctly

- **Severity:** Informational
- **Files:** `packages/policy/src/inheritance.ts`
- **Observation:** If the resolver callback throws (e.g., file not found), the error propagates directly to the caller without being swallowed or wrapped. The `visited` set remains consistent because `visited.add(parentRef)` runs before the resolver call (after the fix).
- **Tests added:** "resolver error propagates to caller"

#### EC-25: Defaults removal detected as change

- **Severity:** Informational
- **Files:** `packages/policy/src/diff.ts`
- **Observation:** Removing `defaults: { unmatched_action: "deny" }` from a policy is correctly detected as a change. The `unmatchedActionChanged` field shows `{ old: "deny", new: "(none)" }`. The `"(none)"` sentinel allows change tracking without falsely triggering `hasActionWeakening` (since `ACTION_STRENGTH["(none)"]` is `undefined`, the comparison returns `false`).
- **Tests added:** "defaults removed shows change details with (none) sentinel"

#### EC-26: Identical scope produces no change flags

- **Severity:** Informational
- **Files:** `packages/policy/src/diff.ts`
- **Observation:** When comparing policies with identical scope, `agentsChanged` and `eventTypesChanged` are both `false`, and `oldAgents`/`newAgents`/`oldEventTypes`/`newEventTypes` are undefined (not populated). No false positives.
- **Tests added:** "identical scope produces no scope change flags"

#### EC-27: Shallow clone in streaming validator is safe

- **Severity:** Informational
- **Files:** `packages/core/src/streaming-validator.ts:74`
- **Observation:** `{ ...event, event_hash: "" }` creates a shallow clone — nested objects (like `payload`) are shared by reference. This is safe because `canonicalize()` (called on the clone) only reads properties to produce a JSON string and never mutates the input.

#### EC-28: `NaN`/`Infinity` in OTel `doubleValue` attributes

- **Severity:** Low
- **Files:** `packages/core/src/otlp-export.ts:230-246`
- **Observation:** `typeof NaN === "number"` is true and `Number.isInteger(NaN)` is false, so `NaN` goes to `doubleValue`. `JSON.stringify({ doubleValue: NaN })` produces `{"doubleValue":null}`. Similarly, `Infinity` and `-Infinity` become `null`. This could confuse OTel collectors but is extremely unlikely to occur in practice since payload values come from structured LLM/tool outputs, not raw computation.
- **Deferred:** No fix. The edge case is theoretical and the fix (filtering special numbers) would add complexity for zero practical benefit.

### Deferred (Acceptable)

#### `findSubcommandToken` assumes all flags take values (from Sprint 4)

- **Severity:** Low
- **Files:** `packages/cli/src/router.ts:27-37`
- **Problem:** `findSubcommandToken` skips any token immediately after a `--`-prefixed flag, assuming it's a flag value. Boolean flags (like `--verbose`) don't take values, so the token after them would be wrongly skipped. Currently no impact because `--help` and `--version` are handled before `findSubcommandToken` is called.
- **Rationale for deferral:** Would require maintaining a list of boolean vs. value-taking flags. No current boolean flags reach this code path. Fix when a new boolean flag is added.

#### `on_violation` removal not flagged as action weakening

- **Severity:** Low
- **Files:** `packages/policy/src/diff.ts`
- **Problem:** Removing an `on_violation` handler from a rule is tracked as a change (`onViolationChanged: true`) but not flagged in the top-level `hasActionWeakening`. Whether removal constitutes "weakening" is debatable.
- **Rationale for deferral:** The change is tracked for visibility. Whether to flag it as a regression is a policy decision, not a code bug. Can be revisited based on user feedback.

#### BUG-2 (Sprint 2): Dual session_start events — still deferred

No change from prior reviews. By design for adapter separation.

### Test Coverage Summary

| Test File                                       | Tests Added                 |
| ----------------------------------------------- | --------------------------- |
| `packages/core/src/otlp-export.test.ts`         | 16 (14 original + 2 review) |
| `packages/core/src/streaming-validator.test.ts` | 12 (9 original + 3 review)  |
| `packages/core/src/trace-stats.test.ts`         | +1 (review only)            |
| `packages/policy/src/inheritance.test.ts`       | 15 (11 original + 4 review) |
| `packages/policy/src/diff.test.ts`              | 16 (12 original + 4 review) |
| `test/integration/export-otlp.test.ts`          | 4                           |
| `test/integration/policy-inheritance.test.ts`   | 7                           |

**Total new tests this sprint (including review):** 89 (432 → 521)
**Total test suite:** 521 tests across 45 test files

---

## Documentation Repositioning Audit (2026-02-25)

**Scope:** All public-facing documentation — README, vision, non-goals, architecture, observability, glossary, CLAUDE.md, ADR-001.

**Problem:** `.agents/SYSTEM.md` defines a two-layer product architecture (OSS Engine + Control Plane), but all public documentation positioned Krynix exclusively as "a CLI and library" with no reference to the governance/commercial layer.

### Changes Made

| File                                   | Change                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `docs/00_overview/product_model.md`    | NEW — OSS Engine vs Control Plane, capabilities table, shared non-goals                           |
| `docs/00_overview/business_model.md`   | NEW — ICP, monetization hypotheses, competitive positioning                                       |
| `README.md`                            | Added "Why This Matters" section, two-layer mention in architecture, product/business doc links   |
| `docs/00_overview/vision.md`           | Added "Product Layers" section between Target Users and Success Criteria                          |
| `docs/00_overview/non_goals.md`        | Scoped non-goals to OSS engine via callout, updated monitoring UI section with control plane note |
| `docs/10_architecture/architecture.md` | Added OSS engine context + control plane reference in System Overview                             |
| `docs/20_development/observability.md` | Fixed stale "planned feature" for OTel export — now reflects implemented `krynix export` command  |
| `CLAUDE.md`                            | Added OSS engine / control plane context line                                                     |

### Audit Findings

| #       | Finding                                                     | Resolution                                                  |
| ------- | ----------------------------------------------------------- | ----------------------------------------------------------- |
| P1-P2   | README has no two-layer context                             | Added "Why This Matters", architecture update, doc links    |
| P3-P4   | Vision frames entire product as infrastructure-only         | Added "Product Layers" section                              |
| P5      | Non-goals says "Krynix itself is a CLI and library"         | Scoped to "the Krynix OSS engine", added control plane note |
| P6      | Architecture has no product layer context                   | Added OSS engine / control plane reference                  |
| P7      | CLAUDE.md scoped to repo (correct) but no broader context   | Added one-line context                                      |
| P8      | Observability describes OTel as "planned" — now implemented | Updated to reflect `krynix export` availability             |
| P9, P10 | product_model.md and business_model.md missing              | Created both                                                |

### Non-Goals Verification

All 7 non-goals verified as still holding for both OSS engine and planned control plane:

| Non-Goal                  | OSS Engine | Control Plane                      | Status    |
| ------------------------- | ---------- | ---------------------------------- | --------- |
| Not an agent framework    | Holds      | Holds                              | No change |
| Not LLM inference         | Holds      | Holds                              | No change |
| Not a monitoring UI       | Holds      | Adds visibility, not monitoring UI | Clarified |
| Not a CI replacement      | Holds      | Holds                              | No change |
| Not real-time enforcement | Holds      | Holds                              | No change |
| Not agent orchestration   | Holds      | Holds                              | No change |
| Not secret management     | Holds      | Holds                              | No change |

---

## Control Plane Architecture Design (2026-02-25)

**Scope:** Design the Krynix Control Plane — centralized governance layer operating around OSS engine artifacts.

**Output:** `docs/10_architecture/control_plane_spec.md` — 1100+ line architecture specification.

### Architecture Summary

- **7 services:** Trace Ingest API, Policy Registry, Replay Service (v2), Golden Trace Registry, Compliance Engine, Dashboard API, Auth & RBAC
- **Security model:** API key + JWT auth, 5-role RBAC (org-admin, team-lead, developer, auditor, ci-agent), hash chain verification on ingest, TLS 1.3, AES-256 at rest
- **3 deployment models:** SaaS, self-hosted, hybrid
- **v1 monetization:** Trace storage + search, policy registry, compliance export bundles, basic RBAC
- **Deferred to v2:** Hosted replay, signed attestations, real-time dashboards, webhooks

### Key Architectural Decisions

| Decision                            | Rationale                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| OSS engine remains fully standalone | No OSS command requires network connectivity; Control Plane is purely additive |
| Artifact-centric (not runtime)      | CP operates around .trace.jsonl/.policy.yaml, never inside agent execution     |
| Hash chain verification on ingest   | Rejects tampered traces; reuses existing StreamingHashValidator                |
| PolicyResolver injection            | Existing callback supports remote resolution with zero OSS code changes        |
| Hosted replay deferred              | High infra cost; focus v1 on storage + registry + compliance                   |
| 5-role RBAC                         | Covers ICP: regulated environments needing org-admin, auditor, ci-agent roles  |

### Cross-Reference Updates

| File                                   | Change                                                      |
| -------------------------------------- | ----------------------------------------------------------- |
| `docs/00_overview/product_model.md`    | Added link to control_plane_spec.md                         |
| `docs/10_architecture/architecture.md` | Added control_plane_spec.md reference                       |
| `docs/10_architecture/threat_model.md` | Added "See Also" for T7–T12 threat additions                |
| `CLAUDE.md`                            | Added control_plane_spec.md to authoritative documents list |

### Threat Model Additions

6 new threats documented (T7–T12): credential theft, unauthorized trace access, policy registry poisoning, compliance export forgery, denial of service, data exfiltration via API.

---

## Control Plane Architecture Audit (2026-02-25)

**Scope:** 10-point review and correction of `docs/10_architecture/control_plane_spec.md`.

**Problem:** The initial Control Plane spec over-architected the deployment model (7 independent microservices), had vague/incorrect crypto claims, used 5 RBAC roles where 4 suffice, implied runtime control in some data flows, lacked an explicit boundaries section, and had several technical accuracy issues.

### Changes Applied

| #   | Audit Category                  | Changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Over-Architecture Reduction     | Added deployment model statement at top ("v1 is a modular monolith"). Reframed "Control Plane Services" (Section 7) as "Control Plane Logical Components" (Section 8) with implementation note. Changed component summary from "Location" to "Boundary" column with `(logical)` labels. Replaced "All 7 services" in deployment diagrams with "Modular monolith" / "Single container". Added "Deployment Note" subsection explaining single-process architecture. Updated scaling notes to reference modular monolith context.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2   | Security Model Correction       | Changed "TLS 1.3 required" to "TLS 1.2+ required (prefer TLS 1.3) with modern AEAD cipher suites (AES-128-GCM, AES-256-GCM, ChaCha20-Poly1305)". Replaced "AES-256-GCM for object store" with envelope encryption via KMS (DEK/KEK model, AWS KMS/GCP Cloud KMS/self-managed HSM). Added key rotation model (90-day default, transparent rotation). Replaced "Service-to-service mTLS" auth row with "Service accounts" (API key with restricted permissions). Added API key expiration support, `last_used_at` tracking, staleness detection. Labeled SSO/OIDC as v2, v1 uses email+password. Added `service_account` actor_type to audit log schema.                                                                                                                                                                                                                                                                                                                     |
| 3   | RBAC Simplification             | Reduced from 5 roles (`org-admin`, `team-lead`, `developer`, `auditor`, `ci-agent`) to 4 roles (`org_admin`, `maintainer`, `member`, `auditor`). Extracted `ci-agent` into a separate service account model (not a role). Renamed `team-lead` to `maintainer`, `developer` to `member`. Updated permission matrix to include `service_account` column with restricted permissions. Removed "Manage team membership" from `maintainer`. Updated all role references in SQL data models (org_members.role comment, api_keys.role).                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 4   | Data Flow Tightening            | Added section preamble: "All data flows are explicit, user-initiated, and post-hoc." Added failure behavior documentation for trace push. Added GitOps-compatible workflow description for policy sync. Changed evaluation reporting to clarify CP aggregates, does not evaluate. Removed `--registry <url>` from policy pull CLI (URL comes from config). Removed `auto_push: true` from config example, replaced with comment "All pushes are explicit CLI commands. No automatic uploads."                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | Hosted Replay Positioning       | Replaced "Replay Verification Request" (Section 2.4) with "Replay Report Ingestion (v1) / Hosted Replay (v2)". Defined v1 bridge: CLI pushes locally-produced replay reports, CP validates metadata and stores. Added `krynix push --replay-report <path>` CLI command. Renamed service from "Replay Service" to "Replay Report Ingest (v1) / Replay Service (v2)". Updated data model: removed `status/mode/worker_id/error_message` columns (hosted replay fields), added `source/engine_version/submitted_by/stored_at` columns. Added replay report storage to v1 features table.                                                                                                                                                                                                                                                                                                                                                                                      |
| 6   | Compliance Export Clarification | Created new Section 6 "Compliance Evidence Bundles" with: bundle contents table (8 artifact types with source and inclusion criteria), bundle directory structure, integrity mechanism (SHA-256 manifest with per-artifact digests). Defined full `manifest.json` schema including `integrity_note` and `redaction_notice`. Removed `format: "zip"` from request body (format is always archive). Compliance Engine (Section 8.5) now references Section 6 for bundle specification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Boundary Enforcement            | Added new "Control Plane Boundaries" section (after Invariants, before Section 1). Defines CP as "artifact aggregation and governance layer". Lists 5 things CP does and 6 things CP does NOT do. Added "Offline-first guarantee" paragraph.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 8   | Monetization Alignment          | Removed "Price Signal" and "$0 / Usage-based / Annual contract" columns from pricing table. Removed "SSO/OIDC" from Enterprise tier features (deferred to v2). Added "Replay report storage" to v1 features and Team tier. Added SSO/OIDC to deferred features table. Removed speculative SLA claim ("99.9% uptime") from SaaS characteristics.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 9   | Technical Accuracy Pass         | Changed "Replay Service: Runs deterministic replay in hosted environment" to "Replay Report Ingest: Receives locally-produced replay results (v1)". Removed "estimated_duration_ms" from replay response (v1 is synchronous report ingest). Changed `users.identity_provider` to `users.password_hash` with comment "bcrypt; v2 adds OIDC". Removed "external OIDC provider" from dependencies. Changed `org_members.role` comment from "org-admin, team-lead, developer, auditor" to "org_admin, maintainer, member, auditor". Changed "Terraform module" from self-hosted delivery options (premature). Reduced self-hosted minimum from "4 vCPU, 8 GB RAM" to "2 vCPU, 4 GB RAM". Updated Appendix A: added `--replay-report` command, added `--service-account` to create-key. Updated Appendix C migration path: removed `auto_push: true` step, added replay report push step. Updated T9 mitigation to use "maintainer/org_admin" instead of "team-lead/org-admin". |
| 10  | Section Renumbering             | Original "What Remains Purely OSS" moved from Section 6 to Section 7. New "Compliance Evidence Bundles" is Section 6. "Control Plane Services" renamed to "Control Plane Logical Components" and moved from Section 7 to Section 8. "Deployment Model" moved from Section 8 to Section 9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Summary of Structural Changes

- **Added sections:** Control Plane Boundaries, Compliance Evidence Bundles (Section 6), Deployment Note
- **Renamed sections:** "Control Plane Services" → "Control Plane Logical Components", "Auth & RBAC Service" → "Auth & Access Control", "Replay Service" → "Replay Report Ingest (v1) / Replay Service (v2)"
- **RBAC:** 5 roles → 4 roles + service accounts
- **Crypto:** Vague claims → specific KMS envelope encryption, TLS version range, cipher suites, key rotation
- **Deployment:** 7 microservices → modular monolith with logical boundaries
- **Auth:** SSO/OIDC moved to v2, v1 uses email+password
- **Replay:** Hosted execution deferred, v1 accepts locally-produced reports
- **Line count:** 1107 → 1185 (net +78 lines despite removing speculative content, due to new sections)

---

## Sprint 6 Review (2026-02-26)

**Scope:** All 5 Sprint 6 tasks (TASK-055 through TASK-059) covering compliance evidence bundle generator, CLI compliance export command, Control Plane config/credentials/auth, HTTP client and push commands, and policy pull/push.

**Pre-review state:** 637 tests passing across 54 test files, all checks clean.
**Post-review state:** 642 tests passing across 54 test files, all checks clean. 5 bugs fixed, 1 security issue fixed, 1 determinism violation resolved.

### Files Reviewed

| File                                          | Type     | Task         |
| --------------------------------------------- | -------- | ------------ |
| `packages/core/src/compliance-bundle.ts`      | New      | TASK-055     |
| `packages/core/src/compliance-bundle.test.ts` | New      | TASK-055     |
| `packages/core/src/index.ts`                  | Modified | TASK-055     |
| `packages/cli/src/compliance.ts`              | New      | TASK-056     |
| `packages/cli/src/compliance.test.ts`         | New      | TASK-056     |
| `packages/cli/src/config.ts`                  | New      | TASK-057     |
| `packages/cli/src/config.test.ts`             | New      | TASK-057     |
| `packages/cli/src/credentials.ts`             | New      | TASK-057     |
| `packages/cli/src/credentials.test.ts`        | New      | TASK-057     |
| `packages/cli/src/auth.ts`                    | New      | TASK-057     |
| `packages/cli/src/auth.test.ts`               | New      | TASK-057     |
| `packages/cli/src/http-client.ts`             | New      | TASK-058     |
| `packages/cli/src/http-client.test.ts`        | New      | TASK-058     |
| `packages/cli/src/push.ts`                    | New      | TASK-058     |
| `packages/cli/src/push.test.ts`               | New      | TASK-058     |
| `packages/cli/src/policy-pull.ts`             | New      | TASK-059     |
| `packages/cli/src/policy-pull.test.ts`        | New      | TASK-059     |
| `packages/cli/src/policy-push.ts`             | New      | TASK-059     |
| `packages/cli/src/policy-push.test.ts`        | New      | TASK-059     |
| `packages/cli/src/arg-parser.ts`              | Modified | TASK-056     |
| `packages/cli/src/arg-parser.test.ts`         | Modified | TASK-056     |
| `packages/cli/src/router.ts`                  | Modified | TASK-056–059 |
| `packages/cli/src/router.test.ts`             | Modified | TASK-056–059 |
| `packages/cli/src/help.ts`                    | Modified | TASK-056–059 |
| `packages/cli/src/help.test.ts`               | Modified | TASK-056–059 |
| `packages/cli/src/index.ts`                   | Modified | TASK-056–059 |

### Fixed

#### SEC1: Path traversal via untrusted policy name in `policy-pull.ts`

- **Severity:** Medium (Security)
- **Files:** `packages/cli/src/policy-pull.ts:132-133`
- **Problem:** The `policy.name` and `policy.version` values come from the Control Plane server response (untrusted data). A malicious or compromised server could return `name: "../../etc/evil"` which would resolve to a path outside `outputDir` via `path.join`.
- **Fix:** Added `resolve(filePath).startsWith(resolve(outputDir))` guard after fileName construction. Policies failing this check are skipped (counted in `policies_skipped`).

#### B1: YAML config parser truncated values containing `#` in quoted strings

- **Severity:** Medium
- **Files:** `packages/cli/src/config.ts:103-112`
- **Problem:** Inline-comment stripping ran before quote stripping. A URL like `url: "https://example.com/path#fragment"` would be truncated at `#`.
- **Fix:** Reordered: strip quotes first; strip inline comments only for unquoted values.
- **Tests added:** "preserves # inside quoted values" in `config.test.ts`.

#### SEC2: Empty Authorization header sent when no credentials configured

- **Severity:** Low (Security)
- **Files:** `packages/cli/src/http-client.ts:72-76`
- **Problem:** When neither token nor API key is set, `Authorization: ""` header was sent. While not exploitable, it could confuse server-side logging or middleware.
- **Fix:** Omit the `Authorization` header entirely when value is empty using conditional spread.

#### B4: `auth status` reported `authenticated: true` for expired tokens

- **Severity:** Low
- **Files:** `packages/cli/src/auth.ts:83-88`
- **Problem:** A token with an `expires_at` in the past still resulted in `authenticated: true`. The `token_expired` field was reported separately, but `authenticated` was misleading.
- **Fix:** Factored token expiry into the `authenticated` computation: `authenticated: hasCredentials && tokenExpired !== true`.
- **Tests added:** "reports expired token as not authenticated" now verifies `authenticated: false`.

#### TS-FIX: `compliance-bundle.ts` imported `ValidationResult` from wrong module

- **Severity:** Build error
- **Files:** `packages/core/src/compliance-bundle.ts:20`
- **Problem:** Imported `type ValidationResult` from `./hash-chain.js` where it's used locally but not exported. The type is exported from `./types.js`.
- **Fix:** Moved the import to `./types.js`.

### Test Gaps Filled

| Gap                                                                      | File                  | Tests Added                                |
| ------------------------------------------------------------------------ | --------------------- | ------------------------------------------ |
| T1: No direct test for `pushTrace` with real file I/O and SHA-256 digest | `http-client.test.ts` | 2 (digest verification, non-existent file) |
| T2: No test for `#` inside quoted YAML config values                     | `config.test.ts`      | 1                                          |
| Missing `getAllArgs` unit tests                                          | `arg-parser.test.ts`  | 5                                          |

### Spec Drift (Documented, Deferred)

| #   | Drift                                                                             | Rationale for deferral                                              |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| S1  | Trace upload uses `application/octet-stream` vs spec's `multipart/form-data`      | Simpler for v1; align when CP server is implemented                 |
| S2  | CLI uses `--trace <file>` (file paths) vs spec's `--trace-ids <id>` (session IDs) | Local-first operation requires file paths; server-side will use IDs |
| S3  | Policy pull missing `?since=` incremental sync parameter                          | Not needed until multi-version registry is built                    |
| S4  | Local bundle missing `policies/` and `audit/` directories                         | These artifacts come from CP, not local files                       |
| S6  | `auth login` and `auth create-key` not yet implemented                            | Deferred to Sprint 7 when CP server is available                    |

### Contract Verification (Second Audit Pass)

Full audit against determinism_spec.md, trace_spec.md, policy_spec.md, control_plane_spec.md, architecture.md.

| Contract                                                       | Source                     | Status                                                              |
| -------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| C1-1: Trace events must include SHA-256 hash chain             | trace_spec.md              | PASS — `validateHashChain` used in bundle generation                |
| C1-2: Events serialized in canonical JSON                      | trace_spec.md              | PASS — `computeHashChain` uses `canonicalize()`                     |
| C2-1: Policy evaluation via `evaluate(trace, policy)`          | policy_spec.md             | PASS — used in cli/policy-test.ts                                   |
| C3-1: SHA-256 manifest with per-artifact digests               | control_plane_spec.md §6   | PASS — `sha256:` prefix in manifest                                 |
| C3-2: Bundle directory structure matches spec                  | control_plane_spec.md §6   | PASS (local subset: traces/, evaluations/, replays/, stats/, otlp/) |
| C4-1: Core functions deterministic for same input              | determinism_spec.md        | **FIXED** — `export_id`/`generated_at` now injectable               |
| C5-1: Offline-first guarantee                                  | control_plane_spec.md      | PASS — all local commands work without CP config                    |
| C5-2: CLI structured output (JSON to stdout, errors to stderr) | architecture.md            | PASS — all commands return `{ exitCode, output/results, error }`    |
| C6-1: Bundle `policies/` and `audit/` directories              | control_plane_spec.md §6   | WARN — deferred (S4), CP-only resources                             |
| C7-1: Trace upload Content-Type                                | control_plane_spec.md §2.1 | WARN — deferred (S1), simpler for v1                                |
| C8-1: Credentials stored with mode 0600                        | security_practices.md      | PASS — verified by unit test                                        |
| C8-2: No secrets in structured output                          | security_practices.md      | PASS — auth status redacts token values                             |
| C8-3: Path traversal prevention on untrusted input             | security_practices.md      | PASS — SEC1 fix in policy-pull.ts                                   |

### Architecture Observations

#### Dependency injection consistency

All CP-related commands (`auth`, `push`, `policy-pull`, `policy-push`) use a `Deps` interface for injectable dependencies, enabling testing with mock HTTP clients. The `compliance` command (local-only, no HTTP) does not use DI — acceptable since it only performs local file I/O.

#### No circular dependencies

Verified: `@krynix/core` has zero imports from CLI or policy. CLI imports from core and policy in the correct direction. `policy-push.ts` uses a dynamic import of `@krynix/policy` (lazy loading).

#### Credential security

`credentials.ts` writes with `mode: 0o600`, verified by unit test. Config parsing handles untrusted input safely after the B1 fix.

### Deferred (Acceptable)

#### B2: `findSubcommandToken` assumes all flags take values (Sprint 4)

No change from Sprint 5 review. No boolean flags currently reach this code path.

#### B3: `generateComplianceBundle` uses `Date.now()` and `Math.random()` — RESOLVED

Violated the determinism contract (determinism_spec.md C4-1): core module functions must produce identical output for identical input. Fixed by making `export_id` and `generated_at` injectable via `ComplianceBundleOptions`. When both are supplied, output is fully deterministic. The JSDoc was updated to remove the incorrect "Pure function" claim. Two tests added: deterministic output verification and default fallback behavior verification.

#### A1: `compliance.ts` does not use dependency injection

Acceptable for local-only commands. Consider adding DI if testing becomes difficult.

#### A2: Inconsistent result type field names (`output` vs `result`)

Some commands use `output`, others use `result` for their success payload. Standardize in a future refactoring pass.

#### A3: Duplicated `isNodeError` helper in `config.ts` and `credentials.ts`

Extract to shared utility when a third consumer appears.

#### BUG-2 (Sprint 2): Dual session_start events — still deferred

No change. By design for adapter separation.

### Test Coverage Summary

| Test File                                     | Tests Added                         |
| --------------------------------------------- | ----------------------------------- |
| `packages/core/src/compliance-bundle.test.ts` | 15 (13 original + 2 review)         |
| `packages/cli/src/compliance.test.ts`         | 7                                   |
| `packages/cli/src/config.test.ts`             | 12 (11 original + 1 review)         |
| `packages/cli/src/credentials.test.ts`        | 12                                  |
| `packages/cli/src/auth.test.ts`               | 8                                   |
| `packages/cli/src/http-client.test.ts`        | 13 (11 original + 2 review)         |
| `packages/cli/src/push.test.ts`               | 10                                  |
| `packages/cli/src/policy-pull.test.ts`        | 10                                  |
| `packages/cli/src/policy-push.test.ts`        | 8                                   |
| `packages/cli/src/arg-parser.test.ts`         | +5 (getAllArgs tests)               |
| `packages/cli/src/router.test.ts`             | +12 (compliance, auth, push routes) |
| `packages/cli/src/help.test.ts`               | +10 (new command help)              |

**Total new tests this sprint (including review):** 121 (521 → 642)
**Total test suite:** 642 tests across 54 test files

---

## Sprint 7 Review (2026-02-27)

**Scope:** All 4 Sprint 7 tasks (TASK-060 through TASK-063) covering trace event filtering, HTTP policy resolver, auth login/create-key, and evaluation pipeline.

**Pre-review state:** 658 tests passing across 54 test files, all checks clean (642 after Sprint 6 review + 16 from post-review hardening commits).
**Post-review state:** 751 tests passing across 57 test files, all checks clean. 1 pre-existing bug fixed, 4 bugs found and fixed, 1 security issue fixed, 3 spec drifts resolved.

### Files Reviewed

| File                                            | Type     | Task                   |
| ----------------------------------------------- | -------- | ---------------------- |
| `packages/core/src/trace-filter.ts`             | New      | TASK-060               |
| `packages/core/src/trace-filter.test.ts`        | New      | TASK-060               |
| `packages/core/src/index.ts`                    | Modified | TASK-060, TASK-063     |
| `packages/cli/src/evaluate.ts`                  | Modified | TASK-060               |
| `packages/cli/src/evaluate.test.ts`             | Modified | TASK-060               |
| `packages/cli/src/stats.ts`                     | Modified | TASK-060               |
| `packages/cli/src/stats.test.ts`                | Modified | TASK-060               |
| `packages/cli/src/export.ts`                    | Modified | TASK-060               |
| `packages/cli/src/export.test.ts`               | Modified | TASK-060               |
| `packages/cli/src/help.ts`                      | Modified | TASK-060, TASK-062     |
| `packages/cli/src/help.test.ts`                 | Modified | TASK-060, TASK-062     |
| `packages/policy/src/http-resolver.ts`          | New      | TASK-061               |
| `packages/policy/src/http-resolver.test.ts`     | New      | TASK-061               |
| `packages/policy/src/index.ts`                  | Modified | TASK-061               |
| `packages/cli/src/auth.ts`                      | Modified | TASK-062               |
| `packages/cli/src/auth.test.ts`                 | Modified | TASK-062               |
| `packages/cli/src/router.ts`                    | Modified | TASK-062               |
| `packages/cli/src/router.test.ts`               | Modified | TASK-062               |
| `packages/cli/src/index.ts`                     | Modified | TASK-062               |
| `packages/core/src/evaluation-pipeline.ts`      | New      | TASK-063               |
| `packages/core/src/evaluation-pipeline.test.ts` | New      | TASK-063               |
| `packages/cli/src/validate.ts`                  | Modified | Bug fix (pre-existing) |

### Fixed

#### TS-FIX: `validate.ts` cross-project `instanceof` narrowing failure

- **Severity:** Build error (pre-existing)
- **Files:** `packages/cli/src/validate.ts:75-82`
- **Problem:** The catch block used `instanceof PolicyValidationError` to narrow the error type, but TypeScript `tsc -b` project references can fail to narrow `unknown` with `instanceof` for classes from referenced projects. This caused `TS18046: 'err' is of type 'unknown'` on the else branch. The bug was present before Sprint 7 changes (confirmed via `git stash` test).
- **Fix:** Simplified to `err instanceof Error ? err.message : String(err)`, removed the `PolicyValidationError` import entirely. This provides identical behavior since `PolicyValidationError` extends `Error`.

#### BUG-25: Invalid event timestamps bypass time filter (NaN comparison)

- **Severity:** Medium
- **Files:** `packages/core/src/trace-filter.ts:87-91`
- **Problem:** When time-based filtering was active (`after` or `before`), events with unparseable timestamps (producing `NaN` from `new Date(event.timestamp).getTime()`) silently passed both filter comparisons. This is because `NaN < number` and `NaN > number` both evaluate to `false` in JavaScript, so the event was never excluded. Malformed events would appear in the filtered results when they should have been excluded.
- **Fix:** Added `if (isNaN(ts)) return false;` guard before the time comparisons. Events with invalid timestamps are now excluded when time filtering is active, but included when only non-time filters are used (maintaining backward compatibility).
- **Tests added:** 2 — "excludes events with invalid timestamps when time filter is active", "includes events with invalid timestamps when no time filter is active"

#### SEC3: Credential values leaked in CLI error output

- **Severity:** Medium (Security)
- **Files:** `packages/cli/src/router.ts:70-76, 341-348`
- **Problem:** Two code paths echoed raw argv contents in error messages:
  1. "Unknown arguments" branch (line 74): `argv.join(" ")` included raw flag values
  2. "Unknown command" default case (line 346): `parseCommand` extracts a flag value as the "command" (e.g., `["--password", "secret"]` → `command = "secret"`)
     Both paths would expose `--password`, `--email`, `--token`, or `--api-key` values in stderr output, which could be captured by CI logs or shell history.
- **Fix:** Introduced `redactFlagValues(argv)` helper that replaces values following sensitive flags with `"[REDACTED]"`, and `isSensitiveFlagValue(argv, value)` helper that checks whether a value appears after a sensitive flag. Both error paths now use these helpers. The set of sensitive flags is: `--password`, `--email`, `--token`, `--api-key`.
- **Tests added:** 2 — "unknown arguments redact sensitive flag values in error output", "unknown arguments preserve non-sensitive flag values in error output"

#### BUG-26: `response.json()` unhandled on HTTP resolver success path

- **Severity:** Low
- **Files:** `packages/policy/src/http-resolver.ts:74`
- **Problem:** The `fetch()` call was properly wrapped in try-catch, but `response.json()` on the success path (HTTP 200) was not. If the server returned a 200 response with a non-JSON body (e.g., HTML error page behind a proxy), `response.json()` would throw an uncaught `SyntaxError` that propagated to the caller with an opaque "Unexpected token" message.
- **Fix:** Wrapped `response.json()` in try-catch. On parse failure, throws `Error("Failed to parse JSON response for policy \"${ref}\"")` with a clear, policy-specific error message.
- **Tests added:** 1 — "throws on malformed JSON response body"

#### BUG-27: `response.json()` inconsistent error handling in auth commands

- **Severity:** Low
- **Files:** `packages/cli/src/auth.ts:234, 331`
- **Problem:** Both `runAuthLogin` and `runAuthCreateKey` correctly used `.catch()` on `response.json()` for HTTP error responses (lines 226, 323), but did NOT use `.catch()` on the success path (lines 234, 331). If the server returned a 200 response with non-JSON body, an unhandled `SyntaxError` would propagate.
- **Fix:** Applied `.catch(() => null)` to `response.json()` on success paths for both commands. Added null check afterward that returns a structured error: `"Login failed: invalid JSON response"` / `"Create key failed: invalid JSON response"`.
- **Tests added:** 2 — "returns error on malformed JSON in success response" for both login and create-key

### Spec Drift Fixed

#### SD-1: Auth login endpoint path mismatch

- **Files:** `packages/cli/src/auth.ts:219`
- **Drift:** Implementation used `POST /api/v1/auth/login`; spec (`control_plane_spec.md` line 967) defines `POST /api/v1/auth/token`.
- **Fix:** Changed endpoint to `/api/v1/auth/token`. Updated JSDoc comment.
- **Tests updated:** 2 — endpoint URL assertion in test updated

#### SD-2: Auth create-key endpoint path mismatch

- **Files:** `packages/cli/src/auth.ts:313`
- **Drift:** Implementation used `POST /api/v1/auth/keys`; spec (`control_plane_spec.md` line 968) defines `POST /api/v1/auth/api-keys`.
- **Fix:** Changed endpoint to `/api/v1/auth/api-keys`. Updated JSDoc comment.
- **Tests updated:** 2 — endpoint URL assertion in test updated

#### SD-3: HTTP policy resolver endpoint path mismatch

- **Files:** `packages/policy/src/http-resolver.ts:51`
- **Drift:** Implementation used `GET /api/v1/policies/{name}/{version}`; spec (`control_plane_spec.md` line 714) defines `GET /api/v1/policies/:name/versions/:version`.
- **Fix:** Changed URL to include `/versions/` segment. Updated JSDoc comment.
- **Tests updated:** 3 — all endpoint URL assertions in tests updated

### Spec Drift (Remaining, Deferred)

| #   | Drift                                                                                                        | Status                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| S1  | Trace upload uses `application/octet-stream` vs spec's `multipart/form-data`                                 | DEFERRED — simpler for v1; align when CP server is implemented                                         |
| S2  | CLI uses `--trace <file>` (file paths) vs spec's `--trace-ids <id>` (session IDs)                            | DEFERRED — local-first operation requires file paths; server-side will use IDs                         |
| S3  | Policy pull missing `?since=` incremental sync parameter                                                     | DEFERRED — not needed until multi-version registry is built                                            |
| S4  | Local bundle missing `policies/` and `audit/` directories                                                    | DEFERRED — these artifacts come from CP, not local files                                               |
| S6  | `auth login` and `auth create-key` not yet implemented                                                       | **RESOLVED** — TASK-062 implements both commands with full DI, env var support, and credential merging |
| S7  | Create-key flags: spec has `--service-account`, `--description`, `--expires-in`; implementation has `--name` | DEFERRED — additional flags when CP server requires them                                               |
| S8  | Create-key response: spec returns `{ key_id, key, role }`; implementation expects `{ api_key }`              | DEFERRED — align response schema when CP server is implemented                                         |

### Contract Verification

| Contract                                                       | Source                   | Status                                                                                     |
| -------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| C1-1: Trace events must include SHA-256 hash chain             | trace_spec.md            | PASS — `validateHashChain` used in evaluation pipeline                                     |
| C1-2: Events serialized in canonical JSON                      | trace_spec.md            | PASS — `computeHashChain` uses `canonicalize()`                                            |
| C2-1: Policy evaluation via `evaluate(trace, policy)`          | policy_spec.md           | PASS — pipeline uses `deps.evaluatePolicy(events, policy)`                                 |
| C3-1: SHA-256 manifest with per-artifact digests               | control_plane_spec.md §6 | PASS — compliance bundle manifest unchanged                                                |
| C4-1: Core functions deterministic for same input              | determinism_spec.md      | PASS — `filterTraceEvents` is pure, pipeline delegates to pure functions                   |
| C5-1: Offline-first guarantee                                  | control_plane_spec.md    | PASS — filter, pipeline, and validate work fully offline                                   |
| C5-2: CLI structured output (JSON to stdout, errors to stderr) | architecture.md          | PASS — all new commands return `{ exitCode, output, error }`                               |
| C8-1: Credentials stored with mode 0600                        | security_practices.md    | PASS — unchanged from Sprint 6                                                             |
| C8-2: No secrets in structured output                          | security_practices.md    | PASS — `auth create-key` returns `api_key_preview` (truncated, e.g., `"krynix-k..."`)      |
| C8-3: Path traversal prevention on untrusted input             | security_practices.md    | PASS — HTTP resolver uses `encodeURIComponent` for name/version                            |
| C8-4: No secrets in error output                               | security_practices.md    | **FIXED** — SEC3: argv redaction added for `--password`, `--email`, `--token`, `--api-key` |
| C9-1: API endpoint paths match control_plane_spec.md           | control_plane_spec.md    | **FIXED** — SD-1/SD-2/SD-3: all three endpoint paths now match spec                        |

### Architecture Observations

#### Dependency inversion in evaluation pipeline

The evaluation pipeline (`evaluation-pipeline.ts`) correctly maintains the dependency inversion principle: `@krynix/core` does not import from `@krynix/policy` or `@krynix/replay`. Policy evaluation and replay verification are injected as callbacks via `EvaluationPipelineDeps`. This ensures core remains a leaf dependency.

#### Consistent DI pattern for auth commands

Both `runAuthLogin` and `runAuthCreateKey` follow the established `Partial<XDeps>` dependency injection pattern used by all Sprint 6 CP commands (`auth status`, `auth logout`, `push`, `policy pull/push`). Default implementations use real modules; tests inject mocks.

#### HTTP resolver uses lastIndexOf for scoped names

`parseRef()` in `http-resolver.ts` correctly uses `lastIndexOf("@")` to handle scoped policy names like `@scope/name@1.0.0`, where `indexOf("@")` would incorrectly split at the first `@`.

#### Credential merging strategy

Both login and create-key commands merge new credentials with existing ones: login preserves `api_key`, create-key preserves `token` and `expires_at`. This enables users to have both authentication methods active simultaneously.

#### Public API boundaries verified

All three modified packages maintain clean API surfaces via barrel re-exports in `index.ts`. Dependency direction is correct: core → (no deps), policy → (no deps), cli → core + policy. No implementation details leak through any boundary.

### Deferred (Acceptable)

#### B2: `findSubcommandToken` assumes all flags take values (Sprint 4)

No change from Sprint 6 review. No boolean flags currently reach this code path.

#### A2: Inconsistent result type field names (`output` vs `result`)

No change from Sprint 6 review. Both patterns still coexist.

#### A3: Duplicated `isNodeError` helper in `config.ts` and `credentials.ts`

No third consumer appeared. Deferred.

#### BUG-2 (Sprint 2): Dual session_start events — still deferred

No change. By design for adapter separation.

### Test Coverage Summary

| Test File                                       | Tests                                     |
| ----------------------------------------------- | ----------------------------------------- |
| `packages/core/src/trace-filter.test.ts`        | 21 (19 original + 2 review)               |
| `packages/core/src/evaluation-pipeline.test.ts` | 18 (new)                                  |
| `packages/policy/src/http-resolver.test.ts`     | 17 (16 original + 1 review)               |
| `packages/cli/src/auth.test.ts`                 | 36 (12 Sprint 6 + 22 Sprint 7 + 2 review) |
| `packages/cli/src/evaluate.test.ts`             | +1 (filter test)                          |
| `packages/cli/src/stats.test.ts`                | +1 (filter test)                          |
| `packages/cli/src/export.test.ts`               | +1 (filter test)                          |
| `packages/cli/src/router.test.ts`               | +6 (login/create-key routes + 2 review)   |
| `packages/cli/src/help.test.ts`                 | +3 (new command help)                     |

**Total new tests this sprint (including review):** 93 (658 → 751)
**Total test suite:** 751 tests across 57 test files
