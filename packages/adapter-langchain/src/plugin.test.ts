/**
 * Tests for the LangChain tracer plugin (`createLangChainTracer`).
 *
 * Verifies zero-friction flow, write queue serialization, shutdown
 * behavior, and error handling.
 */

import { describe, test, expect, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readTrace, validateHashChain, validateTraceEvent, type TraceEvent } from "@krynix/core";
import { createLangChainTracer } from "./plugin.js";

// ---------------------------------------------------------------------------
// Controllable mock for @krynix/core — only recordEvent is overridable;
// all other exports pass through to the real implementation.
// ---------------------------------------------------------------------------
let mockRecordEvent: ((...args: unknown[]) => Promise<unknown>) | null = null;

vi.mock("@krynix/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    recordEvent: (...args: unknown[]) => {
      if (mockRecordEvent) return mockRecordEvent(...args);
      return (actual.recordEvent as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

let tempDir: string;

afterEach(async () => {
  mockRecordEvent = null;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-lc-plugin-"));
  return tempDir;
}

describe("createLangChainTracer", () => {
  test("zero-friction flow: handler methods → shutdown → valid trace", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "trace.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "test-agent",
      replaySeed: 42,
    });

    // Simulate LLM call
    await handler.handleLLMStart(
      { name: "ChatAnthropic" },
      ["What is Krynix?"],
      "run-1",
      undefined,
      { name: "claude-sonnet-4-6-20260315" },
    );

    await handler.handleLLMEnd(
      {
        generations: [
          [{ text: "Krynix is a trust spine.", generationInfo: { finish_reason: "stop" } }],
        ],
        llmOutput: {
          tokenUsage: { promptTokens: 10, completionTokens: 5 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      "run-1",
    );

    // Simulate tool call
    await handler.handleToolStart({ name: "web_search" }, "query", "run-tool-1", "run-1");
    await handler.handleToolEnd("search results", "run-tool-1", "run-1");

    await handle.shutdown();

    // Verify trace
    const events = await readTrace(tracePath);
    // session_start + llm_request + llm_response + tool_call + tool_result + session_end
    expect(events.length).toBe(6);

    // All events schema-valid
    for (const event of events) {
      expect(validateTraceEvent(event).valid).toBe(true);
    }

    // Hash chain valid
    expect(validateHashChain(events).valid).toBe(true);

    // Correct event types
    const types = events.map((e: TraceEvent) => e.event_type);
    expect(types).toEqual([
      "lifecycle",
      "llm_request",
      "llm_response",
      "tool_call",
      "tool_result",
      "lifecycle",
    ]);

    // Sequence numbers contiguous
    for (let i = 0; i < events.length; i++) {
      expect(events.at(i)?.sequence_num).toBe(i);
    }

    // Agent ID correct on all events
    for (const event of events) {
      expect(event.agent_id).toBe("test-agent");
    }
  });

  test("write queue serialization: concurrent callbacks produce valid hash chain", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "concurrent.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "concurrent-agent",
      replaySeed: 99,
    });

    // Fire multiple callbacks concurrently
    await Promise.all([
      handler.handleLLMStart({ name: "Model" }, ["p1"], "r1", undefined, { name: "gpt-4o" }),
      handler.handleLLMStart({ name: "Model" }, ["p2"], "r2", undefined, { name: "gpt-4o" }),
      handler.handleLLMStart({ name: "Model" }, ["p3"], "r3", undefined, { name: "gpt-4o" }),
    ]);

    await Promise.all([
      handler.handleLLMEnd(
        {
          generations: [[{ text: "a" }]],
          llmOutput: { tokenUsage: { promptTokens: 1, completionTokens: 1 }, model_name: "gpt-4o" },
        },
        "r1",
      ),
      handler.handleLLMEnd(
        {
          generations: [[{ text: "b" }]],
          llmOutput: { tokenUsage: { promptTokens: 1, completionTokens: 1 }, model_name: "gpt-4o" },
        },
        "r2",
      ),
      handler.handleLLMEnd(
        {
          generations: [[{ text: "c" }]],
          llmOutput: { tokenUsage: { promptTokens: 1, completionTokens: 1 }, model_name: "gpt-4o" },
        },
        "r3",
      ),
    ]);

    await handle.shutdown();

    const events = await readTrace(tracePath);
    // session_start + 3 requests + 3 responses + session_end = 8
    expect(events.length).toBe(8);

    // Hash chain must be valid despite concurrent writes
    expect(validateHashChain(events).valid).toBe(true);

    // Sequence numbers must be contiguous
    for (let i = 0; i < events.length; i++) {
      expect(events.at(i)?.sequence_num).toBe(i);
    }
  });

  test("handler methods after shutdown are no-ops", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "post-shutdown.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "shutdown-agent",
      replaySeed: 7,
    });

    await handle.shutdown();

    // These should not throw
    await handler.handleLLMStart({ name: "M" }, ["p"], "r1", undefined, { name: "gpt-4o" });
    await handler.handleToolStart({ name: "t" }, "i", "r2");

    // Trace should only have start + end
    const events = await readTrace(tracePath);
    expect(events.length).toBe(2);
    expect(validateHashChain(events).valid).toBe(true);
  });

  test("shutdown is idempotent", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "idempotent.jsonl");

    const { handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "idem-agent",
      replaySeed: 3,
    });

    await handle.shutdown();
    // Second shutdown should not throw
    await handle.shutdown();

    const events = await readTrace(tracePath);
    expect(events.length).toBe(2);
  });

  test("missing outputPath throws", async () => {
    await expect(createLangChainTracer({ outputPath: "", agentId: "a" })).rejects.toThrow(
      "outputPath is required",
    );
  });

  test("missing agentId throws", async () => {
    await expect(
      createLangChainTracer({ outputPath: "/tmp/x.jsonl", agentId: "" }),
    ).rejects.toThrow("agentId is required");
  });

  test("multi-turn scenario: LLM → tool error → retry → success", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "multiturn.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "multiturn-agent",
      replaySeed: 55,
    });

    // LLM plans
    await handler.handleLLMStart(
      { name: "ChatAnthropic" },
      ["Search for advisories"],
      "llm-1",
      undefined,
      { name: "claude-sonnet-4-6-20260315" },
    );
    await handler.handleLLMEnd(
      {
        generations: [[{ text: "I'll search.", generationInfo: { finish_reason: "tool_calls" } }]],
        llmOutput: {
          tokenUsage: { promptTokens: 50, completionTokens: 10 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      "llm-1",
    );

    // Tool fails
    await handler.handleToolStart({ name: "web_search" }, "query", "tool-1", "llm-1");
    await handler.handleToolError(
      { name: "TimeoutError", message: "Request timed out" },
      "tool-1",
      "llm-1",
    );

    // LLM retries
    await handler.handleLLMStart(
      { name: "ChatAnthropic" },
      ["Retry with specific query"],
      "llm-2",
      undefined,
      { name: "claude-sonnet-4-6-20260315" },
    );
    await handler.handleLLMEnd(
      {
        generations: [[{ text: "Trying again.", generationInfo: { finish_reason: "tool_calls" } }]],
        llmOutput: {
          tokenUsage: { promptTokens: 80, completionTokens: 15 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      "llm-2",
    );

    // Tool succeeds
    await handler.handleToolStart({ name: "web_search" }, "specific query", "tool-2", "llm-2");
    await handler.handleToolEnd("results found", "tool-2", "llm-2");

    await handle.shutdown();

    const events = await readTrace(tracePath);
    // start + llm_req + llm_resp + tool_call + error + llm_req + llm_resp + tool_call + tool_result + end
    expect(events.length).toBe(10);
    expect(validateHashChain(events).valid).toBe(true);

    // Verify error event
    const errorEvent = events.find((e: TraceEvent) => e.event_type === "error");
    expect(errorEvent).toBeDefined();
    const payload = errorEvent?.payload as { code: string; message: string; recoverable: boolean };
    expect(payload.code).toBe("TimeoutError");
    expect(payload.recoverable).toBe(true);

    // Verify tool name correlation across start/end
    const toolResults = events.filter((e: TraceEvent) => e.event_type === "tool_result");
    expect(toolResults.length).toBe(1);
    expect((toolResults.at(0)?.payload as { tool_name: string }).tool_name).toBe("web_search");
  });

  test("getTracePath returns configured path", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "path-check.jsonl");

    const { handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "path-agent",
      replaySeed: 1,
    });

    expect(handle.getTracePath()).toBe(tracePath);
    await handle.shutdown();
  });

  test("chain callbacks produce observation events", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "chains.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "chain-agent",
      replaySeed: 200,
    });

    await handler.handleChainStart(
      { name: "RetrievalQA" },
      { query: "What is Krynix?" },
      "chain-1",
    );

    await handler.handleChainEnd({ result: "Krynix is a trust spine." }, "chain-1");

    await handle.shutdown();

    const events = await readTrace(tracePath);
    // start + observation(chain_start) + observation(chain_end) + end
    expect(events.length).toBe(4);

    const observations = events.filter((e: TraceEvent) => e.event_type === "observation");
    expect(observations.length).toBe(2);
    expect((observations.at(0)?.payload as { source: string }).source).toBe(
      "langchain_chain_start",
    );
    expect((observations.at(1)?.payload as { source: string }).source).toBe("langchain_chain_end");

    expect(validateHashChain(events).valid).toBe(true);
  });

  test("shutdown surfaces first write error", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "error-write.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "error-agent",
      replaySeed: 42,
    });

    // Make recordEvent fail on subsequent calls (after session_start was written)
    mockRecordEvent = async () => {
      throw new Error("simulated write failure");
    };

    // This callback's recordEvent call will fail — error is captured, not thrown
    await handler.handleLLMStart({ name: "Model" }, ["prompt"], "r1", undefined, {
      name: "gpt-4o",
    });

    // shutdown should surface the captured write error
    await expect(handle.shutdown()).rejects.toThrow("simulated write failure");

    // Trace should be incomplete (no session_end event)
    const events = await readTrace(tracePath);
    const lastEvent = events[events.length - 1];
    const payload = lastEvent?.payload as Record<string, unknown> | undefined;
    expect(lastEvent?.event_type === "lifecycle" && payload?.action === "session_end").toBe(false);
  });
});
