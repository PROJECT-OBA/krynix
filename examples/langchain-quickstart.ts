/**
 * Krynix + LangChain Quickstart
 *
 * Shows how to wire a LangChain agent to produce Krynix traces,
 * then evaluate policies and verify integrity.
 *
 * This example uses the @krynix/adapter-langchain package which
 * has zero runtime dependency on LangChain — it accepts plain objects
 * matching the LangChain callback shape.
 *
 * Run: npx tsx examples/langchain-quickstart.ts
 */

import { LangChainAdapter } from "@krynix/adapter-langchain";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  validateHashChain,
} from "@krynix/core";
import { evaluate, parsePolicy } from "@krynix/policy";
import { verifyTrace } from "@krynix/replay";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Step 1: Initialize a Krynix session and LangChain adapter
// ---------------------------------------------------------------------------

const TRACE_PATH = "traces/my-session.trace.jsonl";

// Ensure the output directory exists
await mkdir("traces", { recursive: true });

const session = await startSession({
  agentId: "my-langchain-agent",
  replaySeed: 42, // optional — enables deterministic replay
  outputPath: TRACE_PATH,
});

const adapter = new LangChainAdapter();
await adapter.initialize({
  agentId: "my-langchain-agent",
  sessionId: session.sessionId,
  replaySeed: 42,
});

// ---------------------------------------------------------------------------
// Step 2: In your LangChain callback handler, forward events to Krynix
// ---------------------------------------------------------------------------

// This helper converts a LangChain callback into a Krynix trace event
// and records it in the session. In a real integration, you'd call this
// from your BaseCallbackHandler methods.
async function onLangChainCallback(callbackName: string, data: Record<string, unknown>) {
  const traceEvent = adapter.onEvent({ _callback: callbackName, ...data });
  if (traceEvent) {
    await recordEvent(session, {
      event_type: traceEvent.event_type,
      timestamp: traceEvent.timestamp,
      parent_id: traceEvent.parent_id,
      agent_id: traceEvent.agent_id,
      payload: traceEvent.payload,
      metadata: traceEvent.metadata,
    });
  }
}

// Simulate a LangChain agent run:

// LLM decides to call a tool
await onLangChainCallback("handleLLMStart", {
  serialized: { name: "ChatAnthropic" },
  prompts: ["Find recent security patches for express.js"],
  runId: "run-1",
  name: "claude-sonnet-4-6-20260315",
});

await onLangChainCallback("handleLLMEnd", {
  output: {
    generations: [[{
      text: "I'll search for recent security patches.",
      generationInfo: { finish_reason: "tool_calls" },
    }]],
    llmOutput: {
      tokenUsage: { promptTokens: 100, completionTokens: 25 },
      model_name: "claude-sonnet-4-6-20260315",
    },
  },
  runId: "run-1",
});

// Tool call: web search
await onLangChainCallback("handleToolStart", {
  tool: { name: "web_search" },
  input: "express.js security patches 2026",
  runId: "run-tool-1",
  parentRunId: "run-1",
});

await onLangChainCallback("handleToolEnd", {
  output: JSON.stringify([{ title: "Express 5.1.2 security patch", severity: "high" }]),
  runId: "run-tool-1",
  parentRunId: "run-1",
});

// LLM produces final response
await onLangChainCallback("handleLLMStart", {
  serialized: { name: "ChatAnthropic" },
  prompts: ["Based on the search, here are the findings..."],
  runId: "run-2",
  name: "claude-sonnet-4-6-20260315",
});

await onLangChainCallback("handleLLMEnd", {
  output: {
    generations: [[{
      text: "Found 1 critical security patch for Express 5.1.2.",
      generationInfo: { finish_reason: "stop" },
    }]],
    llmOutput: {
      tokenUsage: { promptTokens: 200, completionTokens: 40 },
      model_name: "claude-sonnet-4-6-20260315",
    },
  },
  runId: "run-2",
});

// ---------------------------------------------------------------------------
// Step 3: Close the session (writes session_end event)
// ---------------------------------------------------------------------------

await endSession(session);

console.log(`\n✅ Trace written to: ${TRACE_PATH}`);

// ---------------------------------------------------------------------------
// Step 4: Verify trace integrity
// ---------------------------------------------------------------------------

const events = await readTrace(TRACE_PATH);
const hashResult = validateHashChain(events);
console.log(`🔗 Hash chain valid: ${hashResult.valid}`);

const replayResult = await verifyTrace(TRACE_PATH);
console.log(`🔄 Replay verify: ${replayResult.status} (${replayResult.report?.totalEvents} events)`);

// ---------------------------------------------------------------------------
// Step 5: Evaluate policies
// ---------------------------------------------------------------------------

// Load a policy file (YAML)
const policyYaml = readFileSync("policies/examples/llm-cost-control.policy.yaml", "utf-8");
const policy = parsePolicy(policyYaml);
const evalResult = evaluate(events, policy);

console.log(`📋 Policy verdict: ${evalResult.verdict} (exit code ${evalResult.exitCode})`);

if (evalResult.violations.length > 0) {
  console.log(`⚠️  Violations:`);
  for (const v of evalResult.violations) {
    console.log(`   - [${v.severity}] ${v.ruleId}: ${v.message}`);
  }
}

// ---------------------------------------------------------------------------
// That's it! In CI, you'd run:
//   krynix evaluate --trace traces/my-session.trace.jsonl --policy policies/
//   krynix replay --verify --trace traces/my-session.trace.jsonl
// ---------------------------------------------------------------------------
