/**
 * LangChain adapter end-to-end integration test.
 *
 * Exercises a realistic multi-turn agentic workflow:
 * LLM plans → tool call → tool error → LLM retries → tool succeeds → LLM responds
 *
 * Proves: adapter → session → trace file → schema validate → hash chain → policy evaluate → replay verify
 */

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  validateHashChain,
  validateTraceEvent,
} from "../../packages/core/src/index.js";
import { evaluate, parsePolicy } from "../../packages/policy/src/index.js";
import { verifyTrace } from "../../packages/replay/src/index.js";
import { LangChainAdapter } from "../../packages/adapter-langchain/src/adapter.js";
import { createLangChainTracer } from "../../packages/adapter-langchain/src/plugin.js";
import type { LangChainCallbackEvent } from "../../packages/adapter-langchain/src/langchain-types.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-langchain-"));
  return tempDir;
}

// Policy: deny shell tools, require approval for file writes, allow everything else
const MULTI_RULE_POLICY_YAML = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: langchain-test-policy
  version: "1.0.0"
  description: Multi-rule policy for LangChain integration test
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: deny-shell
      description: Block shell execution
      match:
        payload:
          - field: tool_name
            operator: matches
            value: "^(shell|bash|exec).*"
      action: deny
      severity: critical
      message: "Shell execution is not permitted"
    - id: approve-file-write
      description: Require approval for file writes
      match:
        payload:
          - field: tool_name
            operator: matches
            value: "^(file_)?(write|save|create)"
      action: require-approval
      severity: warning
      message: "File write requires approval"
    - id: allow-search
      description: Allow search tools
      match:
        payload:
          - field: tool_name
            operator: eq
            value: web_search
      action: allow
      severity: info
      message: "Search tool allowed"
  defaults:
    unmatched_action: allow
    unmatched_severity: info
