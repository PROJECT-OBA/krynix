/**
 * Local type definitions for LangChain callback events.
 *
 * These types describe the shape of LangChain's BaseCallbackHandler events.
 * They are self-contained — no imports from or runtime dependency on LangChain.
 * They exist so the adapter can validate and cast incoming `unknown` events.
 *
 * Real LangChain (langchain-core) passes a `Serialized` object whose meaningful
 * identifier lives in `id` (e.g. `["langchain", "tools", "Calculator"]`) and a
 * separate `runName` parameter to start callbacks. The legacy `{ name }` shape
 * was a Krynix-internal invention and is kept here only as a lowest-priority
 * fallback for backwards compatibility — the adapter must NOT rely on it for
 * real LangChain output.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// LangChain Serialized shape
// ---------------------------------------------------------------------------

/**
 * The shape LangChain passes as the first argument of `handleLLMStart`,
 * `handleToolStart`, and `handleChainStart`.
 *
 * Real LangChain `Serialized` has `lc`, `type`, `id`, `kwargs`. The class name
 * (e.g. `"Calculator"`, `"ChatOpenAI"`) is the LAST element of `id`.
 *
 * `name` is the legacy Krynix-fictional field and is preserved only so existing
 * mock-shape tests continue to pass — it should not appear in real LangChain
 * traffic.
 */
export interface Serialized {
  lc?: number;
  type?: string;
  id?: string[];
  kwargs?: Record<string, unknown>;
  /** Legacy/test compatibility — real LangChain Serialized does not include `name`. */
  name?: string;
}

// ---------------------------------------------------------------------------
// LangChain callback event shapes
// ---------------------------------------------------------------------------

/** Matches the shape of LangChain's handleLLMStart callback data. */
export interface LangChainLlmStartEvent {
  _callback: "handleLLMStart";
  serialized: Serialized;
  prompts: string[];
  runId: string;
  parentRunId?: string;
  extraParams?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
  runName?: string;
  /** Legacy field — superseded by `runName`. */
  name?: string;
}

/** Matches the shape of LangChain's handleLLMEnd callback data. */
export interface LangChainLlmEndEvent {
  _callback: "handleLLMEnd";
  output: {
    generations: Array<Array<{ text: string; generationInfo?: Record<string, unknown> }>>;
    llmOutput?: {
      tokenUsage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      };
      model_name?: string;
    };
  };
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

/** Matches the shape of LangChain's handleToolStart callback data. */
export interface LangChainToolStartEvent {
  _callback: "handleToolStart";
  tool: Serialized;
  input: string;
  runId: string;
  parentRunId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  runName?: string;
}

/** Matches the shape of LangChain's handleToolEnd callback data. */
export interface LangChainToolEndEvent {
  _callback: "handleToolEnd";
  output: string;
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

/** Matches the shape of LangChain's handleChainStart callback data. */
export interface LangChainChainStartEvent {
  _callback: "handleChainStart";
  chain: Serialized;
  inputs: Record<string, unknown>;
  runId: string;
  parentRunId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  runType?: string;
  runName?: string;
}

/** Matches the shape of LangChain's handleChainEnd callback data. */
export interface LangChainChainEndEvent {
  _callback: "handleChainEnd";
  outputs: Record<string, unknown>;
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

/** Matches the shape of LangChain's handleChainError callback data. */
export interface LangChainChainErrorEvent {
  _callback: "handleChainError";
  error: { message: string; name?: string; stack?: string };
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

/** Matches the shape of LangChain's handleLLMError callback data. */
export interface LangChainLlmErrorEvent {
  _callback: "handleLLMError";
  error: { message: string; name?: string; stack?: string };
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

/** Matches the shape of LangChain's handleToolError callback data. */
export interface LangChainToolErrorEvent {
  _callback: "handleToolError";
  error: { message: string; name?: string; stack?: string };
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

/** Matches the shape of LangChain's handleAgentAction callback data. */
export interface LangChainAgentActionEvent {
  _callback: "handleAgentAction";
  action: { tool: string; toolInput: unknown; log: string };
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

/**
 * Matches the shape of LangChain's `handleAgentEnd` callback data.
 *
 * Internally tagged as `handleAgentFinish` so the discriminated-union switch in
 * the adapter can handle it under a single name. The TS LangChain method is
 * named `handleAgentEnd`; the public handler exposes both names so any version
 * of LangChain (or any consumer using the legacy name) routes correctly.
 */
export interface LangChainAgentFinishEvent {
  _callback: "handleAgentFinish";
  finish: { output: unknown; log: string };
  runId: string;
  parentRunId?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

/** Discriminated union of all LangChain callback events the adapter handles. */
export type LangChainCallbackEvent =
  | LangChainLlmStartEvent
  | LangChainLlmEndEvent
  | LangChainToolStartEvent
  | LangChainToolEndEvent
  | LangChainChainStartEvent
  | LangChainChainEndEvent
  | LangChainChainErrorEvent
  | LangChainLlmErrorEvent
  | LangChainToolErrorEvent
  | LangChainAgentActionEvent
  | LangChainAgentFinishEvent;

/** Known callback names that the adapter handles. */
export const KNOWN_CALLBACKS = new Set([
  "handleLLMStart",
  "handleLLMEnd",
  "handleToolStart",
  "handleToolEnd",
  "handleChainStart",
  "handleChainEnd",
  "handleChainError",
  "handleLLMError",
  "handleToolError",
  "handleAgentAction",
  "handleAgentFinish",
  // Real TS LangChain method is `handleAgentEnd`; the adapter normalises it to
  // the internal `handleAgentFinish` name. Both are accepted here so direct
  // adapter callers don't get a silent drop.
  "handleAgentEnd",
]);
