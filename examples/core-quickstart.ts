/**
 * Core Quickstart — Krynix trace recording without any adapter.
 *
 * This example shows how to instrument a plain TypeScript agent
 * using @krynix/core directly. The trace file is written to
 * YOUR project's directory.
 *
 * Run:
 *   mkdir -p traces
 *   npx tsx examples/core-quickstart.ts
 *
 * Then verify:
 *   node packages/cli/dist/main.js replay --verify --trace ./traces/quickstart-session.trace.jsonl
 *   node packages/cli/dist/main.js evaluate --trace ./traces/quickstart-session.trace.jsonl --policy examples/sample.policy.yaml
 */

import { startSession, recordEvent, endSession } from "@krynix/core";

const AGENT_ID = "quickstart-agent";
const TRACE_PATH = "./traces/quickstart-session.trace.jsonl";

async function main(): Promise<void> {
  // 1. Start a session — opens TRACE_PATH for writing and records session_start
  const session = await startSession({
    agentId: AGENT_ID,
    outputPath: TRACE_PATH,
  });

  // 2. Record a tool call
  await recordEvent(session, {
    event_type: "tool_call",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: AGENT_ID,
    metadata: null,
    payload: {
      tool_name: "web_search",
      arguments: { query: "TypeScript best practices" },
    },
  });

  // 3. Record the result
  await recordEvent(session, {
    event_type: "tool_result",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: AGENT_ID,
    metadata: null,
    payload: {
      tool_name: "web_search",
      output: "Found 10 results about TypeScript best practices.",
      duration_ms: 200,
      exit_code: 0,
    },
  });

  // 4. Record an LLM request
  await recordEvent(session, {
    event_type: "llm_request",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: AGENT_ID,
    metadata: null,
    payload: {
      model: "gpt-4",
      messages: [{ role: "user", content: "Summarize the search results." }],
    },
  });

  // 5. Record the LLM response
  await recordEvent(session, {
    event_type: "llm_response",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: AGENT_ID,
    metadata: null,
    payload: {
      model: "gpt-4",
      content: "Here are the key TypeScript best practices...",
      usage: { prompt_tokens: 50, completion_tokens: 100 },
      finish_reason: "stop",
    },
  });

  // 6. End session — writes session_end and closes the trace file
  await endSession(session);

  console.log(`Trace written to: ${TRACE_PATH}`);
  console.log(`Session ID: ${session.sessionId}`);
}

main().catch(console.error);
