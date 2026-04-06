/**
 * LangChain adapter — translates LangChain callback events into Krynix TraceEvents.
 *
 * Zero runtime dependency on LangChain. This adapter accepts `unknown` input,
 * validates required fields (`_callback`, `runId`), and maps recognized callback events into the Krynix trace format.
 *
 * Usage:
 * ```typescript
 * import { LangChainAdapter } from "@krynix/adapter-langchain";
 *
 * const adapter = new LangChainAdapter();
 * await adapter.initialize({ agentId: "my-agent", sessionId: "s1", replaySeed: 42 });
 *
 * // In a LangChain callback handler:
 * const traceEvent = adapter.onEvent({
 *   _callback: "handleToolStart",
 *   tool: { name: "search" },
 *   input: "query string",
 *   runId: "run-123",
 * });
 * ```
 *
 * @module
 */

import { SCHEMA_VERSION, KrynixError } from "@krynix/core";
import type { TraceAdapter, AdapterConfig, TraceEvent, FinishReason } from "@krynix/core";
import { KNOWN_CALLBACKS } from "./langchain-types.js";
import type { LangChainCallbackEvent } from "./langchain-types.js";

/**
 * Maps a raw LangChain finish_reason string to the canonical FinishReason type.
 *
 * LangChain / provider values that differ from the Krynix schema:
 *   "length"                     → "max_tokens"  (OpenAI token-limit stop)
 *   "tool_calls" | "function_call" → "tool_use"  (OpenAI tool-call stop)
 *
 * Any unknown string or non-string value falls back to "stop".
 */
function normalizeFinishReason(raw: unknown): FinishReason {
  if (raw === "stop" || raw === "max_tokens" || raw === "tool_use") return raw;
  if (raw === "length") return "max_tokens";
  if (raw === "tool_calls" || raw === "function_call") return "tool_use";
  return "stop";
}

/**
 * TraceAdapter implementation for LangChain agent framework.
 *
 * Maps LangChain callbacks to Krynix events:
 * - `handleLLMStart` → `llm_request`
 * - `handleLLMEnd` → `llm_response`
 * - `handleToolStart` → `tool_call`
 * - `handleToolEnd` → `tool_result`
 * - `handleChainStart` → `observation` (chain context)
 * - `handleChainEnd` → `observation` (chain result)
 * - `handleChainError` → `error`
 * - `handleLLMError` → `error`
 * - `handleToolError` → `error`
 */
export class LangChainAdapter implements TraceAdapter {
  readonly name = "langchain";
  readonly version = "1.0.0";

  private config: AdapterConfig | null = null;
  private runIdToToolName = new Map<string, string>();
  private runIdToStartTime = new Map<string, number>();
  onSkippedEvent?: (reason: string, externalEvent: unknown) => void;

  async initialize(config: AdapterConfig): Promise<void> {
    this.runIdToToolName.clear();
    this.runIdToStartTime.clear();
    if (
      config.replaySeed !== undefined &&
      (!Number.isSafeInteger(config.replaySeed) || config.replaySeed <= 0)
    ) {
      throw new KrynixError(
        "INVALID_SEED",
        `replaySeed must be a positive safe integer, got ${String(config.replaySeed)}`,
      );
    }
    this.config = config;
  }

  onEvent(externalEvent: unknown): TraceEvent | null {
    if (externalEvent === null || externalEvent === undefined) {
      this.onSkippedEvent?.("null or undefined event", externalEvent);
      return null;
    }

    if (typeof externalEvent !== "object") {
      this.onSkippedEvent?.("event is not an object", externalEvent);
      return null;
    }

    if (this.config === null) {
      this.onSkippedEvent?.("adapter not initialized", externalEvent);
      return null;
    }

    const raw = externalEvent as Record<string, unknown>;

    if (typeof raw["_callback"] !== "string") {
      this.onSkippedEvent?.("missing or non-string _callback field", externalEvent);
      return null;
    }

    if (!KNOWN_CALLBACKS.has(raw["_callback"])) {
      this.onSkippedEvent?.(`unknown callback: ${raw["_callback"]}`, externalEvent);
      return null;
    }

    if (typeof raw["runId"] !== "string") {
      this.onSkippedEvent?.("missing or non-string runId field", externalEvent);
      return null;
    }

    try {
      const event = externalEvent as LangChainCallbackEvent;
      return this.mapCallbackEvent(event);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.onSkippedEvent?.(`failed to map callback event: ${message}`, externalEvent);
      return null;
    }
  }

  async flush(): Promise<TraceEvent[]> {
    return [];
  }

  async shutdown(): Promise<void> {
    this.runIdToToolName.clear();
    this.runIdToStartTime.clear();
    this.config = null;
  }

  // ---------------------------------------------------------------------------
  // Private mapping
  // ---------------------------------------------------------------------------

