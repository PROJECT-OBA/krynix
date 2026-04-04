# @krynix/adapter-langchain

LangChain adapter for Krynix. Translates LangChain callback events into Krynix trace events with zero runtime dependency on LangChain.

## Integration Modes

### 1. Zero-friction plugin (recommended)

```typescript
import { createLangChainTracer } from "@krynix/adapter-langchain";

const tracer = createLangChainTracer({
  agentId: "my-agent",
  outputPath: "./traces",
});

// Pass tracer.handler as a LangChain callback
const result = await chain.invoke(input, {
  callbacks: [tracer.handler],
});

await tracer.stop();
```

### 2. Manual adapter (fine-grained control)

```typescript
import { LangChainAdapter } from "@krynix/adapter-langchain";

const adapter = new LangChainAdapter({ agentId: "my-agent" });
const event = adapter.handleLLMEnd(llmResult);
```

## Callbacks Handled

`handleLLMStart`, `handleLLMEnd`, `handleLLMError`, `handleToolStart`, `handleToolEnd`, `handleToolError`, `handleChainStart`, `handleChainEnd`, `handleChainError`

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
