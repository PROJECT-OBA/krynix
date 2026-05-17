/**
 * `Krynix` — the SDK's public entry point.
 *
 * Usage:
 *
 *   const krynix = new Krynix({
 *     policy,
 *     agentId: "my-agent",
 *     sessionId: crypto.randomUUID(),
 *     ingest: { url: "https://api.krynix.dev", apiKey: "..." },
 *     redaction: { mode: "regex" },
 *     approval: { mode: "soft", timeoutMs: 30_000 },
 *   });
 *   const wrapped = krynix.wrap(new OpenAI());
 *
 * `wrap()` dispatches to an adapter registered for the client's
 * shape. This alpha ships the dispatch + the registry; concrete
 * adapters for OpenAI / Anthropic / LangChain land in follow-up
 * alphas.
 *
 * The class also owns the shared pipeline collaborators (ingest
 * client, event buffer, approval poller, agent + session IDs).
 * Adapters read these via the `KrynixContext` interface so they
 * stay decoupled from this constructor.
 *
 * @module
 */

import type { Policy } from "@krynix/policy";
import { IngestClient } from "./ingest-client.js";
import { EventBuffer } from "./event-buffer.js";
import { ApprovalPoller } from "./approval-poller.js";
import { resolveRedactionMode } from "./redact.js";
import type { KrynixOptions, RedactionMode } from "./types.js";

/**
 * Shared context passed to every adapter. Adapters write into it
 * (via `buffer.enqueue` etc.) but don't construct it themselves.
 *
 * Exposed for adapter authors writing third-party integrations; the
 * first-party OpenAI / Anthropic / LangChain adapters consume the
 * same shape.
 */
export interface KrynixContext {
  readonly policy: Policy;
  readonly agentId: string;
  readonly sessionId: string;
  readonly redactionMode: RedactionMode;
  readonly buffer: EventBuffer;
  /** `null` in offline mode — adapters MUST handle this and not poll. */
  readonly approvalPoller: ApprovalPoller | null;
}

/**
 * Signature for an adapter registered via `Krynix.registerAdapter()`.
 *
 * `detect(client)` returns true iff this adapter knows how to wrap
 * the given client object. `wrap(client, ctx)` returns the wrapped
 * client.
 */
export interface KrynixAdapter<TClient> {
  readonly name: string;
  detect(client: unknown): client is TClient;
  wrap(client: TClient, ctx: KrynixContext): TClient;
}

/** Thrown when `wrap()` is called with a client no registered adapter recognises. */
export class NoAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoAdapterError";
  }
}

export class Krynix {
  // Adapter registry is class-level so any module that imports
  // `Krynix` (or a side-effecting adapter file like `./adapters/openai.js`)
  // can register without the caller threading it through.
  private static readonly adapters: KrynixAdapter<unknown>[] = [];

  /**
   * Register a new adapter. Called by the adapter modules at import
   * time. Stable order — first-registered wins on detection ties.
   */
  static registerAdapter<TClient>(adapter: KrynixAdapter<TClient>): void {
    Krynix.adapters.push(adapter as KrynixAdapter<unknown>);
  }

  /** Visible for tests + diagnostics. */
  static listAdapters(): readonly string[] {
    return Krynix.adapters.map((a) => a.name);
  }

  readonly ctx: KrynixContext;
  private readonly ingestClient: IngestClient | null;

  constructor(opts: KrynixOptions) {
    if (opts.policy === undefined || opts.policy === null) {
      throw new Error("Krynix: `policy` is required");
    }
    if (typeof opts.agentId !== "string" || opts.agentId.length === 0) {
      throw new Error("Krynix: `agentId` must be a non-empty string");
    }
    if (typeof opts.sessionId !== "string" || opts.sessionId.length === 0) {
      throw new Error("Krynix: `sessionId` must be a non-empty string");
    }

    // Resolve redaction mode early so misconfigured callers fail fast
    // (e.g. `redaction: { mode: "presidio" }` throws here, not on the
    // first wrapped call).
    const redactionMode = resolveRedactionMode(opts.redaction);

    // Ingest client + buffer + poller only when an URL is configured.
    // Offline mode is supported — verdict pipeline still works, but
    // events go nowhere and approval polling is unavailable.
    const ingestUrl = opts.ingest?.url;
    const ingestApiKey = opts.ingest?.apiKey;
    if (ingestUrl !== undefined) {
      // Validate the URL shape up-front so misconfigured callers fail at
      // construction, not on the first deferred fetch. Empty strings,
      // non-strings, and non-http(s) schemes all reach fetch as relative
      // URLs and produce opaque "Failed to parse URL" errors otherwise.
      // Caught in Copilot review of #53 round 2.
      if (typeof ingestUrl !== "string" || ingestUrl.length === 0) {
        throw new Error("Krynix: `ingest.url` must be a non-empty string");
      }
      if (!/^https?:\/\//i.test(ingestUrl)) {
        throw new Error(
          `Krynix: \`ingest.url\` must start with "http://" or "https://" (got "${ingestUrl}")`,
        );
      }
      if ((ingestApiKey ?? "") === "") {
        throw new Error("Krynix: `ingest.apiKey` is required when `ingest.url` is set");
      }
    }
    this.ingestClient =
      ingestUrl !== undefined && ingestApiKey !== undefined
        ? new IngestClient({ url: ingestUrl, apiKey: ingestApiKey })
        : null;

    const buffer = new EventBuffer({
      client: this.ingestClient,
      sessionId: opts.sessionId,
      flushIntervalMs: opts.ingest?.flushIntervalMs,
      maxBatchSize: opts.ingest?.maxBatchSize,
      maxRetries: opts.ingest?.maxRetries,
    });

    const approvalPoller =
      this.ingestClient !== null
        ? new ApprovalPoller({
            client: this.ingestClient,
            sessionId: opts.sessionId,
            config: opts.approval ?? {},
          })
        : null;

    this.ctx = {
      policy: opts.policy,
      agentId: opts.agentId,
      sessionId: opts.sessionId,
      redactionMode,
      buffer,
      approvalPoller,
    };
  }

  /**
   * Wrap an LLM / tool client with policy enforcement.
   *
   * The returned client has the same shape as the input but every
   * outbound call passes through the verdict pipeline first.
   * Throws `NoAdapterError` if no registered adapter recognises the
   * client (e.g. you forgot to import the adapter package).
   */
  wrap<TClient>(client: TClient): TClient {
    for (const adapter of Krynix.adapters) {
      if (adapter.detect(client)) {
        return (adapter as KrynixAdapter<TClient>).wrap(client, this.ctx);
      }
    }
    throw new NoAdapterError(
      `Krynix.wrap(): no registered adapter recognises this client. ` +
        `Registered adapters: ${Krynix.listAdapters().join(", ") || "(none)"}. ` +
        `Ensure the relevant adapter module is imported before calling wrap(); ` +
        `each adapter side-effect-registers itself via Krynix.registerAdapter() ` +
        `at import time.`,
    );
  }

  /**
   * Flush the event buffer + close the ingest client. Call at the
   * end of an agent run to ensure decision events make it to ingest
   * before the process exits.
   *
   * Safe to call multiple times; subsequent calls are no-ops.
   */
  async close(): Promise<void> {
    await this.ctx.buffer.close();
  }
}
