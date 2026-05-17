/**
 * Async event buffer with batched flush + exponential-backoff retry.
 *
 * The SDK never blocks the caller's response path on ingest
 * availability — every emitted TraceEvent goes through this buffer,
 * which flushes batches in the background and silently retries
 * transport failures. On `process.exit` the buffer drains
 * synchronously (best-effort) to minimise dropped events.
 *
 * Design constraints:
 *
 * - Never block the LLM/tool response on ingest. Buffer is fire-and-forget.
 * - Never silently allow on a transport failure for runtime decisions.
 *   (This module emits events *after* the verdict has been taken; the
 *   verdict pipeline is in-process and unaffected by ingest health.)
 * - Drain on exit so we don't lose decision events from short-lived
 *   CLI runs.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { IngestClient } from "./ingest-client.js";

export interface EventBufferOptions {
  /** The ingest client to flush through. `null` means offline mode (events are discarded). */
  client: IngestClient | null;
  /** Session ID for the POST path. */
  sessionId: string;
  /** Default 1000 ms. */
  flushIntervalMs?: number;
  /** Default 100. */
  maxBatchSize?: number;
  /** Default 3. Exponential backoff starting at 200 ms (override via `backoffMs`). */
  maxRetries?: number;
  /**
   * Maps a retry-attempt number (1-indexed) to the ms to wait before
   * that attempt. Default: 200 * 2^(attempt-1), capped at 5000 —
   * `[200, 400, 800, 1600, 3200, 5000, 5000, …]`. Override to
   * `() => 0` in tests so retry suites complete instantly without
   * needing fake timers. Production callers should leave this unset.
   */
  backoffMs?: (attempt: number) => number;
  /**
   * Optional sink for non-fatal errors (transport timeouts, retry
   * exhaustion). The SDK logs them via this hook so a caller can
   * route them to their existing observability stack (pino, console,
   * Sentry, …) without us bundling a logger. Defaults to a no-op so
   * the SDK doesn't accidentally print to stderr.
   */
  onError?: (err: unknown) => void;
}

export class EventBuffer {
  private readonly client: IngestClient | null;
  private readonly sessionId: string;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxRetries: number;
  private readonly backoffMs: (attempt: number) => number;
  private readonly onError: (err: unknown) => void;

  private queue: TraceEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * Promise tracking the currently-flushing batch, or `null` when
   * nothing is in flight. Centralised so `flush()` and `close()`
   * both await the same promise instead of racing — without this
   * tracking, a flush kicked off by `enqueue()`'s batch-size
   * trigger would be skipped by a concurrent `close()` and the
   * pending retries would silently drop. Caught in this package's unit tests.
   */
  private inFlight: Promise<void> | null = null;
  /** Set to `true` after `close()` is called. New `enqueue()` calls are dropped. */
  private closed = false;
  /**
   * The `beforeExit` listener installed by `attachExitDrain()`, captured
   * here so `close()` can remove it. Without removal, long-running
   * processes that create many `Krynix` / `EventBuffer` instances leak
   * listeners and eventually trip Node's max-listeners warning. Caught
   * in Copilot review of #53 round 2.
   */
  private exitDrainHandler: (() => void) | null = null;

  constructor(opts: EventBufferOptions) {
    this.client = opts.client;
    this.sessionId = opts.sessionId;
    this.flushIntervalMs = opts.flushIntervalMs ?? 1000;
    this.maxBatchSize = opts.maxBatchSize ?? 100;
    this.backoffMs = opts.backoffMs ?? defaultBackoffMs;
    this.maxRetries = opts.maxRetries ?? 3;
    this.onError = opts.onError ?? (() => undefined);

    // Skip the periodic timer in offline mode — there's nowhere to
    // flush to and we don't want to hold the event loop open with a
    // pointless timer.
    if (this.client !== null) {
      this.startTimer();
      this.attachExitDrain();
    }
  }

