import { describe, test, expect, beforeEach } from "vitest";
import { OpenClawAdapter } from "./adapter.js";
import type { OpenClawHookEvent } from "./openclaw-types.js";
import type { TraceEvent } from "@krynix/core";
import { KrynixError } from "@krynix/core";

let adapter: OpenClawAdapter;

beforeEach(async () => {
  adapter = new OpenClawAdapter();
  await adapter.initialize({
    agentId: "test-agent",
    sessionId: "test-session",
    replaySeed: 42,
  });
});

function asPayload(event: TraceEvent): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

describe("OpenClawAdapter.onEvent", () => {
  test("before_tool_call → tool_call with correct tool_name and arguments", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "before_tool_call",
      event: { toolName: "file_read", params: { path: "/src/index.ts" } },
      context: { toolName: "file_read" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("tool_call");
    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("file_read");
    expect(payload["arguments"]).toEqual({ path: "/src/index.ts" });
  });

  test("after_tool_call → tool_result with correct tool_name, output, duration_ms", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "after_tool_call",
      event: {
        toolName: "file_read",
        params: { path: "/src/index.ts" },
        result: "file contents here",
        durationMs: 15,
      },
      context: { toolName: "file_read" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("tool_result");
    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("file_read");
    expect(payload["output"]).toBe("file contents here");
    expect(payload["duration_ms"]).toBe(15);
  });

  test("after_tool_call with error → output contains error, runtime.openclaw.error in metadata", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "after_tool_call",
      event: {
        toolName: "shell_exec",
        params: { command: "rm -rf /" },
        error: "blocked by policy",
        durationMs: 0,
      },
      context: { toolName: "shell_exec" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    const payload = asPayload(result as TraceEvent);
    expect(payload["output"]).toBe("blocked by policy");
    expect(result?.metadata).toMatchObject({ "runtime.openclaw.error": true });
  });

  test("llm_input → llm_request with correct model, messages, parameters", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "llm_input",
      event: {
        runId: "r1",
        sessionId: "oc-123",
        provider: "openai",
        model: "gpt-4",
        systemPrompt: "You are helpful",
        prompt: "Hello",
        historyMessages: [{ role: "user", content: "Hi" }],
        imagesCount: 0,
      },
      context: { agentId: "test-agent" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("llm_request");
    const payload = asPayload(result as TraceEvent);
    expect(payload["model"]).toBe("gpt-4");
    expect(payload["messages"]).toEqual([{ role: "user", content: "Hi" }]);
    expect(payload["parameters"]).toMatchObject({
      provider: "openai",
      systemPrompt: "You are helpful",
      prompt: "Hello",
      imagesCount: 0,
    });
  });

  test("llm_output → llm_response with joined content and usage mapping", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "llm_output",
      event: {
        runId: "r1",
        sessionId: "oc-123",
        provider: "openai",
        model: "gpt-4",
        assistantTexts: ["Hello", "World"],
        usage: { input: 10, output: 5 },
      },
      context: { agentId: "test-agent" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("llm_response");
    const payload = asPayload(result as TraceEvent);
    expect(payload["model"]).toBe("gpt-4");
    expect(payload["content"]).toBe("Hello\nWorld");
    expect(payload["usage"]).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(payload["finish_reason"]).toBe("stop");
  });

  test("llm_output without usage → defaults to zero tokens", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "llm_output",
      event: {
        runId: "r1",
        sessionId: "oc-123",
        provider: "openai",
        model: "gpt-4",
        assistantTexts: ["Hi there"],
      },
      context: {},
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    const payload = asPayload(result as TraceEvent);
    expect(payload["usage"]).toEqual({ prompt_tokens: 0, completion_tokens: 0 });
  });

  test("session_start → lifecycle with action session_start", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "session_start",
      event: { sessionId: "oc-123" },
      context: { agentId: "test-agent", sessionId: "oc-123" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("lifecycle");
    const payload = asPayload(result as TraceEvent);
    expect(payload["action"]).toBe("session_start");
  });

  test("session_end → lifecycle with action session_end, includes messageCount and durationMs", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "session_end",
      event: { sessionId: "oc-123", messageCount: 3, durationMs: 500 },
      context: { agentId: "test-agent", sessionId: "oc-123" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("lifecycle");
    const payload = asPayload(result as TraceEvent);
    expect(payload["action"]).toBe("session_end");
    const context = payload["context"] as Record<string, unknown>;
    expect(context["messageCount"]).toBe(3);
    expect(context["durationMs"]).toBe(500);
  });

  test("unknown _hook value → returns null", () => {
    const result = adapter.onEvent({ _hook: "unknown_hook", event: {}, context: {} });
    expect(result).toBeNull();
  });

  test("input without _hook field → returns null (no crash)", () => {
    const result = adapter.onEvent({ someField: "value" });
    expect(result).toBeNull();
  });

  test("null/undefined input → returns null", () => {
    expect(adapter.onEvent(null)).toBeNull();
    expect(adapter.onEvent(undefined)).toBeNull();
  });

  test("context.agentId overrides config.agentId", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "before_tool_call",
      event: { toolName: "file_read", params: {} },
      context: { agentId: "context-agent", toolName: "file_read" },
    };

    const result = adapter.onEvent(hookEvent);

    expect(result?.agent_id).toBe("context-agent");
  });

  test("flush returns empty array; shutdown callable after initialize", async () => {
    const flushed = await adapter.flush();
    expect(flushed).toEqual([]);

    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });

  test("all events have runtime.adapter and runtime.openclaw.hook in metadata", () => {
    const hooks: OpenClawHookEvent[] = [
      {
        _hook: "before_tool_call",
        event: { toolName: "test", params: {} },
        context: { toolName: "test" },
      },
      {
        _hook: "after_tool_call",
        event: { toolName: "test", params: {} },
        context: { toolName: "test" },
      },
      {
        _hook: "llm_input",
        event: {
          runId: "r1",
          sessionId: "s1",
          provider: "openai",
          model: "gpt-4",
          prompt: "hi",
          historyMessages: [],
          imagesCount: 0,
        },
        context: {},
      },
      {
        _hook: "llm_output",
        event: {
          runId: "r1",
          sessionId: "s1",
          provider: "openai",
          model: "gpt-4",
          assistantTexts: ["hi"],
        },
        context: {},
      },
      {
        _hook: "session_start",
        event: { sessionId: "s1" },
        context: { sessionId: "s1" },
      },
      {
        _hook: "session_end",
        event: { sessionId: "s1", messageCount: 0 },
        context: { sessionId: "s1" },
      },
    ];

    for (const hook of hooks) {
      const result = adapter.onEvent(hook);
      expect(result).not.toBeNull();
      expect(result?.metadata).toMatchObject({
        "runtime.adapter": "openclaw",
        "runtime.openclaw.hook": hook._hook,
      });
    }
  });

  test("onEvent before initialize returns null", () => {
    const uninitAdapter = new OpenClawAdapter();
    const hookEvent: OpenClawHookEvent = {
      _hook: "before_tool_call",
      event: { toolName: "file_read", params: {} },
      context: { toolName: "file_read" },
    };

    const result = uninitAdapter.onEvent(hookEvent);
    expect(result).toBeNull();
  });

  test("llm_input without systemPrompt omits it from parameters", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "llm_input",
      event: {
        runId: "r1",
        sessionId: "oc-123",
        provider: "openai",
        model: "gpt-4",
        prompt: "Hello",
        historyMessages: [],
        imagesCount: 0,
      },
      context: { agentId: "test-agent" },
    };

    const result = adapter.onEvent(hookEvent);
    const payload = asPayload(result as TraceEvent);
    const params = payload["parameters"] as Record<string, unknown>;
    expect(params).not.toHaveProperty("systemPrompt");
    expect(params["provider"]).toBe("openai");
    expect(params["prompt"]).toBe("Hello");
  });

  test("session_start without resumedFrom produces empty context", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "session_start",
      event: { sessionId: "oc-123" },
      context: { agentId: "test-agent", sessionId: "oc-123" },
    };

    const result = adapter.onEvent(hookEvent);
    const payload = asPayload(result as TraceEvent);
    const context = payload["context"] as Record<string, unknown>;
    expect(context).toEqual({});
    expect(context).not.toHaveProperty("resumedFrom");
  });

  test("session_end without durationMs omits it from context", () => {
    const hookEvent: OpenClawHookEvent = {
      _hook: "session_end",
      event: { sessionId: "oc-123", messageCount: 5 },
      context: { agentId: "test-agent", sessionId: "oc-123" },
    };

    const result = adapter.onEvent(hookEvent);
    const payload = asPayload(result as TraceEvent);
    const context = payload["context"] as Record<string, unknown>;
    expect(context["messageCount"]).toBe(5);
    expect(context).not.toHaveProperty("durationMs");
  });

  // ---------------------------------------------------------------------------
  // onSkippedEvent callback tests
  // ---------------------------------------------------------------------------

  test("onSkippedEvent called with reason when null input is received", () => {
    const skipped: Array<{ reason: string; event: unknown }> = [];
    adapter.onSkippedEvent = (reason, event) => skipped.push({ reason, event });

    adapter.onEvent(null);
    adapter.onEvent(undefined);

    expect(skipped).toHaveLength(2);
    expect(skipped[0]?.reason).toBe("null or undefined event");
    expect(skipped[1]?.reason).toBe("null or undefined event");
  });

  test("onSkippedEvent called for non-object input", () => {
    const skipped: Array<{ reason: string; event: unknown }> = [];
    adapter.onSkippedEvent = (reason, event) => skipped.push({ reason, event });

    adapter.onEvent("a string");
    adapter.onEvent(42);

    expect(skipped).toHaveLength(2);
    expect(skipped[0]?.reason).toBe("event is not an object");
    expect(skipped[1]?.reason).toBe("event is not an object");
  });

  test("onSkippedEvent called for missing _hook field", () => {
    const skipped: Array<{ reason: string; event: unknown }> = [];
    adapter.onSkippedEvent = (reason, event) => skipped.push({ reason, event });

    adapter.onEvent({ someField: "value" });

    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toBe("missing or non-string _hook field");
  });

  test("onSkippedEvent called for unknown hook type", () => {
    const skipped: Array<{ reason: string; event: unknown }> = [];
    adapter.onSkippedEvent = (reason, event) => skipped.push({ reason, event });

    adapter.onEvent({ _hook: "unknown_hook", event: {}, context: {} });

    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toBe("unknown hook type: unknown_hook");
  });

  test("onSkippedEvent called when adapter not initialized", () => {
    const uninitAdapter = new OpenClawAdapter();
    const skipped: Array<{ reason: string; event: unknown }> = [];
    uninitAdapter.onSkippedEvent = (reason, event) => skipped.push({ reason, event });

    uninitAdapter.onEvent({
      _hook: "before_tool_call",
      event: { toolName: "test", params: {} },
      context: {},
    });

    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.reason).toBe("adapter not initialized");
  });

  test("onSkippedEvent not called for valid events", () => {
    const skipped: Array<{ reason: string; event: unknown }> = [];
    adapter.onSkippedEvent = (reason, event) => skipped.push({ reason, event });

    const hookEvent: OpenClawHookEvent = {
      _hook: "before_tool_call",
      event: { toolName: "file_read", params: { path: "/test" } },
      context: { toolName: "file_read" },
    };

    const result = adapter.onEvent(hookEvent);
    expect(result).not.toBeNull();
    expect(skipped).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // initialize() validation
  // ---------------------------------------------------------------------------

  test("initialize rejects NaN replaySeed", async () => {
    const a = new OpenClawAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: NaN })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects zero replaySeed", async () => {
    const a = new OpenClawAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: 0 })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects negative replaySeed", async () => {
    const a = new OpenClawAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: -1 })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects non-integer replaySeed", async () => {
    const a = new OpenClawAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: 3.14 })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects unsafe integer replaySeed", async () => {
    const a = new OpenClawAdapter();
    await expect(
      a.initialize({ agentId: "a", sessionId: "s", replaySeed: Number.MAX_SAFE_INTEGER + 1 }),
    ).rejects.toThrow(KrynixError);
  });

  test("initialize accepts valid positive integer replaySeed", async () => {
    const a = new OpenClawAdapter();
    await expect(
      a.initialize({ agentId: "a", sessionId: "s", replaySeed: 1 }),
    ).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // shutdown() lifecycle
  // ---------------------------------------------------------------------------

  test("onEvent after shutdown returns null (adapter not initialized)", async () => {
    await adapter.shutdown();

    const result = adapter.onEvent({
      _hook: "before_tool_call",
      event: { toolName: "file_read", params: {} },
      context: { toolName: "file_read" },
    });

    expect(result).toBeNull();
  });
});
