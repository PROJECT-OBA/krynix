import { describe, test, expect, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  createKrynixPlugin,
  type OpenClawPluginApiMinimal,
  type KrynixPluginHandle,
  type KrynixPluginOptions,
} from "./plugin.js";
import { readTrace, validateHashChain } from "@krynix/core";

// ---------------------------------------------------------------------------
// Controllable mock for @krynix/core — only recordEvent and endSession are
// overridable; all other exports pass through to the real implementation.
// ---------------------------------------------------------------------------
let mockRecordEvent: ((...args: unknown[]) => Promise<unknown>) | null = null;
let mockEndSession: ((...args: unknown[]) => Promise<unknown>) | null = null;

vi.mock("@krynix/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    recordEvent: (...args: unknown[]) => {
      if (mockRecordEvent) return mockRecordEvent(...args);
      return (actual.recordEvent as (...a: unknown[]) => Promise<unknown>)(...args);
    },
    endSession: (...args: unknown[]) => {
      if (mockEndSession) return mockEndSession(...args);
      return (actual.endSession as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

let tempDir: string;
let handle: KrynixPluginHandle | null = null;

afterEach(async () => {
  // Reset mock overrides before cleanup so shutdown() uses real implementations
  mockRecordEvent = null;
  mockEndSession = null;

  if (handle) {
    try {
      await handle.shutdown();
    } catch {
      // May already be shut down or in error state
    }
    handle = null;
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-plugin-test-"));
  return tempDir;
}

/**
 * Create a mock OpenClaw plugin API that records `on()` calls.
 * Returns the mock API and a map of registered handlers keyed by hook name.
 */
function createMockApi(): {
  api: OpenClawPluginApiMinimal;
  hooks: Map<string, (event: unknown, context: unknown) => unknown | Promise<unknown>>;
} {
  const hooks = new Map<string, (event: unknown, context: unknown) => unknown | Promise<unknown>>();

  const api: OpenClawPluginApiMinimal = {
    on: vi.fn(
      (
        hookName: string,
        handler: (event: unknown, context: unknown) => unknown | Promise<unknown>,
      ) => {
        hooks.set(hookName, handler);
      },
    ),
  };

  return { api, hooks };
}

/** Fire a sequence of realistic OpenClaw hooks through the handler map. */
async function fireStandardHookSequence(
  hooks: Map<string, (event: unknown, context: unknown) => unknown | Promise<unknown>>,
): Promise<void> {
  const sessionStart = hooks.get("session_start");
  const beforeToolCall = hooks.get("before_tool_call");
  const afterToolCall = hooks.get("after_tool_call");
  const llmInput = hooks.get("llm_input");
  const llmOutput = hooks.get("llm_output");
  const sessionEnd = hooks.get("session_end");

  await sessionStart?.(
    { sessionId: "oc-plugin-test" },
    { agentId: "test-agent", sessionId: "oc-plugin-test" },
  );

  await beforeToolCall?.(
    { toolName: "file_read", params: { path: "/src/index.ts" } },
    { agentId: "test-agent", sessionKey: "sk1", toolName: "file_read" },
  );

  await afterToolCall?.(
    {
      toolName: "file_read",
      params: { path: "/src/index.ts" },
      result: "contents...",
      durationMs: 15,
    },
    { agentId: "test-agent", sessionKey: "sk1", toolName: "file_read" },
  );

  await llmInput?.(
    {
      runId: "r1",
      sessionId: "oc-plugin-test",
      provider: "openai",
      model: "gpt-4",
      prompt: "Hello",
      historyMessages: [],
      imagesCount: 0,
    },
    { agentId: "test-agent", sessionId: "oc-plugin-test" },
  );

  await llmOutput?.(
    {
      runId: "r1",
      sessionId: "oc-plugin-test",
      provider: "openai",
      model: "gpt-4",
      assistantTexts: ["Hi there"],
      usage: { input: 10, output: 5 },
    },
    { agentId: "test-agent", sessionId: "oc-plugin-test" },
  );

  await sessionEnd?.(
    { sessionId: "oc-plugin-test", messageCount: 3, durationMs: 500 },
    { agentId: "test-agent", sessionId: "oc-plugin-test" },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createKrynixPlugin", () => {
  test("registers all 6 hook types", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    expect(api.on).toHaveBeenCalledTimes(6);
    expect(hooks.has("session_start")).toBe(true);
    expect(hooks.has("session_end")).toBe(true);
    expect(hooks.has("before_tool_call")).toBe(true);
    expect(hooks.has("after_tool_call")).toBe(true);
    expect(hooks.has("llm_input")).toBe(true);
    expect(hooks.has("llm_output")).toBe(true);
  });

  test("session lifecycle: start → events → end writes trace file", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    await fireStandardHookSequence(hooks);

    // session_start (auto) + session_start(hook) + before_tool_call +
    // after_tool_call + llm_input + llm_output + session_end(hook lifecycle) + session_end (auto) = 8
    // Actually: startSession writes session_start (seq 0), then:
    //   hook session_start → adapter lifecycle event → recordEvent (seq 1)
    //   before_tool_call → tool_call (seq 2)
    //   after_tool_call → tool_result (seq 3)
    //   llm_input → llm_request (seq 4)
    //   llm_output → llm_response (seq 5)
    //   session_end hook → adapter lifecycle event → recordEvent (seq 6)
    //   session_end hook → endSession → lifecycle:session_end (seq 7)
    // Total: 8 events
    const events = await readTrace(outputPath);
    expect(events.length).toBe(8);

    // First event is always session_start from session manager
    expect(events[0]?.event_type).toBe("lifecycle");
    // Last event is session_end from session manager
    expect(events[events.length - 1]?.event_type).toBe("lifecycle");
  });

  test("hash chain valid after session", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    await fireStandardHookSequence(hooks);

    const events = await readTrace(outputPath);
    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
  });

  test("shutdown before any events cleanly closes without error", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    // Shutdown immediately — session was started but no hook events fired
    await expect(handle.shutdown()).resolves.toBeUndefined();

    // Trace file should exist (session_start + session_end were written)
    const fileStat = await stat(outputPath);
    expect(fileStat.size).toBeGreaterThan(0);

    // Should have exactly 2 events: session_start + session_end
    const events = await readTrace(outputPath);
    expect(events.length).toBe(2);
    handle = null; // Already shut down
  });

  test("events after session_end are dropped", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    // Fire session_start, one tool call, then session_end
    const sessionStart = hooks.get("session_start");
    const beforeToolCall = hooks.get("before_tool_call");
    const afterToolCall = hooks.get("after_tool_call");
    const sessionEnd = hooks.get("session_end");

    if (!sessionStart || !beforeToolCall || !afterToolCall || !sessionEnd) {
      throw new Error("Expected all hooks to be registered");
    }

    await sessionStart({ sessionId: "oc-test" }, { agentId: "test-agent", sessionId: "oc-test" });
    await beforeToolCall(
      { toolName: "file_read", params: { path: "/test" } },
      { agentId: "test-agent", sessionKey: "sk1", toolName: "file_read" },
    );
    await afterToolCall(
      { toolName: "file_read", params: { path: "/test" }, result: "ok", durationMs: 5 },
      { agentId: "test-agent", sessionKey: "sk1", toolName: "file_read" },
    );
    await sessionEnd(
      { sessionId: "oc-test", messageCount: 1, durationMs: 100 },
      { agentId: "test-agent", sessionId: "oc-test" },
    );

    const eventsBeforeStale = await readTrace(outputPath);
    const countBefore = eventsBeforeStale.length;

    // Fire more events after session_end — these should be dropped
    await beforeToolCall(
      { toolName: "file_read", params: { path: "/stale" } },
      { agentId: "test-agent", sessionKey: "sk3", toolName: "file_read" },
    );

    const eventsAfterStale = await readTrace(outputPath);
    expect(eventsAfterStale.length).toBe(countBefore);
    handle = null; // Session already ended
  });

  test("throws on missing outputPath", () => {
    expect(() => createKrynixPlugin({} as KrynixPluginOptions)).toThrow(
      "KrynixPlugin: outputPath is required",
    );
    expect(() => createKrynixPlugin({ outputPath: "" })).toThrow(
      "KrynixPlugin: outputPath is required",
    );
  });

  test("getTracePath returns configured output path", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    expect(handle.getTracePath()).toBe(outputPath);
  });

  test("unknown hook event type is silently dropped", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    // Fire session_start, then a raw unknown hook via the handler map
    const sessionStart = hooks.get("session_start");
    await sessionStart?.({ sessionId: "oc-test" }, { agentId: "test-agent", sessionId: "oc-test" });

    // Manually invoke the before_tool_call handler with malformed data
    // that the adapter's onEvent returns null for
    const beforeToolCall = hooks.get("before_tool_call");
    // Missing toolName — adapter should map but still produce an event
    await beforeToolCall?.({ params: {} }, { agentId: "test-agent", sessionKey: "sk1" });

    // End session and check events are valid
    const sessionEnd = hooks.get("session_end");
    await sessionEnd?.(
      { sessionId: "oc-test", messageCount: 1, durationMs: 50 },
      { agentId: "test-agent", sessionId: "oc-test" },
    );

    const events = await readTrace(outputPath);
    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
    handle = null;
  });

  test("concurrent hook invocations produce valid hash chain", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    const sessionStart = hooks.get("session_start");
    await sessionStart?.(
      { sessionId: "oc-concurrent" },
      { agentId: "test-agent", sessionId: "oc-concurrent" },
    );

    // Fire multiple hooks concurrently
    const beforeToolCall = hooks.get("before_tool_call");
    const llmInput = hooks.get("llm_input");

    await Promise.all([
      beforeToolCall?.(
        { toolName: "file_read", params: { path: "/a" } },
        { agentId: "test-agent", sessionKey: "sk1", toolName: "file_read" },
      ),
      llmInput?.(
        {
          runId: "r1",
          sessionId: "oc-concurrent",
          provider: "openai",
          model: "gpt-4",
          prompt: "Hello",
          historyMessages: [],
          imagesCount: 0,
        },
        { agentId: "test-agent", sessionId: "oc-concurrent" },
      ),
    ]);

    const sessionEnd = hooks.get("session_end");
    await sessionEnd?.(
      { sessionId: "oc-concurrent", messageCount: 1, durationMs: 50 },
      { agentId: "test-agent", sessionId: "oc-concurrent" },
    );

    // Hash chain must still be valid
    const events = await readTrace(outputPath);
    expect(events.length).toBeGreaterThanOrEqual(5); // start + session_start + 2 concurrent + end(hook) + end(auto)
    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
    handle = null;
  });

  test("double shutdown does not throw", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");
    const { api } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    await handle.shutdown();
    // Second shutdown should not throw
    await expect(handle.shutdown()).resolves.toBeUndefined();
    handle = null;
  });

  test("shutdown surfaces write queue error via firstWriteError", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "error-write.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    const sessionStart = hooks.get("session_start");
    const beforeToolCall = hooks.get("before_tool_call");

    await sessionStart?.({ sessionId: "oc-err" }, { agentId: "test-agent", sessionId: "oc-err" });

    // After session_start succeeds, make recordEvent fail on subsequent calls
    mockRecordEvent = async () => {
      throw new Error("simulated write failure");
    };

    // This hook's recordEvent call will fail
    await beforeToolCall?.(
      { toolName: "file_read", params: { path: "/test" } },
      { agentId: "test-agent", sessionKey: "sk1", toolName: "file_read" },
    );

    // shutdown should surface the captured write error
    if (!handle) throw new Error("handle should exist");
    await expect(handle.shutdown()).rejects.toThrow("simulated write failure");
    handle = null;

    // Trace should be incomplete (no session_end event)
    const events = await readTrace(outputPath);
    const lastEvent = events[events.length - 1];
    const payload = lastEvent?.payload as Record<string, unknown> | undefined;
    expect(lastEvent?.event_type === "lifecycle" && payload?.action === "session_end").toBe(false);
  });

  test("session_end hook error is surfaced by subsequent shutdown", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "error-endsession.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    const sessionStart = hooks.get("session_start");
    const sessionEnd = hooks.get("session_end");

    await sessionStart?.({ sessionId: "oc-err2" }, { agentId: "test-agent", sessionId: "oc-err2" });

    // Make endSession throw
    mockEndSession = async () => {
      throw new Error("simulated endSession failure");
    };

    // session_end hook will try endSession → fails → destroySession → error stored
    await sessionEnd?.(
      { sessionId: "oc-err2", messageCount: 0, durationMs: 100 },
      { agentId: "test-agent", sessionId: "oc-err2" },
    );

    // shutdown should surface the stored sessionEndHookError
    if (!handle) throw new Error("handle should exist");
    await expect(handle.shutdown()).rejects.toThrow("simulated endSession failure");
    handle = null;
  });

  test("write error followed by session_end produces incomplete trace", async () => {
    const dir = await createTempDir();
    const outputPath = join(dir, "error-combined.jsonl");
    const { api, hooks } = createMockApi();

    const initPlugin = createKrynixPlugin({ outputPath, replaySeed: 42 });
    handle = await initPlugin(api);

    const sessionStart = hooks.get("session_start");
    const beforeToolCall = hooks.get("before_tool_call");
    const sessionEnd = hooks.get("session_end");

    await sessionStart?.({ sessionId: "oc-err3" }, { agentId: "test-agent", sessionId: "oc-err3" });

    // Make recordEvent fail on subsequent calls
    mockRecordEvent = async () => {
      throw new Error("simulated disk full");
    };

    // This write will fail
    await beforeToolCall?.(
      { toolName: "file_read", params: { path: "/test" } },
      { agentId: "test-agent", sessionKey: "sk1", toolName: "file_read" },
    );

    // Restore recordEvent so session_end hook's handleHook recordEvent doesn't
    // fail for the wrong reason (session_end hook also records a lifecycle event)
    mockRecordEvent = null;

    // session_end should detect firstWriteError and call destroySession
    await sessionEnd?.(
      { sessionId: "oc-err3", messageCount: 0, durationMs: 100 },
      { agentId: "test-agent", sessionId: "oc-err3" },
    );

    // shutdown should surface the error via sessionEndHookError
    if (!handle) throw new Error("handle should exist");
    await expect(handle.shutdown()).rejects.toThrow("simulated disk full");
    handle = null;
  });
});