  private mapCallbackEvent(event: LangChainCallbackEvent): TraceEvent {
    const base = this.makeBase(event._callback, event.runId, event.parentRunId);

    switch (event._callback) {
      case "handleLLMStart":
        return {
          ...base,
          event_type: "llm_request",
          payload: {
            model: event.name ?? event.serialized?.name ?? "unknown",
            messages: (event.prompts ?? []).map((p) => ({ role: "user", content: p })),
            parameters: {
              ...(event.metadata ?? {}),
            },
          },
        } as unknown as TraceEvent;

      case "handleLLMEnd": {
        const texts = (event.output?.generations ?? []).flat().map((g) => g.text);
        const tokenUsage = event.output?.llmOutput?.tokenUsage;
        const firstGen = (event.output?.generations ?? [])[0]?.[0];
        const finishReason = normalizeFinishReason(firstGen?.generationInfo?.["finish_reason"]);
        return {
          ...base,
          event_type: "llm_response",
          payload: {
            model: event.output?.llmOutput?.model_name ?? "unknown",
            content: texts.join("\n"),
            usage: {
              prompt_tokens: tokenUsage?.promptTokens ?? 0,
              completion_tokens: tokenUsage?.completionTokens ?? 0,
            },
            finish_reason: finishReason,
          },
        } as unknown as TraceEvent;
      }

      case "handleToolStart": {
        const toolName = event.tool?.name ?? "unknown_tool";
        this.runIdToToolName.set(event.runId, toolName);
        this.runIdToStartTime.set(event.runId, Date.now());
        return {
          ...base,
          event_type: "tool_call",
          payload: {
            tool_name: toolName,
            arguments: { input: event.input },
          },
        } as unknown as TraceEvent;
      }

      case "handleToolEnd": {
        const resolvedToolName = this.runIdToToolName.get(event.runId) ?? "unknown_tool";
        const startTime = this.runIdToStartTime.get(event.runId);
        // Real wall-clock duration goes into metadata so OTLP export gets accurate span timing.
        // payload.duration_ms stays 0 because replay --compare deep-compares payload fields,
        // and wall-clock values cause every tool_result to diverge across runs.
        const durationMs = startTime !== undefined ? Date.now() - startTime : 0;
        this.runIdToToolName.delete(event.runId);
        this.runIdToStartTime.delete(event.runId);
        return {
          ...base,
          metadata: { ...base.metadata, "tool.duration_ms": durationMs },
          event_type: "tool_result",
          payload: {
            tool_name: resolvedToolName,
            // Coerce undefined → null: JSON.stringify drops undefined values, which would
            // produce a payload missing the required 'output' field.
            output: event.output ?? null,
            duration_ms: 0,
          },
        } as unknown as TraceEvent;
      }

      case "handleChainStart":
        return {
          ...base,
          event_type: "observation",
          payload: {
            source: "langchain_chain_start",
            content: {
              chain_name: event.chain?.name ?? "unknown_chain",
              inputs: event.inputs,
            },
          },
        } as unknown as TraceEvent;

      case "handleChainEnd":
        return {
          ...base,
          event_type: "observation",
          payload: {
            source: "langchain_chain_end",
            content: {
              outputs: event.outputs,
            },
          },
        } as unknown as TraceEvent;

      case "handleChainError":
        return {
          ...base,
          event_type: "error",
          payload: {
            code: event.error?.name ?? "CHAIN_ERROR",
            message: event.error?.message ?? "Unknown chain error",
            recoverable: false,
          },
        } as unknown as TraceEvent;

      case "handleLLMError":
        return {
          ...base,
          event_type: "error",
          payload: {
            code: event.error?.name ?? "LLM_ERROR",
            message: event.error?.message ?? "Unknown LLM error",
            recoverable: true,
          },
        } as unknown as TraceEvent;

      case "handleToolError": {
        this.runIdToToolName.delete(event.runId);
        this.runIdToStartTime.delete(event.runId);
        return {
          ...base,
          event_type: "error",
          payload: {
            code: event.error?.name ?? "TOOL_ERROR",
            message: event.error?.message ?? "Unknown tool error",
            recoverable: true,
          },
        } as unknown as TraceEvent;
      }

      case "handleAgentAction":
        return {
          ...base,
          event_type: "decision",
          payload: {
            action: event.action?.tool ?? "unknown_action",
            reasoning: event.action?.log ?? "",
          },
        } as unknown as TraceEvent;

      case "handleAgentFinish":
        return {
          ...base,
          event_type: "observation",
          payload: {
            source: "langchain_agent_finish",
            content: {
              output: event.finish?.output,
              log: event.finish?.log,
            },
          },
        } as unknown as TraceEvent;
    }
  }

  private makeBase(
    callbackName: string,
    runId: string,
    parentRunId?: string,
  ): {
    event_id: string;
    session_id: string;
    sequence_num: number;
    timestamp: string;
    parent_id: string | null;
    redacted: boolean;
    prev_hash: string;
    event_hash: string;
    agent_id: string;
    metadata: Record<string, unknown>;
    schema_version: string;
  } {
    return {
      event_id: "",
      session_id: this.config?.sessionId ?? "",
      sequence_num: 0,
      timestamp: new Date().toISOString(),
      parent_id: parentRunId ?? null,
      redacted: false,
      prev_hash: "",
      event_hash: "",
      agent_id: this.config?.agentId ?? "",
      metadata: {
        "runtime.adapter": "langchain",
        "runtime.langchain.callback": callbackName,
        "runtime.langchain.run_id": runId,
        ...(parentRunId !== undefined ? { "runtime.langchain.parent_run_id": parentRunId } : {}),
      },
      schema_version: SCHEMA_VERSION,
    };
  }
}
