/**
 * End-to-end regression test against real `@langchain/core`.
 *
 * This is the test that would have caught the `unknown_tool` chain-of-trust
 * bug on day one. It runs an actual `DynamicTool` and `FakeListChatModel`
 * through `createLangChainTracer` and asserts the resulting trace contains
 * real, resolvable tool/model names — not `unknown_tool` / `unknown`, and not
 * the class name (`DynamicTool`, `FakeListChatModel`) which was the first
 * fallback in the resolution cascade.
 *
 * Unlike the older `adapter.test.ts` / `plugin.test.ts` which build
 * hand-crafted callback events, every event here is produced by the real
 * LangChain library calling into our handler via the real callback manager.
 * That means if LangChain ever changes its wire shape, this test fails loudly
 * — which is exactly the drift signal we were missing.
 *
 * Also asserts the trace passes hash-chain validation and produces correct
 * PASS / FAIL outcomes against both a permissive and a restrictive policy.
 *
 * @module
 */

import { afterEach, describe, expect, test } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DynamicTool } from "@langchain/core/tools";
import { FakeListChatModel } from "@langchain/core/utils/testing";

import { readTrace, validateHashChain, validateTraceEvent } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";
import { evaluate, parsePolicy } from "@krynix/policy";

import { createLangChainTracer } from "./plugin.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string | null = null;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-langchain-e2e-"));
  return tempDir;
}

/**
 * Return the payload of a trace event as a Record for ergonomic field access.
 * The TraceEvent payload union lacks an index signature, so we unwrap once.
 */
function asPayload(event: TraceEvent): Record<string, unknown> {
  return event.payload as unknown as Record<string, unknown>;
}

