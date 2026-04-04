/**
 * Core Quickstart — Krynix trace recording without any adapter.
 *
 * This example shows how to instrument a plain TypeScript agent
 * using @krynix/core directly. The trace file is written to
 * YOUR project's ./traces/ directory.
 *
 * Run:
 *   npx tsx examples/core-quickstart.ts
 *
 * Then verify:
 *   node packages/cli/dist/main.js replay --verify --trace ./traces/
 *   node packages/cli/dist/main.js evaluate --trace ./traces/ --policy examples/sample.policy.yaml
 */

import {
  startSession,
  recordEvent,
  endSession,
  TraceWriter,
} from "@krynix/core";

async function main(): Promise<void> {
  // 1. Create a trace writer — outputPath is where traces are saved
  const writer = new TraceWriter({ outputPath: "./traces" });

  // 2. Start a session
  const session = startSession({ agentId: "quickstart-agent" });

  // 3. Record a tool call
  recordEvent(session, {
    event_type: "tool_call",
    payload: {
      tool_name: "web_search",
      arguments: { query: "TypeScript best practices" },
    },
  });

  // 4. Record the result
  recordEvent(session, {
    event_type: "tool_result",
    payload: {
      tool_name: "web_search",
      output: "Found 10 results about TypeScript best practices.",
      duration_ms: 200,
      exit_code: 0,
    },
  });

  // 5. Record an LLM request
  recordEvent(session, {
    event_type: "llm_request",
    payload: {
      model: "gpt-4",
      messages: [
        { role: "user", content: "Summarize the search results." },
      ],
    },
  });

  // 6. Record the LLM response
  recordEvent(session, {
    event_type: "llm_response",
    payload: {
      model: "gpt-4",
      content: "Here are the key TypeScript best practices...",
      usage: {
        prompt_tokens: 50,
        completion_tokens: 100,
      },
      finish_reason: "stop",
    },
  });

  // 7. End session and write trace
  const events = endSession(session);
  await writer.writeEvents(events);

  console.log("Trace written to ./traces/");
  console.log(`Session: ${session.sessionId}`);
  console.log(`Events: ${events.length}`);
}

main().catch(console.error);
