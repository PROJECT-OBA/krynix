/**
 * Production-ready OpenClaw plugin for Krynix.
 *
 * Creates a plugin function compatible with OpenClaw's `OpenClawPluginModule` type.
 * Registers hooks for all 6 supported event types, manages session lifecycle,
 * and writes a complete trace file with hash chain.
 *
 * Zero runtime dependency on OpenClaw — uses a locally-defined `OpenClawPluginApiMinimal`
 * interface that is structurally compatible with OpenClaw's `OpenClawPluginApi`.
 *
 * Usage:
 * ```typescript
 * import { createKrynixPlugin } from "@krynix/adapter-openclaw";
 *
 * // In an OpenClaw extensions/krynix/index.ts:
 * export default createKrynixPlugin({ outputPath: "./trace.jsonl" });
 * ```
 *
 * @module
 */

import { startSession, recordEvent, endSession, destroySession } from "@krynix/core";
import type { Session } from "@krynix/core";
import { OpenClawAdapter } from "./adapter.js";
import type { OpenClawHookEvent } from "./openclaw-types.js";

// ---------------------------------------------------------------------------
// Minimal OpenClaw plugin API type — structurally compatible, zero import
// ---------------------------------------------------------------------------

/**
 * Minimal interface for OpenClaw's plugin API.
 *
 * OpenClaw's full `OpenClawPluginApi` is a superset of this interface.
 * We only need `on()` to register hook listeners.
 */
export interface OpenClawPluginApiMinimal {
  on(
    hookName: string,
    handler: (event: unknown, context: unknown) => unknown | Promise<unknown>,
    options?: { priority?: number },
  ): void;
}

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

/** Configuration for the Krynix OpenClaw plugin. */
export interface KrynixPluginOptions {
  /** Output path for the trace file. */
  outputPath: string;
  /** Replay seed for deterministic trace generation. */
  replaySeed?: number;
  /** Agent ID for this session (defaults to "openclaw-agent"). */
  agentId?: string;
  /** Session metadata included in the session_start event context. */
  metadata?: Record<string, unknown>;
}

/** Handle returned by the plugin for programmatic control. */
export interface KrynixPluginHandle {
  /** Shut down the plugin, ending the session and closing the trace file. */
  shutdown(): Promise<void>;
  /** Get the output trace file path. */
  getTracePath(): string;
}

// ---------------------------------------------------------------------------
// Hook names
// ---------------------------------------------------------------------------

const HOOK_NAMES = [
  "session_start",
  "session_end",
  "before_tool_call",
  "after_tool_call",
  "llm_input",
  "llm_output",
] as const;

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Create a Krynix plugin for OpenClaw.
 *
 * Returns a plugin initializer function compatible with OpenClaw's plugin system.
 * The initializer receives the plugin API, registers hooks, and returns a handle.
 *
 * @param options - Plugin configuration
 * @returns Plugin initializer function
 * @throws {Error} If `outputPath` is missing
 */
export function createKrynixPlugin(
  options: KrynixPluginOptions,
): (api: OpenClawPluginApiMinimal) => Promise<KrynixPluginHandle> {
  if (!options || typeof options.outputPath !== "string" || options.outputPath.length === 0) {
    throw new Error("KrynixPlugin: outputPath is required");
  }

  const { outputPath, replaySeed, agentId = "openclaw-agent", metadata } = options;

  return async (api: OpenClawPluginApiMinimal): Promise<KrynixPluginHandle> => {
    const adapter = new OpenClawAdapter();
    let session: Session | null = null;
    let sessionEnded = false;

    // Write queue: serializes concurrent hook invocations so that
    // recordEvent calls are sequential and the hash chain stays valid.
    // OpenClaw fires void hooks (e.g. after_tool_call) in parallel,
    // so without this queue concurrent writes would corrupt prev_hash ordering.
    let writeQueue: Promise<void> = Promise.resolve();

    // Initialize adapter (sessionId will be overwritten by startSession)
    await adapter.initialize({
      agentId,
      sessionId: "",
      replaySeed: replaySeed ?? 0,
    });

    // Start the Krynix session immediately so we capture all events
    session = await startSession({
      agentId,
      replaySeed,
      outputPath,
      metadata,
    });

    // -----------------------------------------------------------------------
    // Hook handler: translates OpenClaw events → Krynix trace events
    // -----------------------------------------------------------------------

    async function handleHook(hookName: string, event: unknown, context: unknown): Promise<void> {
      if (sessionEnded || session === null) {
        return;
      }

      const hookEvent: OpenClawHookEvent = {
        _hook: hookName,
        event,
        context,
      } as OpenClawHookEvent;

      const traceEvent = adapter.onEvent(hookEvent);
      if (traceEvent === null) {
        return;
      }

      // Enqueue write to ensure sequential ordering
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
      await writeQueue;
    }

    // -----------------------------------------------------------------------
    // Register all 6 hook types
    // -----------------------------------------------------------------------

    for (const hookName of HOOK_NAMES) {
      if (hookName === "session_end") {
        // session_end requires special handling: end session after recording
        api.on(hookName, async (event: unknown, context: unknown) => {
          await handleHook(hookName, event, context);
          if (session !== null && !sessionEnded) {
            sessionEnded = true;
            // Wait for any in-flight writes before ending
            await writeQueue;
            await endSession(session);
          }
        });
      } else {
        api.on(hookName, async (event: unknown, context: unknown) => {
          await handleHook(hookName, event, context);
        });
      }
    }

    // -----------------------------------------------------------------------
    // Plugin handle
    // -----------------------------------------------------------------------

    return {
      async shutdown(): Promise<void> {
        if (session !== null && !sessionEnded) {
          sessionEnded = true;
          try {
            // Drain in-flight writes before ending the session
            await writeQueue;
            await endSession(session);
          } catch {
            // If endSession fails (e.g., already closed), destroy instead
            await destroySession(session);
          }
        }
        await adapter.shutdown();
      },

      getTracePath(): string {
        return outputPath;
      },
    };
  };
}
