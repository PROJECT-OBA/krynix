import { describe, test, expect, beforeEach } from "vitest";
import { LangChainAdapter } from "./adapter.js";
import type { LangChainCallbackEvent } from "./langchain-types.js";
import type { TraceEvent } from "@krynix/core";
import { KrynixError } from "@krynix/core";

let adapter: LangChainAdapter;

beforeEach(async () => {
  adapter = new LangChainAdapter();
  await adapter.initialize({
    agentId: "test-agent",
    sessionId: "test-session",
    replaySeed: 42,
  });
});

function asPayload(event: TraceEvent): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

describe("LangChainAdapter.onEvent", () => {
  test("handleLLMStart → llm_request with model and prompts", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMStart",
      serialized: { name: "ChatOpenAI" },
      prompts: ["What is 2+2?"],
      runId: "run-001",
      name: "gpt-4",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("llm_request");
    const payload = asPayload(result as TraceEvent);
    expect(payload["model"]).toBe("gpt-4");
    expect(payload["messages"]).toEqual([{ role: "user", content: "What is 2+2?" }]);
  });

  test("handleLLMEnd → llm_response with content and usage", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "4" }]],
        llmOutput: {
          tokenUsage: { promptTokens: 10, completionTokens: 5 },
          model_name: "gpt-4",
        },
      },
      runId: "run-001",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("llm_response");
    const payload = asPayload(result as TraceEvent);
    expect(payload["model"]).toBe("gpt-4");
    expect(payload["content"]).toBe("4");
    expect(payload["usage"]).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(payload["finish_reason"]).toBe("stop");
  });

  test("handleLLMEnd uses finish_reason from generationInfo when present", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "...", generationInfo: { finish_reason: "max_tokens" } }]],
      },
      runId: "run-finish-1",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("max_tokens");
  });

  test("handleLLMEnd maps tool_use finish_reason from generationInfo", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "", generationInfo: { finish_reason: "tool_use" } }]],
      },
      runId: "run-finish-2",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("tool_use");
  });

  test("handleLLMEnd defaults finish_reason to stop when generationInfo is absent", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "response" }]],
      },
      runId: "run-finish-3",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("stop");
  });

  test("handleLLMEnd defaults finish_reason to stop when generationInfo.finish_reason is non-string", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "response", generationInfo: { finish_reason: 42 } }]],
      },
      runId: "run-finish-4",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("stop");
  });

  test('handleLLMEnd normalizes OpenAI "length" to "max_tokens"', () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "...", generationInfo: { finish_reason: "length" } }]],
      },
      runId: "run-finish-5",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("max_tokens");
  });

  test('handleLLMEnd normalizes OpenAI "tool_calls" to "tool_use"', () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "", generationInfo: { finish_reason: "tool_calls" } }]],
      },
      runId: "run-finish-6",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("tool_use");
  });

  test('handleLLMEnd normalizes "function_call" to "tool_use"', () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "", generationInfo: { finish_reason: "function_call" } }]],
      },
      runId: "run-finish-7",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("tool_use");
  });

  test("handleLLMEnd defaults unknown finish_reason string to stop", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "response", generationInfo: { finish_reason: "content_filter" } }]],
      },
      runId: "run-finish-8",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["finish_reason"]).toBe("stop");
  });

  test("handleLLMEnd with multiple generations joins text", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "Hello" }, { text: "World" }]],
      },
      runId: "run-002",
    };

    const result = adapter.onEvent(event);
    const payload = asPayload(result as TraceEvent);
    expect(payload["content"]).toBe("Hello\nWorld");
    expect(payload["usage"]).toEqual({ prompt_tokens: 0, completion_tokens: 0 });
  });

  test("handleToolStart → tool_call with tool name and input", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleToolStart",
      tool: { name: "search" },
      input: "LangChain documentation",
      runId: "run-003",
      parentRunId: "run-001",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("tool_call");
    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("search");
    expect(payload["arguments"]).toEqual({ input: "LangChain documentation" });
    expect(result?.parent_id).toBeNull();
    expect(result?.metadata).toMatchObject({ "runtime.langchain.parent_run_id": "run-001" });
  });

  test("handleToolEnd → tool_result with output", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleToolEnd",
      output: "Search results: LangChain is a framework for...",
      runId: "run-003",
      parentRunId: "run-001",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("tool_result");
    const payload = asPayload(result as TraceEvent);
    expect(payload["output"]).toBe("Search results: LangChain is a framework for...");
    expect(payload["duration_ms"]).toBe(0);
    expect(payload["tool_name"]).toBe("unknown_tool");
  });

  test("handleToolEnd resolves tool_name from prior handleToolStart via runId", () => {
    // First, send a handleToolStart to register the tool name
    adapter.onEvent({
      _callback: "handleToolStart",
      tool: { name: "calculator" },
      input: "2+2",
      runId: "run-tool-100",
    } as LangChainCallbackEvent);

    // Now handleToolEnd with the same runId should resolve the tool name
    const result = adapter.onEvent({
      _callback: "handleToolEnd",
      output: "4",
      runId: "run-tool-100",
    } as LangChainCallbackEvent);

    expect(result).not.toBeNull();
    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("calculator");
  });

  test("handleToolEnd falls back to unknown_tool when no prior handleToolStart", () => {
    const result = adapter.onEvent({
      _callback: "handleToolEnd",
      output: "result",
      runId: "run-orphan",
    } as LangChainCallbackEvent);

    expect(result).not.toBeNull();
    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("unknown_tool");
  });

  test("handleChainStart → observation with chain name and inputs", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleChainStart",
      chain: { name: "RetrievalQA" },
      inputs: { query: "What is LangChain?" },
      runId: "run-004",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("observation");
    const payload = asPayload(result as TraceEvent);
    expect(payload["source"]).toBe("langchain_chain_start");
    const content = payload["content"] as Record<string, unknown>;
    expect(content["chain_name"]).toBe("RetrievalQA");
    expect(content["inputs"]).toEqual({ query: "What is LangChain?" });
  });

  test("handleChainEnd → observation with outputs", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleChainEnd",
      outputs: { result: "LangChain is a framework for LLM applications" },
      runId: "run-004",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("observation");
    const payload = asPayload(result as TraceEvent);
    expect(payload["source"]).toBe("langchain_chain_end");
  });

  test("handleChainError → error event", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleChainError",
      error: { message: "Chain execution failed", name: "ChainError" },
      runId: "run-005",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("error");
    const payload = asPayload(result as TraceEvent);
    expect(payload["code"]).toBe("ChainError");
    expect(payload["message"]).toBe("Chain execution failed");
    expect(payload["recoverable"]).toBe(false);
  });

  test("handleLLMError → error event (recoverable)", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleLLMError",
      error: { message: "Rate limited", name: "RateLimitError" },
      runId: "run-006",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("error");
    const payload = asPayload(result as TraceEvent);
    expect(payload["code"]).toBe("RateLimitError");
    expect(payload["recoverable"]).toBe(true);
  });

  test("handleToolError → error event (recoverable)", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleToolError",
      error: { message: "Tool not found" },
      runId: "run-007",
    };

    const result = adapter.onEvent(event);

    expect(result).not.toBeNull();
    expect(result?.event_type).toBe("error");
    const payload = asPayload(result as TraceEvent);
    expect(payload["code"]).toBe("TOOL_ERROR");
    expect(payload["message"]).toBe("Tool not found");
  });

  // ---------------------------------------------------------------------------
  // Edge cases and guards
  // ---------------------------------------------------------------------------

  test("null/undefined input → returns null", () => {
    expect(adapter.onEvent(null)).toBeNull();
    expect(adapter.onEvent(undefined)).toBeNull();
  });

  test("non-object input → returns null", () => {
    expect(adapter.onEvent("string")).toBeNull();
    expect(adapter.onEvent(42)).toBeNull();
  });

  test("missing _callback field → returns null", () => {
    expect(adapter.onEvent({ someField: "value" })).toBeNull();
  });

  test("unknown _callback → returns null", () => {
    expect(adapter.onEvent({ _callback: "handleCustom" })).toBeNull();
  });

  test("valid _callback but missing runId → returns null", () => {
    const skipped: string[] = [];
    adapter.onSkippedEvent = (reason) => skipped.push(reason);

    const result = adapter.onEvent({ _callback: "handleToolStart" });
    expect(result).toBeNull();
    expect(skipped).toEqual(["missing or non-string runId field"]);
  });

  test("onEvent before initialize → returns null", () => {
    const uninitAdapter = new LangChainAdapter();
    const result = uninitAdapter.onEvent({
      _callback: "handleToolStart",
      tool: { name: "search" },
      input: "query",
      runId: "run-100",
    });
    expect(result).toBeNull();
  });

  test("parentRunId stored in metadata, parent_id always null", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleToolStart",
      tool: { name: "search" },
      input: "query",
      runId: "child-001",
      parentRunId: "parent-001",
    };

    const result = adapter.onEvent(event);
    expect(result?.parent_id).toBeNull();
    expect(result?.metadata).toMatchObject({ "runtime.langchain.parent_run_id": "parent-001" });
  });

  test("events without parentRunId have null parent_id and no runtime.langchain.parent_run_id", () => {
    const event: LangChainCallbackEvent = {
      _callback: "handleToolStart",
      tool: { name: "search" },
      input: "query",
      runId: "run-solo",
    };

    const result = adapter.onEvent(event);
    expect(result?.parent_id).toBeNull();
    expect(result?.metadata).not.toHaveProperty("runtime.langchain.parent_run_id");
  });

  // ---------------------------------------------------------------------------
  // onSkippedEvent callback
  // ---------------------------------------------------------------------------

  test("malformed event with valid _callback skips instead of throwing", () => {
    const skipped: string[] = [];
    adapter.onSkippedEvent = (reason) => skipped.push(reason);

    // prompts is not an array — .map() would normally throw
    const result = adapter.onEvent({
      _callback: "handleLLMStart",
      prompts: "not-an-array",
      runId: "run-bad",
    });

    expect(result).toBeNull();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/failed to map callback event/);
  });

  test("onSkippedEvent called for null input", () => {
    const skipped: string[] = [];
    adapter.onSkippedEvent = (reason) => skipped.push(reason);

    adapter.onEvent(null);
    expect(skipped).toEqual(["null or undefined event"]);
  });

  test("onSkippedEvent called for unknown callback", () => {
    const skipped: string[] = [];
    adapter.onSkippedEvent = (reason) => skipped.push(reason);

    adapter.onEvent({ _callback: "handleCustom" });
    expect(skipped).toEqual(["unknown callback: handleCustom"]);
  });

  test("onSkippedEvent not called for valid events", () => {
    const skipped: string[] = [];
    adapter.onSkippedEvent = (reason) => skipped.push(reason);

    adapter.onEvent({
      _callback: "handleToolStart",
      tool: { name: "test" },
      input: "query",
      runId: "run-valid",
    });

    expect(skipped).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  test("all events have runtime.adapter, runtime.langchain.callback, and runtime.langchain.run_id in metadata", () => {
    const events: LangChainCallbackEvent[] = [
      {
        _callback: "handleLLMStart",
        serialized: { name: "ChatOpenAI" },
        prompts: ["test"],
        runId: "r1",
      },
      {
        _callback: "handleToolStart",
        tool: { name: "search" },
        input: "q",
        runId: "r2",
      },
      {
        _callback: "handleChainStart",
        chain: { name: "TestChain" },
        inputs: {},
        runId: "r3",
      },
    ];

    for (const ev of events) {
      const result = adapter.onEvent(ev);
      expect(result).not.toBeNull();
      expect(result?.metadata).toMatchObject({
        "runtime.adapter": "langchain",
        "runtime.langchain.callback": ev._callback,
        "runtime.langchain.run_id": ev.runId,
      });
    }
  });

  // ---------------------------------------------------------------------------
  // runIdToToolName cleanup
  // ---------------------------------------------------------------------------

  test("handleToolError cleans up runIdToToolName entry", () => {
    // Register tool via handleToolStart
    adapter.onEvent({
      _callback: "handleToolStart",
      tool: { name: "calculator" },
      input: "2+2",
      runId: "run-err-1",
    } as LangChainCallbackEvent);

    // Error cleans up the entry
    adapter.onEvent({
      _callback: "handleToolError",
      error: { message: "Tool crashed" },
      runId: "run-err-1",
    } as LangChainCallbackEvent);

    // Subsequent handleToolEnd with same runId should fall back to unknown_tool
    const result = adapter.onEvent({
      _callback: "handleToolEnd",
      output: "result",
      runId: "run-err-1",
    } as LangChainCallbackEvent);

    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("unknown_tool");
  });

  test("shutdown clears runIdToToolName map", async () => {
    // Register tool via handleToolStart
    adapter.onEvent({
      _callback: "handleToolStart",
      tool: { name: "search" },
      input: "query",
      runId: "run-shutdown-1",
    } as LangChainCallbackEvent);

    // Shutdown clears internal state
    await adapter.shutdown();

    // Re-initialize for further use
    await adapter.initialize({
      agentId: "test-agent",
      sessionId: "test-session",
      replaySeed: 42,
    });

    // handleToolEnd should not resolve the previously registered tool name
    const result = adapter.onEvent({
      _callback: "handleToolEnd",
      output: "result",
      runId: "run-shutdown-1",
    } as LangChainCallbackEvent);

    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("unknown_tool");
  });

  // ---------------------------------------------------------------------------
  // flush and shutdown
  // ---------------------------------------------------------------------------

  test("flush returns empty array; shutdown callable", async () => {
    const flushed = await adapter.flush();
    expect(flushed).toEqual([]);
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // initialize() validation
  // ---------------------------------------------------------------------------

  test("initialize rejects NaN replaySeed", async () => {
    const a = new LangChainAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: NaN })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects zero replaySeed", async () => {
    const a = new LangChainAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: 0 })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects negative replaySeed", async () => {
    const a = new LangChainAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: -1 })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects non-integer replaySeed", async () => {
    const a = new LangChainAdapter();
    await expect(a.initialize({ agentId: "a", sessionId: "s", replaySeed: 3.14 })).rejects.toThrow(
      KrynixError,
    );
  });

  test("initialize rejects unsafe integer replaySeed", async () => {
    const a = new LangChainAdapter();
    await expect(
      a.initialize({ agentId: "a", sessionId: "s", replaySeed: Number.MAX_SAFE_INTEGER + 1 }),
    ).rejects.toThrow(KrynixError);
  });

  test("initialize accepts valid positive integer replaySeed", async () => {
    const a = new LangChainAdapter();
    await expect(
      a.initialize({ agentId: "a", sessionId: "s", replaySeed: 1 }),
    ).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // initialize() clears session-scoped state
  // ---------------------------------------------------------------------------

  test("re-initialize clears stale runIdToToolName entries", async () => {
    // Register tool via handleToolStart
    adapter.onEvent({
      _callback: "handleToolStart",
      tool: { name: "search" },
      input: "query",
      runId: "run-reinit-1",
    } as LangChainCallbackEvent);

    // Re-initialize with a new session
    await adapter.initialize({
      agentId: "test-agent",
      sessionId: "new-session",
      replaySeed: 99,
    });

    // handleToolEnd should not resolve the previously registered tool name
    const result = adapter.onEvent({
      _callback: "handleToolEnd",
      output: "result",
      runId: "run-reinit-1",
    } as LangChainCallbackEvent);

    const payload = asPayload(result as TraceEvent);
    expect(payload["tool_name"]).toBe("unknown_tool");
  });

  // ---------------------------------------------------------------------------
  // shutdown() lifecycle
  // ---------------------------------------------------------------------------

  test("onEvent after shutdown returns null (adapter not initialized)", async () => {
    await adapter.shutdown();

    const result = adapter.onEvent({
      _callback: "handleToolStart",
      tool: { name: "search" },
      input: "query",
      runId: "run-after-shutdown",
    });

    expect(result).toBeNull();
  });
});
