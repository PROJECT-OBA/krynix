import { describe, test, expect } from "vitest";
import { validatePayload } from "./payload-validator.js";
import { KrynixError } from "./errors.js";

describe("validatePayload", () => {
  // -----------------------------------------------------------------------
  // Rejects non-object payloads
  // -----------------------------------------------------------------------

  test("throws on null payload", () => {
    expect(() => validatePayload("tool_call", null)).toThrow(KrynixError);
    expect(() => validatePayload("tool_call", null)).toThrow("must be an object, got null");
  });

  test("throws on undefined payload", () => {
    expect(() => validatePayload("tool_call", undefined)).toThrow(
      "must be an object, got undefined",
    );
  });

  test("throws on string payload", () => {
    expect(() => validatePayload("tool_call", "oops")).toThrow("must be an object, got string");
  });

  test("throws on number payload", () => {
    expect(() => validatePayload("tool_call", 42)).toThrow("must be an object, got number");
  });

  test("throws INVALID_PAYLOAD for unknown event type (JS caller bypass)", () => {
    // TypeScript callers can't reach this, but JS callers or unsafe casts can
    const badType = "unknown_event" as unknown as Parameters<typeof validatePayload>[0];
    expect(() => validatePayload(badType, { some: "field" })).toThrow(KrynixError);
    expect(() => validatePayload(badType, { some: "field" })).toThrow("unknown event type");
  });

  // -----------------------------------------------------------------------
  // tool_call
  // -----------------------------------------------------------------------

  test("accepts valid tool_call payload", () => {
    expect(() =>
      validatePayload("tool_call", { tool_name: "read_file", arguments: { path: "/etc" } }),
    ).not.toThrow();
  });

  test("rejects tool_call missing tool_name", () => {
    expect(() => validatePayload("tool_call", { arguments: {} })).toThrow(
      "missing required field 'tool_name'",
    );
  });

  test("rejects tool_call with non-object arguments", () => {
    expect(() => validatePayload("tool_call", { tool_name: "x", arguments: "bad" })).toThrow(
      "field 'arguments' must be an object",
    );
  });

  test("rejects tool_call with null arguments", () => {
    expect(() => validatePayload("tool_call", { tool_name: "x", arguments: null })).toThrow(
      "field 'arguments' must be an object, got null",
    );
  });

  test("rejects tool_call with array arguments", () => {
    expect(() => validatePayload("tool_call", { tool_name: "x", arguments: [1, 2] })).toThrow(
      "field 'arguments' must be an object, got array",
    );
  });

  // -----------------------------------------------------------------------
  // tool_result
  // -----------------------------------------------------------------------

  test("accepts valid tool_result payload", () => {
    expect(() =>
      validatePayload("tool_result", {
        tool_name: "read_file",
        output: "file contents",
        duration_ms: 123,
      }),
    ).not.toThrow();
  });

  test("accepts tool_result with null output (any type)", () => {
    expect(() =>
      validatePayload("tool_result", { tool_name: "read_file", output: null, duration_ms: 123 }),
    ).not.toThrow();
  });

  test("rejects tool_result missing output", () => {
    expect(() =>
      validatePayload("tool_result", { tool_name: "read_file", duration_ms: 123 }),
    ).toThrow("missing required field 'output'");
  });

  test("rejects tool_result with string duration_ms", () => {
    expect(() =>
      validatePayload("tool_result", { tool_name: "x", output: "", duration_ms: "fast" }),
    ).toThrow("field 'duration_ms' must be number, got string");
  });

  // -----------------------------------------------------------------------
  // llm_request
  // -----------------------------------------------------------------------

  test("accepts valid llm_request payload", () => {
    expect(() =>
      validatePayload("llm_request", {
        model: "gpt-4",
        messages: [{ role: "user", content: "hi" }],
        parameters: {},
      }),
    ).not.toThrow();
  });

  test("rejects llm_request missing model", () => {
    expect(() => validatePayload("llm_request", { messages: [], parameters: {} })).toThrow(
      "missing required field 'model'",
    );
  });

  test("rejects llm_request missing parameters", () => {
    expect(() => validatePayload("llm_request", { model: "gpt-4", messages: [] })).toThrow(
      "missing required field 'parameters'",
    );
  });

  test("rejects llm_request with non-array messages", () => {
    expect(() =>
      validatePayload("llm_request", { model: "gpt-4", messages: "bad", parameters: {} }),
    ).toThrow("field 'messages' must be an array");
  });

  test("rejects llm_request with object messages", () => {
    expect(() =>
      validatePayload("llm_request", {
        model: "gpt-4",
        messages: { role: "user" },
        parameters: {},
      }),
    ).toThrow("field 'messages' must be an array");
  });

  // -----------------------------------------------------------------------
  // llm_response
  // -----------------------------------------------------------------------

  test("accepts valid llm_response payload", () => {
    expect(() =>
      validatePayload("llm_response", {
        model: "gpt-4",
        content: "Hello!",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        finish_reason: "stop",
      }),
    ).not.toThrow();
  });

  test("rejects llm_response missing finish_reason", () => {
    expect(() =>
      validatePayload("llm_response", {
        model: "gpt-4",
        content: "Hello!",
        usage: {},
      }),
    ).toThrow("missing required field 'finish_reason'");
  });

  // -----------------------------------------------------------------------
  // decision
  // -----------------------------------------------------------------------

  test("accepts valid decision payload", () => {
    expect(() =>
      validatePayload("decision", { action: "search", reasoning: "need more data" }),
    ).not.toThrow();
  });

  test("rejects decision missing reasoning", () => {
    expect(() => validatePayload("decision", { action: "search" })).toThrow(
      "missing required field 'reasoning'",
    );
  });

  // -----------------------------------------------------------------------
  // observation
  // -----------------------------------------------------------------------

  test("accepts valid observation payload", () => {
    expect(() =>
      validatePayload("observation", { source: "user_input", content: { data: "value" } }),
    ).not.toThrow();
  });

  test("accepts observation with null content (any type)", () => {
    expect(() =>
      validatePayload("observation", { source: "user_input", content: null }),
    ).not.toThrow();
  });

  test("rejects observation missing content", () => {
    expect(() => validatePayload("observation", { source: "user_input" })).toThrow(
      "missing required field 'content'",
    );
  });

  test("rejects observation with non-string source", () => {
    expect(() => validatePayload("observation", { source: 42, content: {} })).toThrow(
      "field 'source' must be string, got number",
    );
  });

  // -----------------------------------------------------------------------
  // error
  // -----------------------------------------------------------------------

  test("accepts valid error payload", () => {
    expect(() =>
      validatePayload("error", {
        code: "TIMEOUT",
        message: "Request timed out",
        recoverable: true,
      }),
    ).not.toThrow();
  });

  test("rejects error missing recoverable", () => {
    expect(() =>
      validatePayload("error", { code: "TIMEOUT", message: "Request timed out" }),
    ).toThrow("missing required field 'recoverable'");
  });

  test("rejects error missing message", () => {
    expect(() => validatePayload("error", { code: "TIMEOUT", recoverable: false })).toThrow(
      "missing required field 'message'",
    );
  });

  test("rejects error with non-boolean recoverable", () => {
    expect(() =>
      validatePayload("error", { code: "TIMEOUT", message: "fail", recoverable: "yes" }),
    ).toThrow("field 'recoverable' must be boolean, got string");
  });

  // -----------------------------------------------------------------------
  // lifecycle
  // -----------------------------------------------------------------------

  test("accepts valid lifecycle payload", () => {
    expect(() => validatePayload("lifecycle", { action: "session_start" })).not.toThrow();
  });

  test("rejects lifecycle missing action", () => {
    expect(() => validatePayload("lifecycle", {})).toThrow("missing required field 'action'");
  });

  // -----------------------------------------------------------------------
  // Error code is INVALID_PAYLOAD
  // -----------------------------------------------------------------------

  test("thrown error has code INVALID_PAYLOAD", () => {
    try {
      validatePayload("tool_call", null);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KrynixError);
      expect((err as KrynixError).code).toBe("INVALID_PAYLOAD");
    }
  });

  // -----------------------------------------------------------------------
  // Extra fields are allowed (structural check only)
  // -----------------------------------------------------------------------

  test("allows extra fields beyond required ones", () => {
    expect(() =>
      validatePayload("tool_call", {
        tool_name: "read_file",
        arguments: {},
        extra_data: "ok",
      }),
    ).not.toThrow();
  });
});
