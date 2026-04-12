/**
 * Zero-friction LangChain tracer plugin for Krynix.
 *
 * Creates a callback handler compatible with LangChain's `BaseCallbackHandler`
 * interface. Internally manages session lifecycle, event recording, and write
 * queue serialization — users just pass the handler to their LangChain chain.
 *
 * Zero runtime dependency on LangChain — returns a plain object whose methods
 * match the `BaseCallbackHandler` signature.
 *
 * Usage:
 * ```typescript
 * import { createLangChainTracer } from "@krynix/adapter-langchain";
 *
 * const { handler, handle } = await createLangChainTracer({
 *   outputPath: "./trace.jsonl",
 *   agentId: "my-agent",
 * });
 *
 * // Pass handler to LangChain — all events captured automatically
 * await chain.invoke({ input: "..." }, { callbacks: [handler] });
 *
 * // When done, shut down to finalize the trace
 * await handle.shutdown();
 * ```
 *
 * @module
 */

import { startSession, recordEvent, endSession, destroySession } from "@krynix/core";
import type { Session } from "@krynix/core";
import { LangChainAdapter } from "./adapter.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Configuration for the LangChain tracer plugin. */
export interface LangChainTracerOptions {
  /** Filesystem path for the output `.trace.jsonl` file. */
  outputPath: string;
  /** Agent ID stamped on every event. */
  agentId: string;
  /** Replay seed for deterministic trace generation. */
  replaySeed?: number;
  /** Session metadata included in the session_start event context. */
  metadata?: Record<string, unknown>;
}

/** Handle for programmatic control of the tracer. */
export interface LangChainTracerHandle {
  /** Shut down the tracer, ending the session and closing the trace file. */
  shutdown(): Promise<void>;
  /** Get the output trace file path. */
  getTracePath(): string;
}

/**
 * Minimal interface matching LangChain's `BaseCallbackHandler` signature.
 *
 * Zero runtime dependency on LangChain — this is a plain object with
 * method signatures that are structurally compatible with the real
 * `langchain-core` `BaseCallbackHandler`. The trailing `tags`, `metadata`, and
 * `runName` parameters are how LangChain communicates the canonical name of a
 * tool/chain/LLM call; dropping them was the root cause of the
 * `unknown_tool` chain-of-trust bug.
 *
 * `awaitHandlers: true` is load-bearing: LangChain's callback manager reads
 * this flag to decide whether to `await` a handler inline or fire it through
 * an internal p-queue (`callbacks/promises.ts`). With the default `false`
 * semantics, callbacks like `handleToolEnd` run *after* `chain.invoke()`
 * resolves — so calling `handle.shutdown()` immediately after invoke would
 * race the in-flight callback and drop the `tool_result` event silently
 * (another variant of the chain-of-trust bug). Setting this flag causes
 * LangChain to await our handler inside its own call path, so by the time
 * invoke returns, every event has already been recorded.
 */
