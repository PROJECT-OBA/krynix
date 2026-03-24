/**
 * Local type definitions for LangChain callback events.
 *
 * These types describe the shape of LangChain's BaseCallbackHandler events.
 * They are self-contained — no imports from or runtime dependency on LangChain.
 * They exist so the adapter can validate and cast incoming `unknown` events.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// LangChain callback event shapes
// ---------------------------------------------------------------------------

/** Matches the shape of LangChain's handleLLMStart callback data. */
export interface LangChainLlmStartEvent {
  _callback: "handleLLMStart";
  serialized: { name?: string; id?: string[] };
  prompts: string[];
  runId: string;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
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
}

/** Matches the shape of LangChain's handleToolStart callback data. */
export interface LangChainToolStartEvent {
  _callback: "handleToolStart";
  tool: { name?: string; id?: string[] };
  input: string;
  runId: string;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
}

/** Matches the shape of LangChain's handleToolEnd callback data. */
export interface LangChainToolEndEvent {
  _callback: "handleToolEnd";
  output: string;
  runId: string;
  parentRunId?: string;
}

/** Matches the shape of LangChain's handleChainStart callback data. */
export interface LangChainChainStartEvent {
  _callback: "handleChainStart";
  chain: { name?: string; id?: string[] };
  inputs: Record<string, unknown>;
  runId: string;
  parentRunId?: string;
  metadata?: Record<string, unknown>;
}

/** Matches the shape of LangChain's handleChainEnd callback data. */
export interface LangChainChainEndEvent {
  _callback: "handleChainEnd";
  outputs: Record<string, unknown>;
  runId: string;
  parentRunId?: string;
}

/** Matches the shape of LangChain's handleChainError callback data. */
export interface LangChainChainErrorEvent {
  _callback: "handleChainError";
  error: { message: string; name?: string; stack?: string };
  runId: string;
  parentRunId?: string;
}

/** Matches the shape of LangChain's handleLLMError callback data. */
export interface LangChainLlmErrorEvent {
  _callback: "handleLLMError";
  error: { message: string; name?: string; stack?: string };
  runId: string;
  parentRunId?: string;
}

/** Matches the shape of LangChain's handleToolError callback data. */
export interface LangChainToolErrorEvent {
  _callback: "handleToolError";
  error: { message: string; name?: string; stack?: string };
  runId: string;
  parentRunId?: string;
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
  | LangChainToolErrorEvent;

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
]);
