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
 * Run from monorepo root after `pnpm build`:
 *   npx tsx examples/langchain-quickstart.ts
 */

import { createLangChainTracer } from "@krynix/adapter-langchain";
import { readTrace, validateHashChain } from "@krynix/core";
import { evaluate, parsePolicy } from "@krynix/policy";
import { verifyTrace } from "@krynix/replay";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Step 1: Create a Krynix tracer (one line of setup)
// ---------------------------------------------------------------------------

const TRACE_PATH = "traces/my-session.trace.jsonl";
await mkdir("traces", { recursive: true });

const { handler, handle } = await createLangChainTracer({
  agentId: "my-langchain-agent",
  outputPath: TRACE_PATH,
  replaySeed: 42, // optional — enables deterministic replay
});

// ---------------------------------------------------------------------------
// Step 2: Pass `handler` to your LangChain chain/agent as a callback
//
// In a real integration:
//   await chain.invoke({ input: "..." }, { callbacks: [handler] });
//
// Below we simulate a LangChain agent run by calling handler methods directly.
// ---------------------------------------------------------------------------

// LLM decides to call a tool
await handler.handleLLMStart(
  { name: "ChatAnthropic" },
  ["Find recent security patches for express.js"],
  "run-1",
  undefined,
  { name: "claude-sonnet-4-6-20260315" },
);

await handler.handleLLMEnd(
  {
    generations: [
      [
        {
          text: "I'll search for recent security patches.",
          generationInfo: { finish_reason: "tool_calls" },
        },
      ],
    ],
    llmOutput: {
      tokenUsage: { promptTokens: 100, completionTokens: 25 },
      model_name: "claude-sonnet-4-6-20260315",
    },
  },
  "run-1",
);

// Tool call: web search
await handler.handleToolStart(
  { name: "web_search" },
  "express.js security patches 2026",
  "run-tool-1",
  "run-1",
);

await handler.handleToolEnd(
  JSON.stringify([{ title: "Express 5.1.2 security patch", severity: "high" }]),
  "run-tool-1",
  "run-1",
);

// LLM produces final response
await handler.handleLLMStart(
  { name: "ChatAnthropic" },
  ["Based on the search, here are the findings..."],
  "run-2",
  undefined,
  { name: "claude-sonnet-4-6-20260315" },
);

await handler.handleLLMEnd(
  {
    generations: [
      [
        {
          text: "Found 1 critical security patch for Express 5.1.2.",
          generationInfo: { finish_reason: "stop" },
        },
      ],
    ],
    llmOutput: {
      tokenUsage: { promptTokens: 200, completionTokens: 40 },
      model_name: "claude-sonnet-4-6-20260315",
    },
  },
  "run-2",
);

// ---------------------------------------------------------------------------
// Step 3: Shut down the tracer (writes session_end event, closes file)
// ---------------------------------------------------------------------------

await handle.shutdown();

console.log(`\nTrace written to: ${TRACE_PATH}`);

// ---------------------------------------------------------------------------
// Step 4: Verify trace integrity
// ---------------------------------------------------------------------------

const events = await readTrace(TRACE_PATH);
const hashResult = validateHashChain(events);
console.log(`Hash chain valid: ${hashResult.valid}`);

const replayResult = await verifyTrace(TRACE_PATH);
console.log(`Replay verify: ${replayResult.status} (${replayResult.report?.totalEvents} events)`);

// ---------------------------------------------------------------------------
// Step 5: Evaluate policies
// ---------------------------------------------------------------------------

// Load a policy file (YAML)
const policyYaml = readFileSync("policies/examples/llm-cost-control.policy.yaml", "utf-8");
const policy = parsePolicy(policyYaml);
const evalResult = evaluate(events, policy);

console.log(`Policy verdict: ${evalResult.verdict} (exit code ${evalResult.exitCode})`);

if (evalResult.violations.length > 0) {
  console.log(`Violations:`);
  for (const v of evalResult.violations) {
    console.log(`   - [${v.severity}] ${v.ruleId}: ${v.message}`);
  }
}

// ---------------------------------------------------------------------------
// That's it! In CI, you'd run:
//   krynix evaluate --trace traces/my-session.trace.jsonl --policy policies/
//   krynix replay --verify --trace traces/my-session.trace.jsonl
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Advanced: Manual adapter approach (fine-grained control)
//
// If you need per-event control (e.g., custom metadata, conditional recording),
// use the LangChainAdapter class directly:
//
//   import { LangChainAdapter } from "@krynix/adapter-langchain";
//   import { startSession, recordEvent, endSession } from "@krynix/core";
//
//   const adapter = new LangChainAdapter();
//   await adapter.initialize({ agentId: "my-agent", sessionId: "s1" });
//   const session = await startSession({ agentId: "my-agent", outputPath: "trace.jsonl" });
//
//   // For each callback:
//   const traceEvent = adapter.onEvent({ _callback: "handleToolStart", ... });
//   if (traceEvent) await recordEvent(session, { ...traceEvent });
//
//   await endSession(session);
// ---------------------------------------------------------------------------
