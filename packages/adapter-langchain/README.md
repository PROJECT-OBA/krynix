# @krynix/adapter-langchain

LangChain adapter for [Krynix](https://github.com/PROJECT-OBA/krynix) — translates LangChain callback events into Krynix trace events.

## Install

```bash
npm install @krynix/adapter-langchain
```

## Usage

### Zero-friction plugin (recommended)

```typescript
import { createLangChainTracer } from "@krynix/adapter-langchain";

const { handler, handle } = await createLangChainTracer({
  outputPath: "./traces/run.trace.jsonl",
  agentId: "my-agent",
});

// Pass handler to LangChain — all events captured automatically
const result = await chain.invoke(input, {
  callbacks: [handler],
});

// When done, shut down to finalize the trace file
await handle.shutdown();
```

### Manual adapter (fine-grained control)

```typescript
import { LangChainAdapter } from "@krynix/adapter-langchain";

const adapter = new LangChainAdapter();
await adapter.initialize({ agentId: "my-agent", sessionId: "s1" });

// Map a LangChain callback event to a Krynix TraceEvent
const traceEvent = adapter.onEvent({
  _callback: "handleToolStart",
  tool: { lc: 1, type: "not_implemented", id: ["langchain", "tools", "Calculator"] },
  input: "query string",
  runId: "run-123",
  runName: "my_calculator",
});
```

## Callbacks Handled

`handleLLMStart`, `handleLLMEnd`, `handleLLMError`, `handleToolStart`, `handleToolEnd`, `handleToolError`, `handleChainStart`, `handleChainEnd`, `handleChainError`, `handleAgentAction`, `handleAgentFinish`

## Key Behavior

- Zero runtime dependency on LangChain — accepts `unknown` input, validates shape
- `normalizeFinishReason()` maps provider-specific strings to canonical finish reasons
- Tool call timing tracked via `metadata["tool.duration_ms"]` for replay determinism

## License

MIT
