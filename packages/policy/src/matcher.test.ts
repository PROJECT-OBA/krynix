import { describe, test, expect } from "vitest";
import { matchRule } from "./matcher.js";
import type { PolicyRule } from "./schema.js";
import type { TraceEvent } from "@krynix/core";

// ---------------------------------------------------------------------------
// Local test factories — minimal TraceEvent builders for matcher tests
// ---------------------------------------------------------------------------

const DEFAULT_BASE = {
  event_id: "test-event-id",
  session_id: "test-session",
  sequence_num: 0,
  timestamp: "2025-01-15T14:00:00.000Z",
  parent_id: null,
  agent_id: "test-agent",
  redacted: false,
  prev_hash: "",
  event_hash: "",
  metadata: null,
  schema_version: "1.0.0",
} as const;

function makeToolCall(seq: number, payload?: Record<string, unknown>): TraceEvent {
  return {
    ...DEFAULT_BASE,
    sequence_num: seq,
    event_type: "tool_call",
    payload: {
      tool_name: (payload?.["tool_name"] as string) ?? "file_read",
      arguments: (payload?.["arguments"] as Record<string, unknown>) ?? {},
      ...(payload?.["approval_status"] !== undefined
        ? { approval_status: payload["approval_status"] }
        : {}),
    },
  } as unknown as TraceEvent;
}

function makeLlmResponse(seq: number, payload?: Record<string, unknown>): TraceEvent {
  return {
    ...DEFAULT_BASE,
    sequence_num: seq,
    event_type: "llm_response",
    payload: {
      model: (payload?.["model"] as string) ?? "claude-opus-4-5-20251101",
      content: (payload?.["content"] as string) ?? "Response text",
      usage: (payload?.["usage"] as Record<string, unknown>) ?? {
        prompt_tokens: 150,
        completion_tokens: 42,
      },
      finish_reason: (payload?.["finish_reason"] as string) ?? "stop",
    },
  } as unknown as TraceEvent;
}

// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "test-rule",
    description: "Test rule",
    match: { payload: [] },
    action: "deny",
    severity: "error",
    message: "Test violation",
    ...overrides,
  };
}

describe("matchRule — operators", () => {
  test("eq: matches when value equals", () => {
    const event = makeToolCall(0, { tool_name: "shell_exec", arguments: {} });
    const rule = makeRule({
      match: {
        payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("eq: does not match when value differs", () => {
    const event = makeToolCall(0, { tool_name: "file_read", arguments: {} });
    const rule = makeRule({
      match: {
        payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });

  test("neq: matches when value is different", () => {
    const event = makeToolCall(0, {
      tool_name: "test",
      arguments: { exit_code: 1 },
    });
    const rule = makeRule({
      match: {
        payload: [{ field: "arguments.exit_code", operator: "neq", value: 0 }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("in: matches when value is in the list", () => {
    const event = makeToolCall(0, { tool_name: "file_read", arguments: {} });
    const rule = makeRule({
      match: {
        payload: [{ field: "tool_name", operator: "in", value: ["file_read", "file_write"] }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("in: does not match when value is not in the list", () => {
    const event = makeToolCall(0, { tool_name: "shell_exec", arguments: {} });
    const rule = makeRule({
      match: {
        payload: [{ field: "tool_name", operator: "in", value: ["file_read", "file_write"] }],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });

  test("not_in: matches when value is not in the list", () => {
    const event = makeLlmResponse(0, { model: "claude-3-opus" });
    const rule = makeRule({
      match: {
        payload: [{ field: "model", operator: "not_in", value: ["gpt-3.5-turbo"] }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("matches: regex match succeeds", () => {
    const event = makeToolCall(0, {
      tool_name: "file_write",
      arguments: { path: "/etc/passwd" },
    });
    const rule = makeRule({
      match: {
        payload: [{ field: "arguments.path", operator: "matches", value: "^/etc/.*" }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("matches: regex match fails", () => {
    const event = makeToolCall(0, {
      tool_name: "file_write",
      arguments: { path: "/workspace/index.ts" },
    });
    const rule = makeRule({
      match: {
        payload: [{ field: "arguments.path", operator: "matches", value: "^/etc/.*" }],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });

  test("contains: substring match", () => {
    const event = makeLlmResponse(0, { content: "The file contains password data" });
    const rule = makeRule({
      match: {
        payload: [{ field: "content", operator: "contains", value: "password" }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("exists: field present with value true", () => {
    const event = makeToolCall(0, {
      tool_name: "test",
      arguments: {},
      approval_status: "auto",
    });
    const rule = makeRule({
      match: {
        payload: [{ field: "approval_status", operator: "exists", value: true }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("exists: field missing with value true returns false", () => {
    const event = makeToolCall(0, { tool_name: "test", arguments: {} });
    const rule = makeRule({
      match: {
        payload: [{ field: "approval_status", operator: "exists", value: true }],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });
});

describe("matchRule — dot-notation resolution", () => {
  test("resolves nested field through dot notation", () => {
    const event = makeToolCall(0, {
      tool_name: "file_write",
      arguments: { path: "/etc/hosts", mode: "overwrite" },
    });
    const rule = makeRule({
      match: {
        payload: [{ field: "arguments.path", operator: "eq", value: "/etc/hosts" }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("resolves deeply nested field", () => {
    const event = makeToolCall(0, {
      tool_name: "test",
      arguments: { nested: { deep: { value: 42 } } },
    });
    const rule = makeRule({
      match: {
        payload: [{ field: "arguments.nested.deep.value", operator: "eq", value: 42 }],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });
});

describe("matchRule — AND logic", () => {
  test("all conditions must match for rule to match", () => {
    const event = makeToolCall(0, {
      tool_name: "file_write",
      arguments: { path: "/etc/passwd" },
    });
    const rule = makeRule({
      match: {
        payload: [
          { field: "tool_name", operator: "eq", value: "file_write" },
          { field: "arguments.path", operator: "matches", value: "^/etc/.*" },
        ],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("one failing condition causes rule to not match", () => {
    const event = makeToolCall(0, {
      tool_name: "file_read",
      arguments: { path: "/etc/passwd" },
    });
    const rule = makeRule({
      match: {
        payload: [
          { field: "tool_name", operator: "eq", value: "file_write" },
          { field: "arguments.path", operator: "matches", value: "^/etc/.*" },
        ],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });
});

describe("matchRule — event type filter", () => {
  test("matches when event_type filter matches", () => {
    const event = makeToolCall(0);
    const rule = makeRule({
      match: {
        event_type: "tool_call",
        payload: [],
      },
    });
    expect(matchRule(event, rule)).toBe(true);
  });

  test("does not match when event_type filter differs", () => {
    const event = makeToolCall(0);
    const rule = makeRule({
      match: {
        event_type: "tool_result",
        payload: [],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });
});

describe("matchRule — missing fields", () => {
  test("missing field with eq returns false", () => {
    const event = makeToolCall(0, { tool_name: "test", arguments: {} });
    const rule = makeRule({
      match: {
        payload: [{ field: "nonexistent_field", operator: "eq", value: "anything" }],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });

  test("missing nested field returns false for non-exists operators", () => {
    const event = makeToolCall(0, { tool_name: "test", arguments: {} });
    const rule = makeRule({
      match: {
        payload: [{ field: "arguments.deep.missing", operator: "contains", value: "x" }],
      },
    });
    expect(matchRule(event, rule)).toBe(false);
  });

  test("empty payload conditions matches any event", () => {
    const event = makeToolCall(0);
    const rule = makeRule({ match: { payload: [] } });
    expect(matchRule(event, rule)).toBe(true);
  });
});
