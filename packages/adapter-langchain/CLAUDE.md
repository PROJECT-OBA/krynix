# @krynix/adapter-langchain

Translates LangChain callback events into Krynix TraceEvents. Depends on `@krynix/core` only.

## Callbacks Handled

`handleLLMStart`, `handleLLMEnd`, `handleToolStart`, `handleToolEnd`, `handleChainStart`, `handleChainEnd`

## Key Behavior

- Zero runtime dependency on LangChain — accepts `unknown` input, validates shape.
- `normalizeFinishReason()` maps provider-specific strings to canonical `FinishReason` (`stop`, `max_tokens`, `tool_use`).
- `runIdToToolName` map tracks tool call correlation across start/end events.
- `replaySeed` is optional — `undefined` means no seed.
