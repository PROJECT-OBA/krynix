import { describe, test, expect, expectTypeOf } from "vitest";
import type {
  TraceEvent,
  TraceEventBase,
  EventType,
  ToolCallPayload,
  ToolResultPayload,
  LlmRequestPayload,
  LlmResponsePayload,
  DecisionPayload,
  ObservationPayload,
  ErrorPayload,
  LifecyclePayload,
  ApprovalStatus,
  FinishReason,
  LifecycleAction,
  ValidationResult,
  PayloadMap,
  LlmUsage,
} from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import {
  makeToolCall,
  makeToolResult,
  makeLlmRequest,
  makeLlmResponse,
  makeDecision,
  makeObservation,
  makeError,
  makeLifecycle,
  makeSessionStart,
  makeSessionEnd,
  makeTraceEvent,
} from "./test-helpers.js";

describe("TraceEvent type definitions", () => {
  test("SCHEMA_VERSION is '1.1.0'", () => {
    expectTypeOf(SCHEMA_VERSION).toEqualTypeOf<"1.1.0">();
  });

  test("EventType is a union of 8 string literals", () => {
    expectTypeOf<EventType>().toEqualTypeOf<
      | "tool_call"
      | "tool_result"
      | "llm_request"
      | "llm_response"
      | "decision"
      | "observation"
      | "error"
      | "lifecycle"
    >();
  });

  test("ApprovalStatus is a union of 3 string literals", () => {
    expectTypeOf<ApprovalStatus>().toEqualTypeOf<"auto" | "manual" | "denied">();
  });

  test("FinishReason is a union of 3 string literals", () => {
    expectTypeOf<FinishReason>().toEqualTypeOf<"stop" | "max_tokens" | "tool_use">();
  });

  test("LifecycleAction is a union of 3 string literals", () => {
    expectTypeOf<LifecycleAction>().toEqualTypeOf<"session_start" | "session_end" | "checkpoint">();
  });

  test("ValidationResult has expected shape", () => {
    expectTypeOf<ValidationResult>().toHaveProperty("valid");
    expectTypeOf<ValidationResult["valid"]>().toBeBoolean();
    expectTypeOf<ValidationResult["brokenAt"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ValidationResult["error"]>().toEqualTypeOf<string | undefined>();
  });

  test("LlmUsage has prompt_tokens and completion_tokens", () => {
    expectTypeOf<LlmUsage>().toHaveProperty("prompt_tokens");
    expectTypeOf<LlmUsage>().toHaveProperty("completion_tokens");
    expectTypeOf<LlmUsage["prompt_tokens"]>().toBeNumber();
  });

  test("LlmUsage has optional total_tokens and estimated_cost", () => {
    expectTypeOf<LlmUsage["total_tokens"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LlmUsage["estimated_cost"]>().toEqualTypeOf<number | undefined>();
  });

  test("ToolCallPayload has optional approved_by and approval_reason", () => {
    expectTypeOf<ToolCallPayload["approved_by"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ToolCallPayload["approval_reason"]>().toEqualTypeOf<string | undefined>();
  });

  test("LlmResponsePayload has optional is_streaming", () => {
    expectTypeOf<LlmResponsePayload["is_streaming"]>().toEqualTypeOf<boolean | undefined>();
  });

  test("PayloadMap maps each EventType to its payload", () => {
    expectTypeOf<PayloadMap["tool_call"]>().toEqualTypeOf<ToolCallPayload>();
    expectTypeOf<PayloadMap["tool_result"]>().toEqualTypeOf<ToolResultPayload>();
    expectTypeOf<PayloadMap["llm_request"]>().toEqualTypeOf<LlmRequestPayload>();
    expectTypeOf<PayloadMap["llm_response"]>().toEqualTypeOf<LlmResponsePayload>();
    expectTypeOf<PayloadMap["decision"]>().toEqualTypeOf<DecisionPayload>();
    expectTypeOf<PayloadMap["observation"]>().toEqualTypeOf<ObservationPayload>();
    expectTypeOf<PayloadMap["error"]>().toEqualTypeOf<ErrorPayload>();
    expectTypeOf<PayloadMap["lifecycle"]>().toEqualTypeOf<LifecyclePayload>();
  });
});

describe("TraceEvent discriminated union narrowing", () => {
  test("narrowing on tool_call gives ToolCallPayload", () => {
    const event = makeToolCall(0);
    if (event.event_type === "tool_call") {
      expectTypeOf(event.payload).toEqualTypeOf<ToolCallPayload>();
      expectTypeOf(event.payload.tool_name).toBeString();
    }
  });

  test("narrowing on tool_result gives ToolResultPayload", () => {
    const event = makeToolResult(1);
    if (event.event_type === "tool_result") {
      expectTypeOf(event.payload).toEqualTypeOf<ToolResultPayload>();
      expectTypeOf(event.payload.duration_ms).toBeNumber();
    }
  });

  test("narrowing on llm_request gives LlmRequestPayload", () => {
    const event = makeLlmRequest(1);
    if (event.event_type === "llm_request") {
      expectTypeOf(event.payload).toEqualTypeOf<LlmRequestPayload>();
      expectTypeOf(event.payload.model).toBeString();
    }
  });

  test("narrowing on llm_response gives LlmResponsePayload", () => {
    const event = makeLlmResponse(1);
    if (event.event_type === "llm_response") {
      expectTypeOf(event.payload).toEqualTypeOf<LlmResponsePayload>();
      expectTypeOf(event.payload.usage).toEqualTypeOf<LlmUsage>();
    }
  });

  test("narrowing on decision gives DecisionPayload", () => {
    const event = makeDecision(1);
    if (event.event_type === "decision") {
      expectTypeOf(event.payload).toEqualTypeOf<DecisionPayload>();
      expectTypeOf(event.payload.reasoning).toBeString();
    }
  });

  test("narrowing on observation gives ObservationPayload", () => {
    const event = makeObservation(1);
    if (event.event_type === "observation") {
      expectTypeOf(event.payload).toEqualTypeOf<ObservationPayload>();
      expectTypeOf(event.payload.source).toBeString();
    }
  });

  test("narrowing on error gives ErrorPayload", () => {
    const event = makeError(1);
    if (event.event_type === "error") {
      expectTypeOf(event.payload).toEqualTypeOf<ErrorPayload>();
      expectTypeOf(event.payload.recoverable).toBeBoolean();
    }
  });

  test("narrowing on lifecycle gives LifecyclePayload", () => {
    const event = makeLifecycle(0);
    if (event.event_type === "lifecycle") {
      expectTypeOf(event.payload).toEqualTypeOf<LifecyclePayload>();
      expectTypeOf(event.payload.action).toEqualTypeOf<LifecycleAction>();
    }
  });
});

describe("TraceEventBase common fields", () => {
  test("all common fields have correct types", () => {
    type Base = TraceEventBase<"tool_call", ToolCallPayload>;
    expectTypeOf<Base["event_id"]>().toBeString();
    expectTypeOf<Base["session_id"]>().toBeString();
    expectTypeOf<Base["sequence_num"]>().toBeNumber();
    expectTypeOf<Base["timestamp"]>().toBeString();
    expectTypeOf<Base["event_type"]>().toEqualTypeOf<"tool_call">();
    expectTypeOf<Base["parent_id"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Base["agent_id"]>().toBeString();
    expectTypeOf<Base["redacted"]>().toBeBoolean();
    expectTypeOf<Base["prev_hash"]>().toBeString();
    expectTypeOf<Base["event_hash"]>().toBeString();
    expectTypeOf<Base["metadata"]>().toEqualTypeOf<Record<string, unknown> | null>();
    expectTypeOf<Base["schema_version"]>().toBeString();
  });
});

describe("TraceEvent satisfies checks (compile-time validation)", () => {
  test("valid tool_call event satisfies TraceEvent", () => {
    const event = makeToolCall(0);
    const _check: TraceEvent = event;
    expectTypeOf(_check).toMatchTypeOf<TraceEvent>();
  });

  test("valid lifecycle session_start satisfies TraceEvent", () => {
    const event = makeSessionStart();
    const _check: TraceEvent = event;
    expectTypeOf(_check).toMatchTypeOf<TraceEvent>();
  });

  test("valid lifecycle session_end satisfies TraceEvent", () => {
    const event = makeSessionEnd(5);
    const _check: TraceEvent = event;
    expectTypeOf(_check).toMatchTypeOf<TraceEvent>();
  });
});

describe("test helper factories produce valid objects", () => {
  test("makeTraceEvent creates events for all 8 types", () => {
    const types: EventType[] = [
      "tool_call",
      "tool_result",
      "llm_request",
      "llm_response",
      "decision",
      "observation",
      "error",
      "lifecycle",
    ];
    for (const t of types) {
      const event = makeTraceEvent(t, 0);
      expect(event.event_type).toBe(t);
      // Pin to the exported constant rather than a literal so the
      // 1.x bumps don't require touching this assertion.
      expect(event.schema_version).toBe(SCHEMA_VERSION);
      expect(event.session_id).toBeDefined();
      expect(event.event_id).toBeDefined();
      expect(event.agent_id).toBeDefined();
      expect(event.payload).toBeDefined();
    }
  });

  test("makeSessionStart defaults to sequence 0 with session_start action", () => {
    const event = makeSessionStart();
    expect(event.sequence_num).toBe(0);
    expect(event.event_type).toBe("lifecycle");
    expect(event.payload.action).toBe("session_start");
  });

  test("makeSessionEnd has session_end action", () => {
    const event = makeSessionEnd(5);
    expect(event.sequence_num).toBe(5);
    expect(event.payload.action).toBe("session_end");
  });

  test("factory overrides are applied", () => {
    const event = makeToolCall(
      3,
      { tool_name: "shell_exec" },
      {
        agent_id: "custom-agent",
        session_id: "custom-session",
      },
    );
    expect(event.payload.tool_name).toBe("shell_exec");
    expect(event.agent_id).toBe("custom-agent");
    expect(event.session_id).toBe("custom-session");
    expect(event.sequence_num).toBe(3);
  });
});
