/**
 * Public types consumed by SDK callers. Most are re-exports from
 * `@krynix/core` and `@krynix/policy` — the SDK does not invent new
 * trace / policy shapes.
 *
 * Adapter authors writing new adapters (Cohere, Mistral, etc.) consume
 * the types here to keep their integrations consistent with the
 * shipped OpenAI / Anthropic / LangChain ones (which land in follow-up alphas).
 *
 * @module
 */

import type { Policy } from "@krynix/policy";

/**
 * Mode for the require-approval polling path.
 *
 * - `"soft"` — poll for at most `timeoutMs`, then fall back to the
 *   rule's `on_timeout` (default `"deny"` per `@krynix/policy`
 *   semantics). Recommended for production agents — avoids hanging.
 * - `"hard"` — poll indefinitely. Risky: the wrapped call hangs until
 *   a human acts. Opt-in for human-in-the-loop workflows where the
 *   agent must wait.
 */
export type ApprovalMode = "soft" | "hard";

/** SDK configuration for the approval-queue path. */
export interface ApprovalConfig {
  /** Soft-block (default) or hard-block. */
  mode?: ApprovalMode;
  /** Total time the SDK polls before giving up (soft mode only). Default 30000 ms. */
  timeoutMs?: number;
  /** Initial poll interval. Default 500 ms. Doubles up to `maxPollIntervalMs` per attempt. */
  pollIntervalMs?: number;
  /** Cap on the poll interval after exponential backoff. Default 5000 ms. */
  maxPollIntervalMs?: number;
}

/** SDK configuration for the redaction layer. */
export type RedactionMode = "off" | "regex" | "presidio";

export interface RedactionConfig {
  /**
   * `"off"` — never redact. Use when policy rules don't include
   *   `redact` actions.
   * `"regex"` — apply the SDK's own `applyRedactions()` traversal
   *   (regex + dot-notation paths + `[*]` array spread) to the
   *   fields named by the matched rule's `redactions[]` directives.
   *   Default. Cheap and deterministic; the patterns themselves
   *   live on the policy.
   * `"presidio"` — structured PII detection. **Not implemented in
   *   v0.1-alpha** — throws at construction. Ships in v0.2.
   */
  mode?: RedactionMode;
}

/** SDK configuration for the async ingest emit path. */
export interface IngestConfig {
  /**
   * Base URL of a Krynix API endpoint (e.g. `https://api.krynix.dev`).
   * When omitted, the SDK runs in **offline mode**: policy evaluation
   * still works, but no events are emitted to ingest and the approval
   * queue is unavailable. Useful for local dev / pre-deploy testing.
   */
  url?: string;
  /**
   * Bearer token for ingest. Required when `url` is set. Sent as
   * `Authorization: Bearer <apiKey>` on every request.
   */
  apiKey?: string;
  /**
   * Batch flush interval. Default 1000 ms.
   */
  flushIntervalMs?: number;
  /**
   * Max events buffered before a forced flush. Default 100.
   * Events emitted beyond this trigger an immediate flush regardless
   * of `flushIntervalMs`.
   */
  maxBatchSize?: number;
  /**
   * Max retries on transport failure. Default 3. Exponential backoff
   * starting at 200 ms.
   */
  maxRetries?: number;
}

/** Configuration accepted by the `Krynix` constructor. */
export interface KrynixOptions {
  /**
   * The policy the SDK enforces. Pass a parsed `Policy` object (from
   * `parsePolicy()` in `@krynix/policy`). String / URL loading is a
   * v0.2 convenience.
   */
  policy: Policy;
  /** Stable agent identifier stamped on every emitted TraceEvent. */
  agentId: string;
  /**
   * Session identifier for this run. Each call to `new Krynix(...)`
   * represents one agent session. Multiple wrapped clients on the
   * same instance share the session id.
   */
  sessionId: string;
  /** Ingest connection + buffer config. Omit for offline-mode. */
  ingest?: IngestConfig;
  /** Redaction config. Default `{ mode: "regex" }`. */
  redaction?: RedactionConfig;
  /** Approval-queue config. Default soft-block, 30 s timeout. */
  approval?: ApprovalConfig;
}
