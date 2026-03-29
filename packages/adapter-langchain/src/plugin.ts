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
 * method signatures that are structurally compatible.
 */
export interface LangChainCallbackHandlerMinimal {
  handleLLMStart(
    serialized: unknown,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): Promise<void>;
  handleLLMEnd(output: unknown, runId: string, parentRunId?: string): Promise<void>;
  handleLLMError(error: unknown, runId: string, parentRunId?: string): Promise<void>;
  handleToolStart(tool: unknown, input: string, runId: string, parentRunId?: string): Promise<void>;
  handleToolEnd(output: string, runId: string, parentRunId?: string): Promise<void>;
  handleToolError(error: unknown, runId: string, parentRunId?: string): Promise<void>;
  handleChainStart(
    chain: unknown,
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
  ): Promise<void>;
  handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
  ): Promise<void>;
  handleChainError(error: unknown, runId: string, parentRunId?: string): Promise<void>;
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

  // Initialize adapter
  const adapter = new LangChainAdapter();
  await adapter.initialize({ agentId, sessionId: "", replaySeed });

  // Start session (writes session_start lifecycle event)
  const session: Session = await startSession({
    agentId,
    replaySeed,
    outputPath,
    metadata,
  });

  let sessionEnded = false;

  // Write queue: serializes concurrent callback invocations so that
  // recordEvent calls are sequential and the hash chain stays valid.
  let writeQueue: Promise<void> = Promise.resolve();

  // -------------------------------------------------------------------------
  // Internal: feed a callback event through the adapter and record it
  // -------------------------------------------------------------------------

  function feedEvent(callbackEvent: Record<string, unknown>): void {
    if (sessionEnded) return;

    const traceEvent = adapter.onEvent(callbackEvent);
    if (traceEvent === null) return;

    const currentSession = session;
    writeQueue = writeQueue.then(() =>
      recordEvent(currentSession, {
        event_type: traceEvent.event_type,
        timestamp: traceEvent.timestamp,
        parent_id: traceEvent.parent_id,
        agent_id: traceEvent.agent_id,
        payload: traceEvent.payload,
        metadata: traceEvent.metadata,
      }).then(() => undefined),
    );
  }

  async function awaitQueue(): Promise<void> {
    await writeQueue;
  }

  // -------------------------------------------------------------------------
  // Callback handler — matches LangChain's BaseCallbackHandler signature
  // -------------------------------------------------------------------------

  const handler: LangChainCallbackHandlerMinimal = {
    async handleLLMStart(
      serialized: unknown,
      prompts: string[],
      runId: string,
      parentRunId?: string,
      extraParams?: Record<string, unknown>,
    ): Promise<void> {
      feedEvent({
        _callback: "handleLLMStart",
        serialized,
        prompts,
        runId,
        parentRunId,
        name: (extraParams as Record<string, unknown> | undefined)?.name,
        metadata: (extraParams as Record<string, unknown> | undefined)?.metadata,
      });
      await awaitQueue();
    },

    async handleLLMEnd(output: unknown, runId: string, parentRunId?: string): Promise<void> {
      feedEvent({ _callback: "handleLLMEnd", output, runId, parentRunId });
      await awaitQueue();
    },

    async handleLLMError(error: unknown, runId: string, parentRunId?: string): Promise<void> {
      feedEvent({ _callback: "handleLLMError", error, runId, parentRunId });
      await awaitQueue();
    },

    async handleToolStart(
      tool: unknown,
      input: string,
      runId: string,
      parentRunId?: string,
    ): Promise<void> {
      feedEvent({ _callback: "handleToolStart", tool, input, runId, parentRunId });
      await awaitQueue();
    },

    async handleToolEnd(output: string, runId: string, parentRunId?: string): Promise<void> {
      feedEvent({ _callback: "handleToolEnd", output, runId, parentRunId });
      await awaitQueue();
    },

    async handleToolError(error: unknown, runId: string, parentRunId?: string): Promise<void> {
      feedEvent({ _callback: "handleToolError", error, runId, parentRunId });
      await awaitQueue();
    },

    async handleChainStart(
      chain: unknown,
      inputs: Record<string, unknown>,
      runId: string,
      parentRunId?: string,
    ): Promise<void> {
      feedEvent({ _callback: "handleChainStart", chain, inputs, runId, parentRunId });
      await awaitQueue();
    },

    async handleChainEnd(
      outputs: Record<string, unknown>,
      runId: string,
      parentRunId?: string,
    ): Promise<void> {
      feedEvent({ _callback: "handleChainEnd", outputs, runId, parentRunId });
      await awaitQueue();
    },

    async handleChainError(error: unknown, runId: string, parentRunId?: string): Promise<void> {
      feedEvent({ _callback: "handleChainError", error, runId, parentRunId });
      await awaitQueue();
    },
  };

  // -------------------------------------------------------------------------
  // Control handle
  // -------------------------------------------------------------------------

  const handle: LangChainTracerHandle = {
    async shutdown(): Promise<void> {
      if (sessionEnded) return;
      sessionEnded = true;
      try {
        await writeQueue;
        await endSession(session);
      } catch {
        await destroySession(session);
      }
      await adapter.shutdown();
    },

    getTracePath(): string {
      return outputPath;
    },
  };

  return { handler, handle };
}
