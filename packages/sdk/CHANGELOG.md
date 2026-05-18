# Changelog — `@krynix/sdk`

## [0.1.0-alpha.1] - 2026-05-18

First release. Package skeleton for runtime policy enforcement against AI agents. Published under the `@alpha` npm tag.

### Added

- `Krynix` class + adapter registry (`registerAdapter` / `listAdapters` / `wrap` / `close`).
- Verdict pipeline (`runPipeline`) — pure function evaluating one in-flight TraceEvent against a `Policy` from `@krynix/policy`. Returns a discriminated `PipelineOutcome` (`forward` / `deny` / `require-approval`) that adapters act on.
- Async event buffer (`EventBuffer`) with batched flush + exponential-backoff retry. Drains on `beforeExit`. Never blocks the caller's response path.
- Approval poller (`ApprovalPoller`) supporting soft-block (default, 30 s timeout → policy's `on_timeout`) and hard-block modes.
- Ingest HTTP client (`IngestClient`) — three methods: `submitEvents` (POST `/v1/sessions/:id/events`), `submitApproval` (POST `/v1/sessions/:id/approvals`), `getApproval` (GET `/v1/sessions/:id/approvals/:approval_id`). The `resolve` endpoint is intentionally outside the SDK surface — it is consumed by Krynix's approval-review tooling rather than by agent code.
- Rule-driven redaction (`applyRedactions`) — deep-clones the request body, applies the matched rule's `redactions[]` directives, records what was scrubbed for the audit trail. Records the **replacement** string in `value_redacted`, never the original.
- Errors: `KrynixSdkError` (base), `PolicyDenied`, `ApprovalTimeout`, `ApprovalDenied`.
- Offline mode — omit `ingest.url` and the verdict pipeline still works without an ingest connection.

### Not yet implemented (deferred)

- OpenAI adapter — follow-up alpha.
- Anthropic adapter — follow-up alpha.
- LangChain `Runnable` adapter — follow-up alpha.
- Presidio-based PII detection — v0.2. Construction with `redaction: { mode: "presidio" }` throws explicitly to fail fast.

### Depends on

- `@krynix/core` — the release that pairs with this SDK alpha carries trace schema 1.1.0 (adds the `policy_decision` subtype + `redact` verdict).
- `@krynix/policy` — same release window; adds `matchSingleEvent` + `redact` verdict + `redactions` + `on_timeout` rule fields.
