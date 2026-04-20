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

const tracer = createLangChainTracer({
  outputPath: "./traces/run.jsonl",
});

// Pass as a callback to any LangChain component
const result = await chain.invoke(input, {
  callbacks: [tracer],
});
```

### Manual adapter (fine-grained control)

```typescript
import { LangChainAdapter } from "@krynix/adapter-langchain";

const adapter = new LangChainAdapter(config);
const traceEvent = adapter.handleLLMStart(runId, input);
```

## Callbacks Handled

`handleLLMStart`, `handleLLMEnd`, `handleLLMError`, `handleToolStart`, `handleToolEnd`, `handleToolError`, `handleChainStart`, `handleChainEnd`, `handleChainError`, `handleAgentAction`, `handleAgentFinish`

## Key Behavior

- Zero runtime dependency on LangChain — accepts `unknown` input, validates shape
- `normalizeFinishReason()` maps provider-specific strings to canonical finish reasons
- Tool call timing tracked via `metadata["tool.duration_ms"]` for replay determinism

## License

MIT