/** Pick trace events of a given type. */
function eventsOfType(trace: TraceEvent[], type: string): TraceEvent[] {
  return trace.filter((e) => e.event_type === type);
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const PERMISSIVE_POLICY_YAML = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: e2e-permissive
  version: "1.0.0"
  description: Allow the tools this e2e test uses; deny anything unexpected.
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: allow-web-search
      description: Allow the web_search tool
      match:
        payload:
          - field: tool_name
            operator: eq
            value: web_search
      action: allow
      severity: info
      message: "web_search is allowed"
  defaults:
    unmatched_action: deny
    unmatched_severity: warning
`;

const STRICT_DENY_WEB_SEARCH_POLICY_YAML = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: e2e-strict
  version: "1.0.0"
  description: Deny web_search specifically — must FAIL on the real resolved tool name.
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: deny-web-search
      description: Block web_search
      match:
        payload:
          - field: tool_name
            operator: eq
            value: web_search
      action: deny
      severity: critical
      message: "web_search is explicitly denied"
  defaults:
    unmatched_action: allow
    unmatched_severity: info
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LangChain adapter — end-to-end against real @langchain/core", () => {
  test("real DynamicTool.invoke produces trace with real tool_name (not unknown_tool)", async () => {
    // Arrange: real tracer + real DynamicTool.
    const dir = await createTempDir();
    const tracePath = join(dir, "e2e-tool.trace.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "e2e-agent",
      replaySeed: 42,
    });

    const webSearchTool = new DynamicTool({
      name: "web_search",
      description: "search the web",
      func: async (q: string) => `search results for: ${q}`,
    });

    // Act: drive the real library through our handler.
    const output = await webSearchTool.invoke("what is langchain", {
      callbacks: [handler],
    });
    await handle.shutdown();

    // Assert: real trace contains the real tool name and a real output.
    expect(output).toBe("search results for: what is langchain");

    const trace = await readTrace(tracePath);
    const toolCalls = eventsOfType(trace, "tool_call");
    expect(toolCalls.length).toBe(1);
    const toolCall = toolCalls[0];
    expect(toolCall).toBeDefined();
    if (!toolCall) return;

    const toolCallPayload = asPayload(toolCall);
    // This is the assertion the `unknown_tool` bug was hiding from us.
    expect(toolCallPayload["tool_name"]).toBe("web_search");
    expect(toolCallPayload["tool_name"]).not.toBe("unknown_tool");
    // And NOT the class name — the old cascade (without runName) would have
    // returned "DynamicTool" here; this guards against regressing to that.
    expect(toolCallPayload["tool_name"]).not.toBe("DynamicTool");

    const toolResults = eventsOfType(trace, "tool_result");
    expect(toolResults.length).toBe(1);
    const toolResult = toolResults[0];
    expect(toolResult).toBeDefined();
    if (!toolResult) return;
    const toolResultPayload = asPayload(toolResult);
    expect(toolResultPayload["tool_name"]).toBe("web_search");
    expect(toolResultPayload["output"]).toBe("search results for: what is langchain");

    // Every event on disk must still validate against the schema.
    for (const event of trace) {
      expect(validateTraceEvent(event).valid).toBe(true);
    }

    // Hash chain must still cover the real-world payloads end-to-end.
    const chainResult = validateHashChain(trace);
    expect(chainResult.valid).toBe(true);
  });

  test("real FakeListChatModel.invoke produces llm_request with real model name", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "e2e-llm.trace.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "e2e-agent",
      replaySeed: 43,
    });
    const fakeLlm = new FakeListChatModel({ responses: ["the answer is 42"] });
    const result = await fakeLlm.invoke("what is the meaning of life", {
      callbacks: [handler],
    });
    await handle.shutdown();

    // FakeListChatModel returns the canned response as an AIMessage.
    expect(String(result.content)).toBe("the answer is 42");

    const trace = await readTrace(tracePath);
    const llmRequests = eventsOfType(trace, "llm_request");
    expect(llmRequests.length).toBe(1);

    // Real Serialized.id === ["langchain","chat_models","fake-list","FakeListChatModel"].
    // Without the A1 cascade, the old adapter read `event.name` and returned "unknown".
    const llmRequest = llmRequests[0];
    expect(llmRequest).toBeDefined();
    if (!llmRequest) return;
    const llmRequestPayload = asPayload(llmRequest);
    expect(llmRequestPayload["model"]).toBe("FakeListChatModel");
    expect(llmRequestPayload["model"]).not.toBe("unknown");

    // llm_response is captured too.
    const llmResponses = eventsOfType(trace, "llm_response");
    expect(llmResponses.length).toBe(1);
    const llmResponse = llmResponses[0];
    expect(llmResponse).toBeDefined();
    if (!llmResponse) return;
    const llmResponsePayload = asPayload(llmResponse);
    expect(String(llmResponsePayload["content"])).toBe("the answer is 42");

    const chainResult = validateHashChain(trace);
    expect(chainResult.valid).toBe(true);
  });

  test("permissive policy PASSES and strict policy FAILS on the real resolved tool name", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "e2e-policy.trace.jsonl");

    const { handler, handle } = await createLangChainTracer({
      outputPath: tracePath,
      agentId: "e2e-agent",
      replaySeed: 44,
    });

    const webSearchTool = new DynamicTool({
      name: "web_search",
      description: "search the web",
      func: async (q: string) => `results: ${q}`,
    });

    await webSearchTool.invoke("hello", { callbacks: [handler] });
    await handle.shutdown();

    const trace = await readTrace(tracePath);

    // Permissive policy: explicit allow for web_search, deny everything else.
    // Must PASS because our adapter resolved the real name `web_search`.
    const permissivePolicy = parsePolicy(PERMISSIVE_POLICY_YAML);
    const permissiveResult = evaluate(trace, permissivePolicy);
    expect(permissiveResult.verdict).toBe("pass");
    expect(permissiveResult.violations.length).toBe(0);

    // Strict policy: deny web_search specifically. Must FAIL on the real
    // resolved name. If the adapter were still emitting `unknown_tool`, this
    // assertion would pass in the OTHER direction — strict wouldn't fire and
    // the bug would stay silent. That's the regression this test guards.
    const strictPolicy = parsePolicy(STRICT_DENY_WEB_SEARCH_POLICY_YAML);
    const strictResult = evaluate(trace, strictPolicy);
    expect(strictResult.verdict).toBe("fail");
    expect(strictResult.violations.length).toBeGreaterThan(0);
    const firstViolation = strictResult.violations[0];
    expect(firstViolation).toBeDefined();
    if (!firstViolation) return;
    expect(firstViolation.ruleId).toBe("deny-web-search");
  });
});
