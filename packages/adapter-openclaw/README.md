# @krynix/adapter-openclaw

OpenClaw adapter for [Krynix](https://github.com/PROJECT-OBA/krynix) — translates OpenClaw plugin hook events into Krynix trace events.

## Install

```bash
npm install @krynix/adapter-openclaw
```

## Usage

```typescript
import { createKrynixPlugin } from "@krynix/adapter-openclaw";

// In an OpenClaw extensions/krynix/index.ts:
export default createKrynixPlugin({
  outputPath: "./traces/run.trace.jsonl",
});
```

## Hooks Handled

`before_tool_call`, `after_tool_call`, `llm_input`, `llm_output`, `session_start`, `session_end`

## Key Behavior

- Zero runtime dependency on OpenClaw — accepts `unknown` input, validates shape
- `onSkippedEvent` callback for diagnostics on dropped events
- `exit_code: 1` emitted in `tool_result` payload when `hookEvent.event.error` is set

## License

MIT
