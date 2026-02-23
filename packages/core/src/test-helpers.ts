/**
 * Factory functions for building valid TraceEvent objects in tests.
 *
 * NOT exported from index.ts — these are internal test utilities only.
 *
 * @module
 */

import type {
  TraceEvent,
  EventType,
  ToolCallPayload,
  ToolResultPayload,
  LlmRequestPayload,
  LlmResponsePayload,
  DecisionPayload,
  ObservationPayload,
  ErrorPayload,
  LifecyclePayload,
  TraceEventBase,
} from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

const DEFAULT_SESSION_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const DEFAULT_AGENT_ID = "test-agent";

interface BaseOverrides {
  event_id?: string;
  session_id?: string;
  sequence_num?: number;
  timestamp?: string;
  parent_id?: string | null;
  agent_id?: string;
  redacted?: boolean;
  prev_hash?: string;
  event_hash?: string;
  metadata?: Record<string, unknown> | null;
  schema_version?: string;
}

function makeBase(seq: number, overrides: BaseOverrides = {}): BaseOverrides {
  return {
    event_id:
      overrides.event_id ?? `550e8400-e29b-41d4-a716-44665544${String(seq).padStart(4, "0")}`,
    session_id: overrides.session_id ?? DEFAULT_SESSION_ID,
    sequence_num: overrides.sequence_num ?? seq,
    timestamp: overrides.timestamp ?? `2025-01-15T14:00:${String(seq).padStart(2, "0")}.000Z`,
    parent_id: overrides.parent_id ?? null,
    agent_id: overrides.agent_id ?? DEFAULT_AGENT_ID,
    redacted: overrides.redacted ?? false,
    prev_hash: overrides.prev_hash ?? "",
    event_hash: overrides.event_hash ?? "",
    metadata: overrides.metadata ?? null,
    schema_version: overrides.schema_version ?? SCHEMA_VERSION,
  };
}

/** Create a `tool_call` TraceEvent. */
export function makeToolCall(
  seq: number,
  payload?: Partial<ToolCallPayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"tool_call", ToolCallPayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "tool_call",
    payload: {
      tool_name: payload?.tool_name ?? "file_read",
      arguments: payload?.arguments ?? { path: "/tmp/test.txt" },
      ...(payload?.approval_status !== undefined
        ? { approval_status: payload.approval_status }
        : {}),
    },
  } as TraceEventBase<"tool_call", ToolCallPayload>;
}

/** Create a `tool_result` TraceEvent. */
export function makeToolResult(
  seq: number,
  payload?: Partial<ToolResultPayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"tool_result", ToolResultPayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "tool_result",
    payload: {
      tool_name: payload?.tool_name ?? "file_read",
      output: payload?.output ?? { content: "hello" },
      duration_ms: payload?.duration_ms ?? 12,
      ...(payload?.exit_code !== undefined ? { exit_code: payload.exit_code } : {}),
    },
  } as TraceEventBase<"tool_result", ToolResultPayload>;
}

/** Create an `llm_request` TraceEvent. */
export function makeLlmRequest(
  seq: number,
  payload?: Partial<LlmRequestPayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"llm_request", LlmRequestPayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "llm_request",
    payload: {
      model: payload?.model ?? "claude-opus-4-5-20251101",
      messages: payload?.messages ?? [{ role: "user", content: "Hello" }],
      parameters: payload?.parameters ?? { temperature: 0, max_tokens: 1024 },
    },
  } as TraceEventBase<"llm_request", LlmRequestPayload>;
}

/** Create an `llm_response` TraceEvent. */
export function makeLlmResponse(
  seq: number,
  payload?: Partial<LlmResponsePayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"llm_response", LlmResponsePayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "llm_response",
    payload: {
      model: payload?.model ?? "claude-opus-4-5-20251101",
      content: payload?.content ?? "Response text",
      usage: payload?.usage ?? { prompt_tokens: 150, completion_tokens: 42 },
      finish_reason: payload?.finish_reason ?? "stop",
    },
  } as TraceEventBase<"llm_response", LlmResponsePayload>;
}

/** Create a `decision` TraceEvent. */
export function makeDecision(
  seq: number,
  payload?: Partial<DecisionPayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"decision", DecisionPayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "decision",
    payload: {
      action: payload?.action ?? "write_file",
      reasoning: payload?.reasoning ?? "The user requested this action.",
      ...(payload?.confidence !== undefined ? { confidence: payload.confidence } : {}),
    },
  } as TraceEventBase<"decision", DecisionPayload>;
}

/** Create an `observation` TraceEvent. */
export function makeObservation(
  seq: number,
  payload?: Partial<ObservationPayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"observation", ObservationPayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "observation",
    payload: {
      source: payload?.source ?? "file_system",
      content: payload?.content ?? { path: "/src/index.ts", exists: true },
    },
  } as TraceEventBase<"observation", ObservationPayload>;
}

/** Create an `error` TraceEvent. */
export function makeError(
  seq: number,
  payload?: Partial<ErrorPayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"error", ErrorPayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "error",
    payload: {
      code: payload?.code ?? "TOOL_TIMEOUT",
      message: payload?.message ?? "shell_exec exceeded 30s timeout",
      recoverable: payload?.recoverable ?? true,
    },
  } as TraceEventBase<"error", ErrorPayload>;
}

/** Create a `lifecycle` TraceEvent. */
export function makeLifecycle(
  seq: number,
  payload?: Partial<LifecyclePayload>,
  overrides?: BaseOverrides,
): TraceEventBase<"lifecycle", LifecyclePayload> {
  return {
    ...makeBase(seq, overrides),
    event_type: "lifecycle",
    payload: {
      action: payload?.action ?? "session_start",
      ...(payload?.context !== undefined ? { context: payload.context } : {}),
    },
  } as TraceEventBase<"lifecycle", LifecyclePayload>;
}

/** Create a `lifecycle:session_start` event (convenience). */
export function makeSessionStart(
  overrides?: BaseOverrides,
): TraceEventBase<"lifecycle", LifecyclePayload> {
  return makeLifecycle(
    overrides?.sequence_num ?? 0,
    {
      action: "session_start",
      context: { replay_seed: 42, agent_version: "0.1.0" },
    },
    overrides,
  );
}

/** Create a `lifecycle:session_end` event (convenience). */
export function makeSessionEnd(
  seq: number,
  overrides?: BaseOverrides,
): TraceEventBase<"lifecycle", LifecyclePayload> {
  return makeLifecycle(seq, { action: "session_end" }, overrides);
}

/**
 * Create any TraceEvent variant by event type.
 *
 * Uses sensible defaults for payload fields that are not provided.
 */
export function makeTraceEvent(
  eventType: EventType,
  seq: number,
  overrides?: BaseOverrides,
): TraceEvent {
  switch (eventType) {
    case "tool_call":
      return makeToolCall(seq, undefined, overrides);
    case "tool_result":
      return makeToolResult(seq, undefined, overrides);
    case "llm_request":
      return makeLlmRequest(seq, undefined, overrides);
    case "llm_response":
      return makeLlmResponse(seq, undefined, overrides);
    case "decision":
      return makeDecision(seq, undefined, overrides);
    case "observation":
      return makeObservation(seq, undefined, overrides);
    case "error":
      return makeError(seq, undefined, overrides);
    case "lifecycle":
      return makeLifecycle(seq, undefined, overrides);
  }
}