  /**
   * Add an event to the buffer. When the buffer hits `maxBatchSize` a
   * flush kicks off immediately. Returns synchronously — flush is
   * async + background.
   */
  enqueue(event: TraceEvent): void {
    if (this.closed) return;
    if (this.client === null) return; // offline mode

    this.queue.push(event);
    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  /**
   * Force a flush. Drains the queue completely — including events
   * enqueued while a previous flush was in flight. Returns when the
   * queue is empty and no batch is in flight. Safe to call multiple
   * times concurrently — concurrent callers share the in-flight
   * promise rather than starting parallel sends, and all return only
   * once every event observed at call time has been sent.
   *
   * The drain loop is the contract: a single `await flush()` must not
   * leave events behind. Callers reasoning about delivery (notably
   * `close()`) depend on this — the prior implementation skipped the
   * queue when a flush was in flight, leaving events behind unless
   * the caller re-checked. Caught in Copilot review of #53 round 2.
   */
  async flush(): Promise<void> {
    if (this.client === null) return;

    // Drain loop. Each iteration either joins an in-flight batch or
    // starts a new one; exits when neither is needed.
    while (true) {
      if (this.inFlight !== null) {
        // Another caller is sending. Wait for them, then re-check —
        // they may have already drained everything that was queued
        // when we started, or new events may have arrived since.
        await this.inFlight;
        continue;
      }
      if (this.queue.length === 0) return;

      // Swap the queue out so new enqueue()s during the flush land in
      // a fresh batch and don't get re-sent.
      const batch = this.queue;
      this.queue = [];

      this.inFlight = this.sendWithRetry(batch).finally(() => {
        this.inFlight = null;
      });

      await this.inFlight;
      // Loop continues — picks up any events that arrived during the send.
    }
  }

  /**
   * Stop the timer + drain remaining events. Idempotent. Safe to call
   * from process-exit hooks. Returns after the final flush completes
   * (or fails terminally), including any flush kicked off by an
   * `enqueue()` in flight at close time.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (
      this.exitDrainHandler !== null &&
      typeof process !== "undefined" &&
      typeof process.off === "function"
    ) {
      // Remove the beforeExit handler we installed in attachExitDrain
      // so long-running processes that create many EventBuffer
      // instances don't accumulate listeners (max-listeners warning +
      // memory pressure). Caught in Copilot review of #53 round 2.
      //
      // `process.off` is gated symmetrically with the `process.on` check
      // in attachExitDrain — a host (browser shim, edge runtime) that
      // exposes `process.on` but not `process.off` would throw here
      // otherwise. In that case we simply drop the handler reference;
      // the host owns its own lifecycle.
      process.off("beforeExit", this.exitDrainHandler);
    }
    this.exitDrainHandler = null;
    // flush() drains the queue completely, including events enqueued
    // while a batch was in flight, so a single call is sufficient.
    await this.flush();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private startTimer(): void {
    this.timer = setInterval(() => {
      void this.flush().catch((err) => {
        this.onError(err);
      });
    }, this.flushIntervalMs);
    // Don't keep the Node event loop alive just to flush an empty
    // buffer. Without this, CLIs that import the SDK without
    // emitting events will hang on exit until the timer fires.
    if (typeof this.timer === "object" && this.timer !== null && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  private attachExitDrain(): void {
    // Best-effort drain on process exit. `beforeExit` is fired when the
    // event loop is about to drain — scheduling new async work here
    // keeps the loop alive long enough for the in-flight POST to land
    // (Node only exits once nothing keeps the loop running). The drain
    // is still "best-effort", not guaranteed: if a hard `process.exit()`
    // is called from elsewhere, or a SIGKILL fires, this handler doesn't
    // run. Callers that need strong delivery guarantees should call
    // `await krynix.close()` explicitly before letting the process die.
    //
    // The handler reference is stored so `close()` can detach it —
    // otherwise long-running processes that create many EventBuffer
    // instances accumulate beforeExit listeners.
    if (typeof process !== "undefined" && typeof process.on === "function") {
      this.exitDrainHandler = () => {
        void this.flush().catch(() => undefined);
      };
      process.on("beforeExit", this.exitDrainHandler);
    }
  }

  private async sendWithRetry(batch: TraceEvent[]): Promise<void> {
    if (this.client === null) return;
    let attempt = 0;
    // First attempt is "0", retries up to maxRetries → maxRetries+1 total tries.
    while (true) {
      try {
        await this.client.submitEvents(this.sessionId, batch);
        return;
      } catch (err) {
        attempt += 1;
        if (attempt > this.maxRetries) {
          this.onError(err);
          // Drop the batch. We intentionally don't re-enqueue — that
          // could lock the buffer into a permanent flush loop on a
          // dead ingest. Surface via onError so the caller can take
          // action; the verdict path is unaffected.
          return;
        }
        const delay = this.backoffMs(attempt);
        if (delay > 0) await sleep(delay);
      }
    }
  }
}

function defaultBackoffMs(attempt: number): number {
  // 200, 400, 800, 1600, 3200, 5000, 5000, ...
  return Math.min(200 * Math.pow(2, attempt - 1), 5000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
