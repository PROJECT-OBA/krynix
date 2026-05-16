# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (`@krynix/core`)
- `SCHEMA_VERSION` bumped 1.0.0 → 1.1.0 for the runtime-pivot. Backward-compatible at the wire level (every addition is optional).
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
