# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.3] - 2026-05-25

SDK-only release. The six non-SDK packages (`@krynix/core`, `@krynix/policy`, `@krynix/replay`, `@krynix/cli`, `@krynix/adapter-langchain`, `@krynix/adapter-openclaw`) remain at `0.2.2` on npm — `pnpm -r publish` will skip them. Only `@krynix/sdk` bumps to `0.1.0-alpha.2` and publishes under the `@alpha` tag.

### Changed (`@krynix/sdk` — `0.1.0-alpha.1` → `0.1.0-alpha.2`)

Closes a customer-trust-blocking silent-failure mode in the redaction pipeline (krynix#56) and introduces the OSS approval-handler callback so `require-approval` verdicts have a usable resolution path without a hosted ingest server. See `packages/sdk/CHANGELOG.md` for the per-package detail; headlines:

- **Fixed:** `applyRedactions` now accepts JSONPath bracket-index syntax (`messages[0].content`, `tags[0]`). Pre-alpha.2 the bracket-index form silently no-op'd, downgrading the verdict to `pass` with no warning. `runPipeline` now also surfaces a structured `PipelineWarning` (`redaction_mode_off` / `no_directives` / `path_or_pattern_no_match`) on any redact-rule no-op, regardless of cause.
- **Added:** `approvalHandler` option on `KrynixOptions` for OSS-pathway resolution of `require-approval` verdicts in offline mode. Three built-in handlers ship: `denyAllApprovalHandler`, `cliPromptApprovalHandler`, `webhookApprovalHandler`. New `resolveApproval()` helper routes between hosted `ApprovalPoller` and local handler with poller-wins precedence and throws `ApprovalUnavailable` when neither is configured. New typed errors / types: `ApprovalUnavailable`, `ApprovalHandler`, `ApprovalHandlerEvent`, `ApprovalDecision`, `ResolvedApproval`, `PipelineWarning`.

### Changed (this repo, root tag)

- Root `package.json` version bumped to `0.2.3` to track the release event. Does not correspond to a per-package version bump for the six pinned packages.

## [0.2.2] - 2026-05-18

Schema 1.1.0 + new runtime-policy primitives. Adds the `@krynix/sdk` package as `0.1.0-alpha.1` under the `@alpha` npm tag. The `@krynix/core`, `@krynix/policy`, `@krynix/replay`, `@krynix/cli`, `@krynix/adapter-langchain`, and `@krynix/adapter-openclaw` packages all bump to `0.2.2` to carry the schema additions + matching exports. Backward-compatible at the wire level; soft-breaking only for downstream TypeScript consumers doing exhaustive `switch` on the verdict / action unions.

### Added (`@krynix/sdk` — new package, `0.1.0-alpha.1`)
- Brand new package: runtime policy enforcement for AI agents. Ships under the `@alpha` npm tag.
- `Krynix` class with adapter registry + `wrap(client)` dispatch + offline mode.
- Verdict pipeline (`runPipeline`) — pure function evaluating one in-flight `TraceEvent` against a `Policy`, producing a discriminated `PipelineOutcome` (`forward` / `deny` / `require-approval`) that adapters act on.
- Async event buffer (`EventBuffer`) with batched flush, exponential-backoff retry (default max 3 retries, 200 ms → 5 s), and best-effort drain on `beforeExit`. Never blocks the caller's response path.
- Approval poller (`ApprovalPoller`) — soft-block (default 30 s) with `on_timeout` fallback, hard-block opt-in. Handles `approved` / `denied` / `expired` / synchronous resolution at submit.
- Ingest HTTP client (`IngestClient`) — strips hash-chain fields before send (the server computes them), exposes `submitEvents`, `submitApproval`, `getApproval` (the SDK-side surface; the `resolve` endpoint is intentionally outside the SDK and is consumed by Krynix's approval-review tooling instead of agent code), per-request timeout, no deps beyond global `fetch`.
- Rule-driven redaction (`applyRedactions`) — deep-clones the request body, supports `path`, `pattern` (ECMAScript regex with `u` flag), `replacement` (default `<REDACTED>`, empty string allowed), and `[*]` array spread. Records the **replacement** string in `value_redacted`, never the original.
- Errors: `KrynixSdkError` (base), `PolicyDenied`, `ApprovalTimeout`, `ApprovalDenied` — all distinct from `@krynix/core`'s `KrynixError` so callers can catch policy vs infrastructure failures separately.
- Comprehensive unit-test coverage: all four verdicts, batch + retry behaviour, all three approval-poller outcomes (sync, async, soft-timeout), and the full path-traversal redaction grammar (nested fields, array spread, regex with `g` and `u` flags, audit-trail integrity).
- Adapters NOT shipped here — OpenAI / Anthropic / LangChain adapters land in follow-up alphas.
- Presidio-based PII detection deferred to v0.2; `redaction: { mode: "presidio" }` throws explicitly at construction time.

### Added (`@krynix/core`)
- `SCHEMA_VERSION` bumped 1.0.0 → 1.1.0 to carry the new `policy_decision` sub-shape. Backward-compatible at the wire level (every addition is optional).
- New optional `policy_decision` sub-shape on `DecisionPayload`. Carried on `decision` events emitted by `@krynix/sdk`'s runtime policy pipeline. Fields: `verdict` (`pass` / `fail` / `redact` / `require-approval`), optional `rule_id`, optional `redactions[]`, required `latency_ms`. Absent on agent-internal decision events.
- New exported types: `PolicyDecisionSubtype`, `PolicyDecisionRedaction`, `PolicyDecisionVerdict`.
- JSON schema (`packages/core/schemas/trace.schema.json`) regenerated to validate the new sub-shape (8 new schema-validator tests cover happy + reject paths).

### Added (`@krynix/policy`)
- New public API `matchSingleEvent(event, policy): SingleEventResult` for runtime decision evaluation against a single in-flight TraceEvent. Designed for `@krynix/sdk`'s decision pipeline; complements the existing trace-eval `evaluate(trace, policy)` which stays the CLI / compliance path.
- New `"redact"` value in `PolicyAction` and `PolicyVerdict` unions. Matching `redact` rules carry a required `redactions[]` directive list applied by the runtime SDK before forwarding the upstream LLM / tool call. At trace-evaluation time `redact` is advisory (no violation produced).
- New `Redaction` type (`{ path, pattern?, replacement? }`) for the directives. Pattern is validated as an ECMAScript RegExp at parse time per ADR-0002.
- New optional `on_timeout: "allow" | "deny"` field on `PolicyRule` — fallback action when a `require-approval` rule's human queue times out at runtime. Ignored by the trace-evaluator.
- New `VALID_ON_TIMEOUT` constant exported from `@krynix/policy`.

### Changed (`@krynix/policy`)
- `PolicyAction` union extended with `"redact"`. Soft-breaking for consumers doing exhaustive `switch` on action / verdict; wire format remains forward-compatible.
- Parser now requires a non-empty `redactions[]` array when `action === "redact"`; rejects invalid regex patterns at parse time.

## [0.2.1] - 2026-04-26

### Fixed
- Restore `pnpm publish` in the release workflow so that `workspace:*` references in `@krynix/cli`, `@krynix/policy`, `@krynix/replay`, and the adapters are rewritten to the actual published versions. `0.2.0` was published with raw `workspace:*` strings via `npm publish` and is uninstallable; it has been deprecated on npm.

## [0.2.0] - 2026-04-25

First public npm release. All `@krynix/*` packages published to the public registry with build provenance.

### Added
- Tag-triggered npm publish workflow with [npm provenance](https://docs.npmjs.com/generating-provenance-statements) (Sigstore attestations via GitHub OIDC)
- Renovate config for automated dependency updates
- `NOTICE` file at repo root (Apache-2.0 attribution)
- Release ritual documented in `CONTRIBUTING.md`

### Changed
- All `@krynix/*` packages bumped to `0.2.0`
- License standardized to Apache-2.0 across the workspace

## [0.1.1] - 2026-04-14

### Added
- Ed25519 signing and chain validation gate for tamper-evidence (`krynix sign`, `krynix keygen`, `evaluate --public-key`)
- Structured `PolicyWarning` in evaluation reports
- Real-framework e2e tests for LangChain adapter
- JSON Schema exports for cross-language validation (`@krynix/core`)
- CLI `diff` command for behavioral drift comparison

### Fixed
- Strict signature hex validation and empty-trace refusal
- Sign raw digest bytes; distinct error code for uncomputed hash chain
- LangChain callback signatures and tool-name resolution
- Silent-failure doors in validation and evaluation
- Shadowed-rule false positive in policy evaluation
- `exists` operator boolean guard and `padStart` collision fix
- Array payload rejection in `validatePayload`

### Changed
- Merged dual rule-evaluation loops into single pass (performance)
- Skip `matchRule` for already-matched rules (performance)

## [0.1.0] - 2026-03-15

### Added
- Core trace engine: SHA-256 hash chain with canonical JSON
- Policy engine: YAML policies with 7 operators (eq, neq, in, not_in, matches, contains, exists)
- Replay engine: integrity verification, drift comparison, golden trace validation
- CLI: evaluate, replay, validate, stats, export, policy test/diff/pull/push
- LangChain adapter: auto-capture via `createLangChainTracer()`
- OpenClaw adapter: auto-capture via `createKrynixPlugin()`
- Session management API for custom TypeScript agents
- Compliance evidence bundle generation and verification
- OpenTelemetry export format
- Redaction engine for sensitive field patterns
- Deterministic seeded PRNG for replay operations
