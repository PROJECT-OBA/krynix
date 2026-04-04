# @krynix/adapter-langchain

LangChain adapter for Krynix. Translates LangChain callback events into Krynix trace events with zero runtime dependency on LangChain.

## Integration Modes

### 1. Zero-friction plugin (recommended)

```typescript
import { createLangChainTracer } from "@krynix/adapter-langchain";

const { handler, handle } = await createLangChainTracer({
  agentId: "my-agent",
  outputPath: "./traces/my-agent.trace.jsonl",
});

// Pass handler to LangChain — all events captured automatically
const result = await chain.invoke(input, {
  callbacks: [handler],
});

await handle.shutdown();
```

### 2. Manual adapter (fine-grained control)

```typescript
import { LangChainAdapter } from "@krynix/adapter-langchain";

// Constructor takes no arguments; config goes to initialize()
// AdapterConfig requires agentId and sessionId (from startSession())
const adapter = new LangChainAdapter();
await adapter.initialize({ agentId: "my-agent", sessionId: "your-session-id" });
const traceEvent = adapter.onEvent(langchainCallbackEvent);
```

## Callbacks Handled

`handleLLMStart`, `handleLLMEnd`, `handleLLMError`, `handleToolStart`, `handleToolEnd`, `handleToolError`, `handleChainStart`, `handleChainEnd`, `handleChainError`

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
