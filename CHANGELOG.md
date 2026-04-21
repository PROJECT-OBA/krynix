# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
