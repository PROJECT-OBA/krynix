/**
 * Local type definitions for OpenClaw plugin hook events.
 *
 * These types describe the shape of OpenClaw's plugin hook events.
 * They are self-contained — no imports from or runtime dependency on OpenClaw.
 * They exist so the adapter can validate and cast incoming `unknown` events.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Hook event payloads — matches the shape of OpenClaw's plugin hooks
// ---------------------------------------------------------------------------

/** Matches the shape of OpenClaw's before_tool_call hook event. */
export interface OpenClawBeforeToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
}

/** Matches the shape of OpenClaw's after_tool_call hook event. */
export interface OpenClawAfterToolCallEvent {
  toolName: string;
  params: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
}

/** Matches the shape of OpenClaw's llm_input hook event. */
export interface OpenClawLlmInputEvent {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  prompt: string;
  historyMessages: unknown[];
  imagesCount: number;
}

/** Matches the shape of OpenClaw's llm_output hook event. */
export interface OpenClawLlmOutputEvent {
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  assistantTexts: string[];
  lastAssistant?: unknown;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

/** Matches the shape of OpenClaw's session_start hook event. */
export interface OpenClawSessionStartEvent {
  sessionId: string;
  resumedFrom?: string;
}

/** Matches the shape of OpenClaw's session_end hook event. */
export interface OpenClawSessionEndEvent {
  sessionId: string;
  messageCount: number;
  durationMs?: number;
}

// ---------------------------------------------------------------------------
// Hook contexts — matches the shape of OpenClaw's hook context objects
// ---------------------------------------------------------------------------

/** Matches the shape of OpenClaw's tool hook context. */
export interface OpenClawToolContext {
  agentId?: string;
  sessionKey?: string;
  toolName: string;
}

/** Matches the shape of OpenClaw's agent hook context. */
export interface OpenClawAgentContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
}

/** Matches the shape of OpenClaw's session hook context. */
export interface OpenClawSessionContext {
  agentId?: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Discriminated union — the _hook field matches OpenClaw's PluginHookName
// ---------------------------------------------------------------------------

/** Discriminated union of all OpenClaw hook events the adapter handles. */
export type OpenClawHookEvent =
  | {
      _hook: "before_tool_call";
      event: OpenClawBeforeToolCallEvent;
      context: OpenClawToolContext;
    }
  | {
      _hook: "after_tool_call";
      event: OpenClawAfterToolCallEvent;
      context: OpenClawToolContext;
    }
  | { _hook: "llm_input"; event: OpenClawLlmInputEvent; context: OpenClawAgentContext }
  | {
      _hook: "llm_output";
      event: OpenClawLlmOutputEvent;
      context: OpenClawAgentContext;
    }
  | {
      _hook: "session_start";
      event: OpenClawSessionStartEvent;
      context: OpenClawSessionContext;
    }
  | {
      _hook: "session_end";
      event: OpenClawSessionEndEvent;
      context: OpenClawSessionContext;
    };
