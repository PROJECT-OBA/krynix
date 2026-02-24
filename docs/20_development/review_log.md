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
