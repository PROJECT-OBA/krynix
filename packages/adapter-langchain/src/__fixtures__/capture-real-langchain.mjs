/**
 * Capture script for real LangChain callback shapes.
 *
 * Run from `packages/adapter-langchain`:
 *
 *   node src/__fixtures__/capture-real-langchain.mjs > /tmp/real-lc.json
 *
 * Compare `/tmp/real-lc.json` to the committed `real-langchain-callbacks.json`
 * and update the fixture if the wire shape has drifted (e.g. after bumping
 * `@langchain/core`). This script is NOT run as part of the test suite —
 * `e2e-langchain.test.ts` exercises the same library dynamically and is the
 * drift detector; the JSON fixture is the offline reference used by lighter
 * tests that do not want to instantiate real LangChain objects.
 *
 * Excluded from `tsconfig.json` (`.mjs` is not in `include: ["src/**\/*.ts"]`)
 * and from the `tsup` build (entry is only `src/index.ts`).
 */
import { DynamicTool } from "@langchain/core/tools";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { FakeListChatModel } from "@langchain/core/utils/testing";

class Recorder extends BaseCallbackHandler {
  name = "recorder";
  constructor() {
    super();
    this.events = [];
  }
  async handleLLMStart(llm, prompts, runId, parentRunId, extraParams, tags, metadata, runName) {
    this.events.push({
      _callback: "handleLLMStart",
      serialized: llm,
      prompts,
      runId,
      parentRunId,
      extraParams,
      tags,
      metadata,
      runName,
    });
  }
  async handleLLMEnd(output, runId, parentRunId, tags) {
    this.events.push({ _callback: "handleLLMEnd", output, runId, parentRunId, tags });
  }
  async handleToolStart(tool, input, runId, parentRunId, tags, metadata, runName) {
    this.events.push({
      _callback: "handleToolStart",
      tool,
      input,
      runId,
      parentRunId,
      tags,
      metadata,
      runName,
    });
  }
  async handleToolEnd(output, runId, parentRunId, tags) {
    this.events.push({ _callback: "handleToolEnd", output, runId, parentRunId, tags });
  }
  async handleChainStart(chain, inputs, runId, parentRunId, tags, metadata, runType, runName) {
    this.events.push({
      _callback: "handleChainStart",
      chain,
      inputs,
      runId,
      parentRunId,
      tags,
      metadata,
      runType,
      runName,
    });
  }
  async handleChainEnd(outputs, runId, parentRunId, tags) {
    this.events.push({ _callback: "handleChainEnd", outputs, runId, parentRunId, tags });
  }
}

const rec = new Recorder();

// 1. Real DynamicTool — this is the shape that broke A1 in production.
const webSearchTool = new DynamicTool({
  name: "web_search",
  description: "search the web",
  func: async (q) => `search results for: ${q}`,
});
await webSearchTool.invoke("what is langchain", { callbacks: [rec] });

// 2. Real FakeListChatModel — captures llm_request/llm_response shape.
const fakeLlm = new FakeListChatModel({ responses: ["the answer is 42"] });
await fakeLlm.invoke("what is the meaning of life", { callbacks: [rec] });

// Output the raw captured events as JSON. runIds are real UUIDs produced by this
// run — manually replace them with deterministic values (e.g. "fixture-tool-run-1")
// before committing the output as `real-langchain-callbacks.json`.
console.log(JSON.stringify(rec.events, null, 2));