`;

/**
 * Helper: feed a LangChain callback through the adapter and record it in the session.
 * Returns the mapped TraceEvent or null if skipped.
 */
async function feedCallback(
  adapter: LangChainAdapter,
  session: Awaited<ReturnType<typeof startSession>>,
  event: LangChainCallbackEvent,
) {
  const traceEvent = adapter.onEvent(event);
  if (traceEvent === null) return null;
  await recordEvent(session, {
    event_type: traceEvent.event_type,
    timestamp: traceEvent.timestamp,
    parent_id: traceEvent.parent_id,
    agent_id: traceEvent.agent_id,
    payload: traceEvent.payload,
    metadata: traceEvent.metadata,
  });
  return traceEvent;
}

describe("LangChain adapter end-to-end integration", () => {
  test("multi-turn agentic workflow: plan → search → error → retry → write → respond", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "langchain-multiturn.trace.jsonl");

    // 1. Initialize session + adapter
    const session = await startSession({
      agentId: "langchain-agent",
      replaySeed: 42,
      outputPath: tracePath,
    });

    const adapter = new LangChainAdapter();
    const skipped: string[] = [];
    adapter.onSkippedEvent = (reason) => skipped.push(reason);

    await adapter.initialize({
      agentId: "langchain-agent",
      sessionId: session.sessionId,
      replaySeed: 42,
    });

    // 2. Simulate a realistic multi-turn agentic loop

    // Turn 1: LLM plans what to do
    await feedCallback(adapter, session, {
      _callback: "handleLLMStart",
      serialized: { name: "ChatAnthropic" },
      prompts: ["Search for recent security advisories and update the config file."],
      runId: "run-llm-1",
      name: "claude-sonnet-4-6-20260315",
    });

    await feedCallback(adapter, session, {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{
          text: "I'll search for recent security advisories first, then update the config.",
          generationInfo: { finish_reason: "tool_calls" },
        }]],
        llmOutput: {
          tokenUsage: { promptTokens: 120, completionTokens: 45 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      runId: "run-llm-1",
    });

    // Turn 2: Agent calls web_search tool
    await feedCallback(adapter, session, {
      _callback: "handleToolStart",
      tool: { name: "web_search" },
      input: "recent node.js security advisories 2026",
      runId: "run-tool-1",
      parentRunId: "run-llm-1",
    });

    // Search tool fails (network timeout)
    await feedCallback(adapter, session, {
      _callback: "handleToolError",
      error: {
        name: "TimeoutError",
        message: "Request timed out after 30000ms",
      },
      runId: "run-tool-1",
      parentRunId: "run-llm-1",
    });

    // Turn 3: LLM retries with a different approach
    await feedCallback(adapter, session, {
      _callback: "handleLLMStart",
      serialized: { name: "ChatAnthropic" },
      prompts: [
        "The web search timed out. Let me try a more specific query.",
      ],
      runId: "run-llm-2",
      name: "claude-sonnet-4-6-20260315",
    });

    await feedCallback(adapter, session, {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{
          text: "I'll search with a more targeted query.",
          generationInfo: { finish_reason: "tool_calls" },
        }]],
        llmOutput: {
          tokenUsage: { promptTokens: 180, completionTokens: 30 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      runId: "run-llm-2",
    });

    // Turn 4: Retry web_search — succeeds this time
    await feedCallback(adapter, session, {
      _callback: "handleToolStart",
      tool: { name: "web_search" },
      input: "CVE-2026 node.js",
      runId: "run-tool-2",
      parentRunId: "run-llm-2",
    });

    await feedCallback(adapter, session, {
      _callback: "handleToolEnd",
      output: JSON.stringify({
        results: [
          { title: "CVE-2026-1234: HTTP/2 DoS", severity: "high" },
          { title: "CVE-2026-5678: Path traversal", severity: "medium" },
        ],
      }),
      runId: "run-tool-2",
      parentRunId: "run-llm-2",
    });

    // Turn 5: LLM processes results and decides to write config
    await feedCallback(adapter, session, {
      _callback: "handleLLMStart",
      serialized: { name: "ChatAnthropic" },
      prompts: [
        "Based on the advisories found, I'll update the security config to mitigate CVE-2026-1234.",
      ],
      runId: "run-llm-3",
      name: "claude-sonnet-4-6-20260315",
    });

    await feedCallback(adapter, session, {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{
          text: "I'll update the security configuration to disable HTTP/2 until the patch is applied.",
          generationInfo: { finish_reason: "stop" },
        }]],
        llmOutput: {
          tokenUsage: { promptTokens: 350, completionTokens: 60 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      runId: "run-llm-3",
    });

    // Turn 6: Agent calls file_write tool
    await feedCallback(adapter, session, {
      _callback: "handleToolStart",
      tool: { name: "file_write" },
      input: JSON.stringify({ path: "config/security.json", content: '{"http2": false}' }),
      runId: "run-tool-3",
      parentRunId: "run-llm-3",
    });

    await feedCallback(adapter, session, {
      _callback: "handleToolEnd",
      output: "File written successfully: config/security.json (42 bytes)",
      runId: "run-tool-3",
      parentRunId: "run-llm-3",
    });

    // 3. End session
    await endSession(session, {
      totalToolCalls: 3,
      totalLlmRequests: 3,
      searchRetries: 1,
    });

    // 4. Read trace and validate every event against schema
    const events = await readTrace(tracePath);
    // session_start(1) + 12 callbacks + session_end(1) = 14
    expect(events.length).toBe(14);

    for (const event of events) {
      const result = validateTraceEvent(event);
      expect(
        result.valid,
        `Event seq=${event.sequence_num} type=${event.event_type}: ${result.error}`,
      ).toBe(true);
    }

    // 5. Validate hash chain integrity
    const hashResult = validateHashChain(events);
    expect(hashResult.valid).toBe(true);

    // 6. Verify event type distribution
    const typeCounts = new Map<string, number>();
    for (const e of events) {
      typeCounts.set(e.event_type, (typeCounts.get(e.event_type) ?? 0) + 1);
    }
    expect(typeCounts.get("lifecycle")).toBe(2); // start + end
    expect(typeCounts.get("llm_request")).toBe(3);
    expect(typeCounts.get("llm_response")).toBe(3);
    expect(typeCounts.get("tool_call")).toBe(3);
    expect(typeCounts.get("tool_result")).toBe(2); // 2 successes (error is separate)
    expect(typeCounts.get("error")).toBe(1); // search timeout

    // 7. Verify tool name correlation (handleToolEnd resolves via runId)
    const toolResults = events.filter((e) => e.event_type === "tool_result");
    for (const tr of toolResults) {
      const payload = tr.payload as { tool_name: string };
      expect(["web_search", "file_write"]).toContain(payload.tool_name);
    }

    // 8. Verify adapter metadata on all non-lifecycle events
    const adapterEvents = events.filter((e) => e.event_type !== "lifecycle");
    for (const e of adapterEvents) {
      expect(e.metadata).toBeTruthy();
      expect((e.metadata as Record<string, unknown>)["runtime.adapter"]).toBe("langchain");
      expect((e.metadata as Record<string, unknown>)["runtime.langchain.callback"]).toBeTruthy();
      expect((e.metadata as Record<string, unknown>)["runtime.langchain.run_id"]).toBeTruthy();
    }

    // 9. Policy evaluation — file_write should require approval
    const policy = parsePolicy(MULTI_RULE_POLICY_YAML);
    const evalResult = evaluate(events, policy);
    expect(evalResult.exitCode).toBe(3); // require-approval
    const writeViolation = evalResult.violations.find((v) => v.ruleId === "approve-file-write");
    expect(writeViolation).toBeTruthy();
    expect(writeViolation?.action).toBe("require-approval");

    // 10. Replay verify — hash chain should be valid
    const replayResult = await verifyTrace(tracePath);
    expect(replayResult.status).toBe("pass");
    expect(replayResult.report?.totalEvents).toBe(14);

    // 11. Verify no events were skipped (all callbacks were valid)
    expect(skipped).toHaveLength(0);
  });

  test("error recovery: LLM error → retry → success produces valid trace", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "langchain-error-recovery.trace.jsonl");

    const session = await startSession({
      agentId: "error-recovery-agent",
      replaySeed: 77,
      outputPath: tracePath,
    });

    const adapter = new LangChainAdapter();
    await adapter.initialize({
      agentId: "error-recovery-agent",
      sessionId: session.sessionId,
      replaySeed: 77,
    });

    // LLM call fails (rate limit)
    await feedCallback(adapter, session, {
      _callback: "handleLLMStart",
      serialized: { name: "ChatOpenAI" },
      prompts: ["Hello"],
      runId: "run-1",
      name: "gpt-4o",
    });

    await feedCallback(adapter, session, {
      _callback: "handleLLMError",
      error: { name: "RateLimitError", message: "429 Too Many Requests" },
      runId: "run-1",
    });

    // LLM retries successfully
    await feedCallback(adapter, session, {
      _callback: "handleLLMStart",
      serialized: { name: "ChatOpenAI" },
      prompts: ["Hello"],
      runId: "run-2",
      name: "gpt-4o",
    });

    await feedCallback(adapter, session, {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "Hi there!", generationInfo: { finish_reason: "stop" } }]],
        llmOutput: {
          tokenUsage: { promptTokens: 5, completionTokens: 3 },
          model_name: "gpt-4o",
        },
      },
      runId: "run-2",
    });

    await endSession(session);

    const events = await readTrace(tracePath);
    // session_start + llm_request + error + llm_request + llm_response + session_end = 6
    expect(events.length).toBe(6);

    // All events valid
    for (const event of events) {
      expect(validateTraceEvent(event).valid).toBe(true);
    }

    // Hash chain valid
    expect(validateHashChain(events).valid).toBe(true);

    // Error event correctly typed
    const errorEvent = events.find((e) => e.event_type === "error");
    expect(errorEvent).toBeTruthy();
    const errorPayload = errorEvent!.payload as { code: string; message: string; recoverable: boolean };
    expect(errorPayload.code).toBe("RateLimitError");
    expect(errorPayload.recoverable).toBe(true);

    // Replay passes
    const replayResult = await verifyTrace(tracePath);
    expect(replayResult.status).toBe("pass");
  });

  test("chain callbacks produce observation events", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "langchain-chains.trace.jsonl");

    const session = await startSession({
      agentId: "chain-agent",
      replaySeed: 100,
      outputPath: tracePath,
    });

    const adapter = new LangChainAdapter();
    await adapter.initialize({
      agentId: "chain-agent",
      sessionId: session.sessionId,
      replaySeed: 100,
    });

    // RetrievalQA chain starts
    await feedCallback(adapter, session, {
      _callback: "handleChainStart",
      chain: { name: "RetrievalQA" },
      inputs: { query: "What is Krynix?" },
      runId: "chain-1",
    });

    // Inner LLM call
    await feedCallback(adapter, session, {
      _callback: "handleLLMStart",
      serialized: { name: "ChatAnthropic" },
      prompts: ["Context: Krynix is a trust spine. Question: What is Krynix?"],
      runId: "llm-inner",
      parentRunId: "chain-1",
      name: "claude-sonnet-4-6-20260315",
    });

    await feedCallback(adapter, session, {
      _callback: "handleLLMEnd",
      output: {
        generations: [[{ text: "Krynix is a trust and observability spine for agentic AI systems." }]],
        llmOutput: {
          tokenUsage: { promptTokens: 50, completionTokens: 20 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      runId: "llm-inner",
      parentRunId: "chain-1",
    });

    // Chain completes
    await feedCallback(adapter, session, {
      _callback: "handleChainEnd",
      outputs: { result: "Krynix is a trust and observability spine for agentic AI systems." },
      runId: "chain-1",
    });

    await endSession(session);

    const events = await readTrace(tracePath);
    expect(events.length).toBe(6); // start + chain_start + llm_req + llm_resp + chain_end + end

    // Observation events from chain
    const observations = events.filter((e) => e.event_type === "observation");
    expect(observations.length).toBe(2);
    expect((observations[0]!.payload as { source: string }).source).toBe("langchain_chain_start");
    expect((observations[1]!.payload as { source: string }).source).toBe("langchain_chain_end");

    // Hash chain + replay valid
    expect(validateHashChain(events).valid).toBe(true);
    expect((await verifyTrace(tracePath)).status).toBe("pass");
  });
});

describe("LangChain plugin (createLangChainTracer) end-to-end", () => {
  test("zero-friction plugin: same workflow, no manual wiring", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "langchain-plugin-e2e.trace.jsonl");

    // One-liner setup — no manual adapter + session + feedCallback boilerplate
    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "plugin-agent",
      replaySeed: 42,
    });

    // Turn 1: LLM plans
    await handler.handleLLMStart(
      { name: "ChatAnthropic" },
      ["Search for recent security advisories and update the config file."],
      "run-llm-1",
      undefined,
      { name: "claude-sonnet-4-6-20260315" },
    );
    await handler.handleLLMEnd(
      {
        generations: [[{
          text: "I'll search for recent security advisories first.",
          generationInfo: { finish_reason: "tool_calls" },
        }]],
        llmOutput: {
          tokenUsage: { promptTokens: 120, completionTokens: 45 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      "run-llm-1",
    );

    // Turn 2: web_search tool
    await handler.handleToolStart({ name: "web_search" }, "node.js security advisories", "run-tool-1", "run-llm-1");
    await handler.handleToolEnd(
      JSON.stringify([{ title: "CVE-2026-1234", severity: "high" }]),
      "run-tool-1",
      "run-llm-1",
    );

    // Turn 3: LLM responds and decides to write
    await handler.handleLLMStart(
      { name: "ChatAnthropic" },
      ["Based on findings, update config."],
      "run-llm-2",
      undefined,
      { name: "claude-sonnet-4-6-20260315" },
    );
    await handler.handleLLMEnd(
      {
        generations: [[{
          text: "Updating security config.",
          generationInfo: { finish_reason: "stop" },
        }]],
        llmOutput: {
          tokenUsage: { promptTokens: 300, completionTokens: 50 },
          model_name: "claude-sonnet-4-6-20260315",
        },
      },
      "run-llm-2",
    );

    // Turn 4: file_write tool
    await handler.handleToolStart({ name: "file_write" }, '{"http2": false}', "run-tool-2", "run-llm-2");
    await handler.handleToolEnd("File written successfully", "run-tool-2", "run-llm-2");

    // Shutdown finalizes the trace
    await handle.shutdown();

    // ---- Verification (same rigor as manual test) ----

    const events = await readTrace(tracePath);
    // session_start + 2 llm_req + 2 llm_resp + 2 tool_call + 2 tool_result + session_end = 10
    expect(events.length).toBe(10);

    // All events schema-valid
    for (const event of events) {
      expect(validateTraceEvent(event).valid).toBe(true);
    }

    // Hash chain valid
    expect(validateHashChain(events).valid).toBe(true);

    // Event type distribution
    const typeCounts = new Map<string, number>();
    for (const e of events) {
      typeCounts.set(e.event_type, (typeCounts.get(e.event_type) ?? 0) + 1);
    }
    expect(typeCounts.get("lifecycle")).toBe(2);
    expect(typeCounts.get("llm_request")).toBe(2);
    expect(typeCounts.get("llm_response")).toBe(2);
    expect(typeCounts.get("tool_call")).toBe(2);
    expect(typeCounts.get("tool_result")).toBe(2);

    // Adapter metadata present on non-lifecycle events
    const adapterEvents = events.filter((e) => e.event_type !== "lifecycle");
    for (const e of adapterEvents) {
      expect(e.metadata).toBeTruthy();
      expect((e.metadata as Record<string, unknown>)["runtime.adapter"]).toBe("langchain");
    }

    // Policy evaluation — file_write triggers require-approval
    const policy = parsePolicy(MULTI_RULE_POLICY_YAML);
    const evalResult = evaluate(events, policy);
    expect(evalResult.exitCode).toBe(3);
    const writeViolation = evalResult.violations.find((v) => v.ruleId === "approve-file-write");
    expect(writeViolation).toBeTruthy();

    // Replay verify passes
    const replayResult = await verifyTrace(tracePath);
    expect(replayResult.status).toBe("pass");
    expect(replayResult.report?.totalEvents).toBe(10);
  });
});
