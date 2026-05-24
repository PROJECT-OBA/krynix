# Changelog — `@krynix/sdk`

## [0.1.0-alpha.2] - 2026-05-23

Closes a customer-trust-blocking silent-failure mode in the redaction pipeline (filed as [krynix#56](https://github.com/PROJECT-OBA/krynix/issues/56)) **and** introduces the OSS approval-handler callback so `require-approval` verdicts have a usable resolution path without a hosted ingest server. Continues to ship under the `@alpha` npm tag.

### Fixed

- **`applyRedactions` now accepts JSONPath bracket-index syntax** — `messages[0].content`, `messages[1].content`, `tags[0]` all resolve correctly. Previously only the wildcard form (`messages[*].content`) and the dot-numeric form (`messages.0.content`) worked; the bracket-index form silently no-op'd, and the verdict downgraded to `pass` with no warning. The bracket-index form is what the JSONPath spec uses and what users naturally reach for.
- **`runPipeline` now surfaces `redaction_no_op` warnings on the `forward` outcome** when a `redact` rule matched but applied zero redactions. Three reasons are distinguished: `redaction_mode_off`, `no_directives`, and `path_or_pattern_no_match`. Adapters SHOULD log these — the pre-alpha.2 silent downgrade was caught only because an external validation script logged the outbound wire body. New `PipelineWarning` type exported from `@krynix/sdk`.

### Added

- New top-level export `PipelineWarning` (discriminated union, currently one variant: `redaction_no_op`).
- New optional `warnings` field on the `forward` outcome variant of `PipelineOutcome`.
- **OSS approval-handler callback (`approvalHandler` option on `KrynixOptions`).** Resolves `require-approval` verdicts in-process — no ingest server required. Three built-in handlers ship: `denyAllApprovalHandler`, `cliPromptApprovalHandler`, `webhookApprovalHandler`. Bring-your-own callbacks matching the `ApprovalHandler` type also work. Same wire shape as the hosted approval queue (`ApprovalDecision` = approve / approve_with_redactions / deny).
- New `resolveApproval()` helper — single entry point adapters call to resolve a `require-approval` verdict. Routes between hosted `ApprovalPoller` and local `approvalHandler` with the right precedence (poller wins when both are configured) and throws `ApprovalUnavailable` when neither is configured. Soft-block timeouts that resolve to `allow` are surfaced as a top-level `action: "approve_after_timeout"` variant so adapters never accidentally treat a timeout as a human approval. `webhookApprovalHandler` translates its internal abort-on-timeout into a clear `"...timed out after Nms"` error instead of leaking a bare `AbortError`.
- New typed error `ApprovalUnavailable` — surfaced when a rule returns `require-approval` but the SDK has no transport configured. Lets adapter authors distinguish "infrastructure missing" from "human reviewer denied" (`ApprovalDenied`).
- New public types: `ApprovalHandler`, `ApprovalHandlerEvent`, `ApprovalDecision`, `ResolvedApproval`.
- `KrynixContext.approvalHandler: ApprovalHandler | null` — adapter authors can read this directly, but `resolveApproval()` is the recommended call site.

### Backward compatibility

- `warnings` is an additive optional field — adapters that ignore it continue to work as before.
- Bracket-index path support is a strict superset of the alpha.1 grammar; no path that worked in alpha.1 stops working in alpha.2.
- `approvalHandler` is an additive optional `KrynixOptions` field; existing callers continue to work. The new `KrynixContext.approvalHandler` field is `null` when not configured — adapters that switch on `approvalPoller` alone keep working but lose the OSS-pathway story for `require-approval`.

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