export interface LangChainCallbackHandlerMinimal {
  /**
   * Tell LangChain to await each handler call inline instead of queueing it
   * for out-of-band draining. See the block comment on this interface for
   * why this must be `true`.
   */
  awaitHandlers: boolean;
  handleLLMStart(
    serialized: unknown,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void>;
  handleLLMEnd(
    output: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  handleLLMError(
    error: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  handleToolStart(
    tool: unknown,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runName?: string,
  ): Promise<void>;
  handleToolEnd(
    output: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  handleToolError(
    error: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  handleChainStart(
    chain: unknown,
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    runType?: string,
    runName?: string,
  ): Promise<void>;
  handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  handleChainError(
    error: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  /** Agent action callback — emitted when a LangChain agent decides to call a tool. */
  handleAgentAction(
    action: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  /**
   * Agent end callback — emitted when a LangChain agent finishes.
   *
   * Real TS LangChain calls this `handleAgentEnd`. The legacy alias
   * `handleAgentFinish` is also exposed below for older callers.
   */
  handleAgentEnd(
    finish: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
  /** Legacy alias for `handleAgentEnd` — kept for backwards compatibility. */
  handleAgentFinish(
    finish: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void>;
}

/** Result returned by `createLangChainTracer`. */
export interface LangChainTracerResult {
  /** Callback handler to pass to LangChain chains/agents. */
  handler: LangChainCallbackHandlerMinimal;
  /** Handle for programmatic shutdown and trace path access. */
  handle: LangChainTracerHandle;
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create a zero-friction LangChain tracer.
 *
 * Returns a callback handler that captures all LangChain events into a
 * Krynix trace file, plus a handle for shutdown.
 *
 * @param options - Tracer configuration
 * @returns Handler and control handle
 * @throws {Error} If `outputPath` or `agentId` is missing
 */
export async function createLangChainTracer(
  options: LangChainTracerOptions,
): Promise<LangChainTracerResult> {
  if (!options || typeof options.outputPath !== "string" || options.outputPath.length === 0) {
    throw new Error("createLangChainTracer: outputPath is required");
  }
  if (typeof options.agentId !== "string" || options.agentId.length === 0) {
    throw new Error("createLangChainTracer: agentId is required");
  }

  const { outputPath, agentId, replaySeed, metadata } = options;

  // Start session first so we have a real sessionId for the adapter
  const session: Session = await startSession({
    agentId,
    replaySeed,
    outputPath,
    metadata,
  });

  // Initialize adapter with the real sessionId for internal consistency
  const adapter = new LangChainAdapter();
  try {
    await adapter.initialize({ agentId, sessionId: session.sessionId, replaySeed });
  } catch (err) {
    await destroySession(session);
    throw err;
  }

  let sessionEnded = false;

  // Write queue: serializes concurrent callback invocations so that
  // recordEvent calls are sequential and the hash chain stays valid.
  //
  // The .catch() in the queue intentionally does NOT rethrow: rethrowing would
  // permanently reject the queue promise, causing ALL subsequent .then() callbacks
  // to be skipped silently. By catching without rethrowing, the queue stays alive
  // and subsequent writes can still be attempted. The captured firstWriteError is
  // surfaced on shutdown(), where destroySession() closes the writer and removes
  // the session — leaving the trace implicitly incomplete (missing
  // lifecycle:session_end).
  let writeQueue: Promise<void> = Promise.resolve();
  let firstWriteError: unknown = null;

  // -------------------------------------------------------------------------
  // Internal: feed a callback event through the adapter and record it
  // -------------------------------------------------------------------------

  function feedEvent(callbackEvent: Record<string, unknown>): void {
    if (sessionEnded) return;

    const traceEvent = adapter.onEvent(callbackEvent);
    if (traceEvent === null) return;

    const currentSession = session;
    writeQueue = writeQueue
      .then(() =>
        recordEvent(currentSession, {
          event_type: traceEvent.event_type,
          timestamp: traceEvent.timestamp,
          parent_id: traceEvent.parent_id,
          agent_id: traceEvent.agent_id,
          payload: traceEvent.payload,
          metadata: traceEvent.metadata,
        }).then(() => undefined),
      )
      .catch((err: unknown) => {
        if (firstWriteError === null) firstWriteError = err;
      });
  }

  async function awaitQueue(): Promise<void> {
    await writeQueue;
  }

  // -------------------------------------------------------------------------
  // Callback handler — matches LangChain's BaseCallbackHandler signature
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Agent end callback — defined as a standalone function so the public
  // handler can expose it under both `handleAgentEnd` (real TS LangChain
  // method) and `handleAgentFinish` (legacy alias) without duplicating the
  // body or tripping the per-function line limit.
  // -------------------------------------------------------------------------

  async function feedAgentEnd(
    finish: unknown,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    feedEvent({ _callback: "handleAgentFinish", finish, runId, parentRunId, tags });
    await awaitQueue();
  }

  const handler: LangChainCallbackHandlerMinimal = {
    // LangChain awaits our handlers inline when this flag is true. Without it,
    // the callback manager fire-and-forgets and `handle.shutdown()` races the
    // in-flight callbacks, silently dropping `tool_result` / `llm_response`
    // events. See the block comment on `LangChainCallbackHandlerMinimal`.
    awaitHandlers: true,

    async handleLLMStart(
      serialized: unknown,
      prompts: string[],
      runId: string,
      parentRunId?: string,
      extraParams?: Record<string, unknown>,
      tags?: string[],
      metadata?: Record<string, unknown>,
      runName?: string,
    ): Promise<void> {
      feedEvent({
        _callback: "handleLLMStart",
        serialized,
        prompts,
        runId,
        parentRunId,
        extraParams,
        tags,
        metadata,
        runName,
        // Legacy `name` extraction kept so existing tests that pass the model
        // name via extraParams.name continue to work.
        ...(typeof extraParams?.name === "string" ? { name: extraParams.name } : {}),
      });
      await awaitQueue();
    },

    async handleLLMEnd(
      output: unknown,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ): Promise<void> {
      feedEvent({ _callback: "handleLLMEnd", output, runId, parentRunId, tags });
      await awaitQueue();
    },

    async handleLLMError(
      error: unknown,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ): Promise<void> {
      feedEvent({ _callback: "handleLLMError", error, runId, parentRunId, tags });
      await awaitQueue();
    },

    async handleToolStart(
      tool: unknown,
      input: string,
      runId: string,
      parentRunId?: string,
      tags?: string[],
      metadata?: Record<string, unknown>,
      runName?: string,
    ): Promise<void> {
      feedEvent({
        _callback: "handleToolStart",
        tool,
        input,
        runId,
        parentRunId,
        tags,
        metadata,
        runName,
      });
      await awaitQueue();
    },

    async handleToolEnd(
      output: string,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ): Promise<void> {
      feedEvent({ _callback: "handleToolEnd", output, runId, parentRunId, tags });
      await awaitQueue();
    },

    async handleToolError(
      error: unknown,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ): Promise<void> {
      feedEvent({ _callback: "handleToolError", error, runId, parentRunId, tags });
      await awaitQueue();
    },

    async handleChainStart(
      chain: unknown,
      inputs: Record<string, unknown>,
      runId: string,
      parentRunId?: string,
      tags?: string[],
      metadata?: Record<string, unknown>,
      runType?: string,
      runName?: string,
    ): Promise<void> {
      feedEvent({
        _callback: "handleChainStart",
        chain,
        inputs,
        runId,
        parentRunId,
        tags,
        metadata,
        runType,
        runName,
      });
      await awaitQueue();
    },

    async handleChainEnd(
      outputs: Record<string, unknown>,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ): Promise<void> {
      feedEvent({ _callback: "handleChainEnd", outputs, runId, parentRunId, tags });
      await awaitQueue();
    },

    async handleChainError(
      error: unknown,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ): Promise<void> {
      feedEvent({ _callback: "handleChainError", error, runId, parentRunId, tags });
      await awaitQueue();
    },

    async handleAgentAction(
      action: unknown,
      runId: string,
      parentRunId?: string,
      tags?: string[],
    ): Promise<void> {
      feedEvent({ _callback: "handleAgentAction", action, runId, parentRunId, tags });
      await awaitQueue();
    },

    handleAgentEnd: feedAgentEnd,
    handleAgentFinish: feedAgentEnd,
  };

  // -------------------------------------------------------------------------
  // Control handle
  // -------------------------------------------------------------------------

  const handle: LangChainTracerHandle = {
    async shutdown(): Promise<void> {
      if (sessionEnded) return;
      sessionEnded = true;
      let shutdownError: unknown = null;
      try {
        await writeQueue;
        if (firstWriteError !== null) {
          throw firstWriteError;
        }
        await endSession(session);
      } catch (err: unknown) {
        shutdownError = err;
        await destroySession(session);
      }
      await adapter.shutdown();
      if (shutdownError !== null) {
        throw shutdownError;
      }
    },

    getTracePath(): string {
      return outputPath;
    },
  };

  return { handler, handle };
}
