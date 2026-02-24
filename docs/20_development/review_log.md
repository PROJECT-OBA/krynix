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
