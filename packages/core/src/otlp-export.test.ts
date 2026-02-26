/**
 * Tests for OTLP trace export (`convertToOtlp`).
 */

import { describe, test, expect } from "vitest";
import { convertToOtlp } from "./otlp-export.js";
import type { OtlpSpan } from "./otlp-export.js";
import {
  makeToolCall,
  makeToolResult,
  makeLlmResponse,
  makeError,
  makeSessionStart,
  makeSessionEnd,
} from "./test-helpers.js";
import { computeHashChain } from "./hash-chain.js";
import type { TraceEvent } from "./types.js";

/** Hash-chain a list of events so they have valid hashes. */
function chain(events: TraceEvent[]): TraceEvent[] {
  return computeHashChain(events);
}

describe("convertToOtlp", () => {
  test("empty trace returns valid structure with empty spans", () => {
    const result = convertToOtlp([]);
    expect(result.resourceSpans).toHaveLength(1);
    expect(result.resourceSpans[0]?.scopeSpans).toHaveLength(1);
    expect(result.resourceSpans[0]?.scopeSpans[0]?.spans).toHaveLength(0);
    expect(result.resourceSpans[0]?.scopeSpans[0]?.scope.name).toBe("krynix");
  });

  test("single event produces correct traceId (UUID without dashes, 32 chars)", () => {
    const events = chain([makeToolCall(0)]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
    // Should be the session_id without dashes
    const expectedTraceId = events[0]?.session_id.replace(/-/g, "");
    expect(span.traceId).toBe(expectedTraceId);
  });

  test("single event produces correct spanId (first 16 hex chars)", () => {
    const events = chain([makeToolCall(0)]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    // Should be the first 16 hex chars of event_id without dashes
    const expectedSpanId = events[0]?.event_id.replace(/-/g, "").slice(0, 16);
    expect(span.spanId).toBe(expectedSpanId);
  });

  test("event with parent_id maps parentSpanId correctly", () => {
    const parentId = "550e8400-e29b-41d4-a716-446655440001";
    const events = chain([makeToolCall(0, undefined, { parent_id: parentId })]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    const expectedParentSpanId = parentId.replace(/-/g, "").slice(0, 16);
    expect(span.parentSpanId).toBe(expectedParentSpanId);
  });

  test("event without parent_id has empty parentSpanId", () => {
    const events = chain([makeToolCall(0)]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    expect(span.parentSpanId).toBe("");
  });

  test("timestamp converted to nanoseconds as string", () => {
    const events = chain([makeToolCall(0, undefined, { timestamp: "2025-01-15T14:00:00.000Z" })]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    // 2025-01-15T14:00:00.000Z in ms = 1736949600000
    // In nanoseconds = 1736949600000000000
    const expectedMs = new Date("2025-01-15T14:00:00.000Z").getTime();
    const expectedNano = (BigInt(expectedMs) * 1_000_000n).toString();
    expect(span.startTimeUnixNano).toBe(expectedNano);
    // Verify it's a valid numeric string
    expect(BigInt(span.startTimeUnixNano)).toBeGreaterThan(0n);
  });

  test("tool_result with duration_ms has correct endTimeUnixNano", () => {
    const events = chain([
      makeToolResult(0, { duration_ms: 500 }, { timestamp: "2025-01-15T14:00:00.000Z" }),
    ]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    const startMs = new Date("2025-01-15T14:00:00.000Z").getTime();
    const endMs = startMs + 500;
    const expectedEndNano = (BigInt(endMs) * 1_000_000n).toString();
    expect(span.endTimeUnixNano).toBe(expectedEndNano);
    // endTime should be greater than startTime
    expect(BigInt(span.endTimeUnixNano)).toBeGreaterThan(BigInt(span.startTimeUnixNano));
  });

  test("non-tool_result event has endTimeUnixNano equal to startTimeUnixNano", () => {
    const events = chain([makeToolCall(0)]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    expect(span.endTimeUnixNano).toBe(span.startTimeUnixNano);
  });

  test("error event has status code 2 (ERROR) with message", () => {
    const events = chain([
      makeError(0, { code: "TOOL_TIMEOUT", message: "shell_exec timed out", recoverable: true }),
    ]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe("shell_exec timed out");
    expect(span.name).toBe("error");
  });

  test("non-error event has status code 0 (UNSET)", () => {
    const events = chain([makeToolCall(0)]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    expect(span.status.code).toBe(0);
    expect(span.status.message).toBeUndefined();
  });

  test("payload attributes flattened with krynix prefix", () => {
    const events = chain([
      makeToolCall(0, { tool_name: "file_read", arguments: { path: "/tmp" } }),
    ]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    const toolNameAttr = span.attributes.find((a) => a.key === "krynix.tool_name");
    expect(toolNameAttr).toBeDefined();
    expect(toolNameAttr?.value.stringValue).toBe("file_read");

    // nested object serialized as JSON string
    const argsAttr = span.attributes.find((a) => a.key === "krynix.arguments");
    expect(argsAttr).toBeDefined();
    expect(argsAttr?.value.stringValue).toBe(JSON.stringify({ path: "/tmp" }));
  });

  test("resource attributes include service.name, agent.id, session.id", () => {
    const events = chain([makeToolCall(0)]);
    const result = convertToOtlp(events);
    const resource = result.resourceSpans[0]?.resource;

    const serviceAttr = resource?.attributes.find((a) => a.key === "service.name");
    expect(serviceAttr?.value.stringValue).toBe("krynix");

    const agentAttr = resource?.attributes.find((a) => a.key === "agent.id");
    expect(agentAttr).toBeDefined();
    expect(agentAttr?.value.stringValue).toBe(events[0]?.agent_id);

    const sessionAttr = resource?.attributes.find((a) => a.key === "session.id");
    expect(sessionAttr).toBeDefined();
    expect(sessionAttr?.value.stringValue).toBe(events[0]?.session_id);
  });

  test("multiple events produce correct span count and kind", () => {
    const events = chain([
      makeSessionStart(),
      makeToolCall(1),
      makeLlmResponse(2),
      makeSessionEnd(3),
    ]);
    const result = convertToOtlp(events);
    const spans = result.resourceSpans[0]?.scopeSpans[0]?.spans ?? [];

    expect(spans).toHaveLength(4);
    // All spans should be INTERNAL kind
    for (const span of spans) {
      expect(span.kind).toBe(1);
    }
  });

  test("invalid timestamp returns '0' instead of throwing", () => {
    const events = chain([makeToolCall(0, undefined, { timestamp: "not-a-date" })]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    // Should not throw BigInt(NaN) — returns "0" for invalid timestamps
    expect(span.startTimeUnixNano).toBe("0");
    expect(span.endTimeUnixNano).toBe("0");
  });

  test("tool_result with invalid timestamp does not crash", () => {
    const events = chain([makeToolResult(0, { duration_ms: 500 }, { timestamp: "not-a-date" })]);
    const result = convertToOtlp(events);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    // startNano and endNano should both be "0" — no BigInt(NaN) crash
    expect(span.startTimeUnixNano).toBe("0");
    expect(span.endTimeUnixNano).toBe("0");
  });

  test("float payload values use doubleValue attribute", () => {
    const events = chain([
      makeLlmResponse(0, {
        model: "gpt-4",
        content: "hello",
        usage: { prompt_tokens: 0, completion_tokens: 0 },
        finish_reason: "stop",
      }),
    ]);
    // Add a manual event with a top-level float to test doubleValue
    const base = events[0] as TraceEvent;
    const manualEvent = {
      ...base,
      payload: { ...(base.payload as unknown as Record<string, unknown>), confidence: 0.95 },
    } as TraceEvent;
    const result = convertToOtlp([manualEvent]);
    const span = result.resourceSpans[0]?.scopeSpans[0]?.spans[0] as OtlpSpan;

    const confidenceAttr = span.attributes.find((a) => a.key === "krynix.confidence");
    expect(confidenceAttr).toBeDefined();
    expect(confidenceAttr?.value.doubleValue).toBe(0.95);
    expect(confidenceAttr?.value.intValue).toBeUndefined();
  });
});
