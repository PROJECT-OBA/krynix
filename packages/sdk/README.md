# @krynix/sdk

**Status:** `0.1.0-alpha.1` — published under the `@alpha` npm tag. API may change before `0.2`.

Runtime policy enforcement for AI agents. Wraps your LLM client + tool dispatcher so every call runs through a policy *before* it executes — allow, deny, redact, or pause for human approval.

The SDK is **standalone**. Three of the four verdicts (`pass` / `redact` / `deny`) run fully in-process, no server required. `require-approval` needs either a local approval handler (coming in `0.1.0-alpha.2`) or a Krynix ingest server (optional; managed free tier coming soon).

## Quickstart — offline mode (recommended)

```ts
import { Krynix } from "@krynix/sdk";
import { parsePolicy } from "@krynix/policy";
import OpenAI from "openai"; // adapter lands in a follow-up alpha

const policy = parsePolicy(/* your policy.yaml */);
const krynix = new Krynix({
  policy,
  agentId: "my-agent",
  sessionId: crypto.randomUUID(),
  redaction: { mode: "regex" },        // structured PII detection lands in v0.2
  // No `ingest` block — SDK runs offline.
  // `pass` / `redact` / `deny` work fully in-process.
});

const client = krynix.wrap(new OpenAI());
// Every chat.completions.create / messages.create / tool call now runs through policy.
```

Offline mode is the right starting point for solo developers, CLI agents, and single-team servers. No registration, no API key, no network dependency. If your policy uses `require-approval` rules, those calls will throw `ApprovalUnavailable` until you wire either an approval handler (alpha.2) or an ingest URL (below).

## Quickstart — with a Krynix ingest server (optional)

If you have access to a Krynix ingest endpoint (managed free tier coming soon, or self-hosted in your own infrastructure), pass an `ingest` block to enable the full 4-verdict pipeline plus async governance trail:

```ts
const krynix = new Krynix({
  policy,
  agentId: "my-agent",
  sessionId: crypto.randomUUID(),
  ingest: { url: process.env.KRYNIX_INGEST_URL!, apiKey: process.env.KRYNIX_API_KEY! },
  redaction: { mode: "regex" },
  approval: { mode: "soft", timeoutMs: 30_000 },
});

const client = krynix.wrap(new OpenAI());
await krynix.close(); // drain the buffer before the process exits
```

The managed ingest at `api.krynix.dev` is on the roadmap with a free tier (registration + API key) for solo developers and small teams. Limits and timing will be published when the endpoint is live.

## What ships in `0.1.0-alpha.1` (skeleton)

| Surface | Status |
|---|---|
| `Krynix` class + adapter registry | ✅ |
| Verdict pipeline (`runPipeline`) | ✅ |
| Async event buffer with batched flush + exponential-backoff retry | ✅ |
| Approval poller (soft- and hard-block modes) | ✅ |
| Regex-based redaction (rule-driven, deep-clones the request body) | ✅ |
| Offline mode (verdict pipeline works; ingest is bypassed) | ✅ |
| OpenAI adapter | 🚧 follow-up alpha |
| Anthropic adapter | 🚧 follow-up alpha |
| LangChain `Runnable` adapter | 🚧 follow-up alpha |
| Presidio-based PII detection | 🚧 v0.2 |

Calling `wrap()` today (before any adapter lands) throws `NoAdapterError` because no adapter is registered yet. That's intentional — the skeleton is the gate-merge boundary so the API contract is reviewed before the adapter PRs depend on it.

## Concepts

### Verdicts

The SDK speaks four verdicts (mirrored from `@krynix/policy`):

| Verdict | SDK action |
|---|---|
| `pass` | Forward the call unchanged. |
| `redact` | Apply the matched rule's `redactions[]` to a deep-cloned request body, forward the redacted version. |
| `fail` | Block the call. Throws `PolicyDenied(message, ruleId)`. |
| `require-approval` | Submit the call to the Krynix approval queue + poll. Resolves to forward / throws `ApprovalDenied` / throws `ApprovalTimeout`. |

### Approval modes

- **soft** (default) — poll for `timeoutMs` (default 30 s). On timeout, fall back to the rule's `on_timeout` (`"deny"` if unset, which throws `ApprovalTimeout`).
- **hard** — poll forever. Caller-opt-in only — risks hanging the agent.

### Async governance trail

Every wrapped call emits a `decision`-type `TraceEvent` with the `policy_decision` sub-shape (added in trace schema 1.1.0; the matching `@krynix/core` release ships alongside this SDK alpha — see `packages/core/src/types.ts` for the current `SCHEMA_VERSION` constant). Events flow through an in-memory buffer that:

- Batches up to `maxBatchSize` (default 100) or flushes every `flushIntervalMs` (default 1000 ms).
- Retries transport failures with exponential backoff (200 ms → 5 s, max 3 retries).
- Best-effort drain on `beforeExit` for short-lived CLI runs. **Not guaranteed** — a hard `process.exit()` (or SIGKILL) doesn't fire `beforeExit`, so the drain doesn't run. For at-most-once-loss semantics, always `await krynix.close()` before letting the process die.
- Never blocks the verdict pipeline — your call latency is unaffected by ingest health.

Call `await krynix.close()` at the end of an agent run to force a final flush.

### Offline mode

Omit `ingest.url` and the SDK runs without ingest entirely. The verdict pipeline still works (policy is evaluated in-process), so `pass` / `redact` / `deny` all enforce correctly. Trace events go nowhere; `require-approval` rules throw `ApprovalUnavailable` until either an `approvalHandler` callback (planned for `0.1.0-alpha.2`) or an `ingest.url` is configured. Offline mode is the recommended path for solo developers, CLI agents, and single-team servers — no registration or API key required.

## Design

The verdict pipeline is a pure function (`runPipeline(event, body, policy)` in `verdict-pipeline.ts`). All side effects (redaction → deep-clone, ingest emit, approval polling) live in the `Krynix` class collaborators. Adapters consume a `KrynixContext` and never touch the constructor — see `KrynixAdapter` in `krynix.ts` for the contract third-party adapter authors implement.

## License

Apache-2.0.
