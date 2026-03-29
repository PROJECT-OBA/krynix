# @krynix/adapter-langchain

Translates LangChain callback events into Krynix TraceEvents. Depends on `@krynix/core` only.

## Two Integration Modes

### 1. Zero-friction plugin (recommended)

`createLangChainTracer()` in `plugin.ts` — manages session lifecycle, event recording, and write queue serialization. Returns a `BaseCallbackHandler`-compatible object users pass directly to LangChain.

### 2. Manual adapter (fine-grained control)

`LangChainAdapter` in `adapter.ts` — maps individual callbacks to TraceEvents. User manages session and recording themselves.

## Callbacks Handled

`handleLLMStart`, `handleLLMEnd`, `handleLLMError`, `handleToolStart`, `handleToolEnd`, `handleToolError`, `handleChainStart`, `handleChainEnd`, `handleChainError`

## Key Behavior

- Zero runtime dependency on LangChain — accepts `unknown` input, validates shape.
- `normalizeFinishReason()` maps provider-specific strings to canonical `FinishReason` (`stop`, `max_tokens`, `tool_use`).
- `runIdToToolName` map tracks tool call correlation across start/end events.
- `replaySeed` is optional — `undefined` means no seed.
- Plugin uses write queue (same pattern as `@krynix/adapter-openclaw` plugin) to serialize concurrent callbacks.
