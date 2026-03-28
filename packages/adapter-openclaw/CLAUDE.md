# @krynix/adapter-openclaw

Translates OpenClaw plugin hook events into Krynix TraceEvents. Depends on `@krynix/core` only.

## Hooks Handled

`before_tool_call`, `after_tool_call`, `llm_input`, `llm_output`, `session_start`, `session_end`

## Key Behavior

- Zero runtime dependency on OpenClaw — accepts `unknown` input, validates shape.
- `onSkippedEvent` callback for diagnostics on dropped events.
- `replaySeed` is optional — `undefined` means no seed.
- `exit_code: 1` is emitted in `tool_result` payload when `hookEvent.event.error` is set.
