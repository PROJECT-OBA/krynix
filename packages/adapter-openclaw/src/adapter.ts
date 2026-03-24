/**
 * OpenClaw adapter — translates OpenClaw plugin hook events into Krynix TraceEvents.
 *
 * Zero runtime dependency on OpenClaw. This adapter accepts `unknown` input,
 * validates the shape, and maps recognized hook events into the Krynix trace format.
 *
 * Usage:
 * ```typescript
 * import { OpenClawAdapter } from "@krynix/adapter-openclaw";
 * import type { OpenClawHookEvent } from "@krynix/adapter-openclaw";
 *
 * const adapter = new OpenClawAdapter();
 * await adapter.initialize({ agentId: "my-agent", sessionId: "s1", replaySeed: 42 });
 *
 * // In an OpenClaw plugin:
 * api.on("after_tool_call", (event, context) => {
 *   const hookEvent: OpenClawHookEvent = { _hook: "after_tool_call", event, context };
 *   const traceEvent = adapter.onEvent(hookEvent);
 *   if (traceEvent) { // pass to session manager }
 * });
 * ```
 *
 * @module
 */

import { SCHEMA_VERSION, KrynixError } from "@krynix/core";
import type { TraceAdapter, AdapterConfig, TraceEvent } from "@krynix/core";
import type { OpenClawHookEvent } from "./openclaw-types.js";

/** Known hook names that the adapter handles. */
const KNOWN_HOOKS = new Set([
  "before_tool_call",
  "after_tool_call",
  "llm_input",
  "llm_output",
  "session_start",
  "session_end",
]);

/**
 * TraceAdapter implementation for OpenClaw agent framework.
 *
 * Lifecycle: `initialize → [onEvent...] → flush → shutdown`
 */
export class OpenClawAdapter implements TraceAdapter {
  readonly name = "openclaw";
  readonly version = "1.0.0";

  private config: AdapterConfig | null = null;
  onSkippedEvent?: (reason: string, externalEvent: unknown) => void;

  async initialize(config: AdapterConfig): Promise<void> {
    if (!Number.isSafeInteger(config.replaySeed) || config.replaySeed <= 0) {
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

    // Guard: adapter must be initialized before processing events
    if (this.config === null) {
      this.onSkippedEvent?.("adapter not initialized", externalEvent);
      return null;
    }

    const raw = externalEvent as Record<string, unknown>;

    if (typeof raw["_hook"] !== "string") {
      this.onSkippedEvent?.("missing or non-string _hook field", externalEvent);
      return null;
    }

    if (!KNOWN_HOOKS.has(raw["_hook"])) {
      this.onSkippedEvent?.(`unknown hook type: ${raw["_hook"]}`, externalEvent);
      return null;
    }

    const hookEvent = externalEvent as OpenClawHookEvent;
    return this.mapHookEvent(hookEvent);
  }

  async flush(): Promise<TraceEvent[]> {
    return [];
  }

  async shutdown(): Promise<void> {
    this.config = null;
  }

  // ---------------------------------------------------------------------------
  // Private mapping
  // ---------------------------------------------------------------------------

  private mapHookEvent(hookEvent: OpenClawHookEvent): TraceEvent {
    const agentId = this.resolveAgentId(hookEvent);
    const base = this.makeBase(agentId, hookEvent._hook);

    switch (hookEvent._hook) {
      case "before_tool_call":
        return {
          ...base,
          event_type: "tool_call",
          payload: {
            tool_name: hookEvent.event.toolName,
            arguments: hookEvent.event.params,
          },
        } as unknown as TraceEvent;

      case "after_tool_call":
        return {
          ...base,
          event_type: "tool_result",
          payload: {
            tool_name: hookEvent.event.toolName,
            output: hookEvent.event.error ?? hookEvent.event.result ?? null,
            duration_ms: hookEvent.event.durationMs ?? 0,
          },
          metadata: {
            ...base.metadata,
            ...(hookEvent.event.error ? { "runtime.openclaw.error": true } : {}),
          },
        } as unknown as TraceEvent;

      case "llm_input": {
        const parameters: Record<string, unknown> = {
          provider: hookEvent.event.provider,
          prompt: hookEvent.event.prompt,
          imagesCount: hookEvent.event.imagesCount,
        };
        if (hookEvent.event.systemPrompt !== undefined) {
          parameters["systemPrompt"] = hookEvent.event.systemPrompt;
        }
        return {
          ...base,
          event_type: "llm_request",
          payload: {
            model: hookEvent.event.model,
            messages: hookEvent.event.historyMessages,
            parameters,
          },
        } as unknown as TraceEvent;
      }

      case "llm_output":
        return {
          ...base,
          event_type: "llm_response",
          payload: {
            model: hookEvent.event.model,
            content: hookEvent.event.assistantTexts.join("\n"),
            usage: {
              prompt_tokens: hookEvent.event.usage?.input ?? 0,
              completion_tokens: hookEvent.event.usage?.output ?? 0,
            },
            finish_reason: "stop",
          },
        } as unknown as TraceEvent;

      case "session_start": {
        const context: Record<string, unknown> = {};
        if (hookEvent.event.resumedFrom !== undefined) {
          context["resumedFrom"] = hookEvent.event.resumedFrom;
        }
        return {
          ...base,
          event_type: "lifecycle",
          payload: {
            action: "session_start" as const,
            context,
          },
        } as unknown as TraceEvent;
      }

      case "session_end": {
        const endContext: Record<string, unknown> = {
          messageCount: hookEvent.event.messageCount,
        };
        if (hookEvent.event.durationMs !== undefined) {
          endContext["durationMs"] = hookEvent.event.durationMs;
        }
        return {
          ...base,
          event_type: "lifecycle",
          payload: {
            action: "session_end" as const,
            context: endContext,
          },
        } as unknown as TraceEvent;
      }
    }
  }

  private makeBase(
    agentId: string,
    hookName: string,
  ): {
    event_id: string;
    session_id: string;
    sequence_num: number;
    timestamp: string;
    parent_id: null;
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
      parent_id: null,
      redacted: false,
      prev_hash: "",
      event_hash: "",
      agent_id: agentId,
      metadata: {
        "runtime.adapter": "openclaw",
        "runtime.openclaw.hook": hookName,
      },
      schema_version: SCHEMA_VERSION,
    };
  }

  private resolveAgentId(hookEvent: OpenClawHookEvent): string {
    const contextAgentId = hookEvent.context.agentId;
    if (typeof contextAgentId === "string" && contextAgentId.length > 0) {
      return contextAgentId;
    }
    return this.config?.agentId ?? "";
  }
}
