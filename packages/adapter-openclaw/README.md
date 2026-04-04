# @krynix/adapter-openclaw

OpenClaw adapter for Krynix. Translates OpenClaw plugin hook events into Krynix trace events with zero runtime dependency on OpenClaw.

## Integration Modes

### 1. Zero-friction plugin (recommended)

```typescript
import { createKrynixPlugin } from "@krynix/adapter-openclaw";

// createKrynixPlugin returns a plugin initializer function.
// Export it as the default from your OpenClaw extensions file:
//   extensions/krynix/index.ts
export default createKrynixPlugin({
  outputPath: "./traces/my-agent.trace.jsonl",
  agentId: "my-agent",
});

// OpenClaw calls the initializer with its plugin API.
// To get the handle for programmatic shutdown:
//   const handle = await initPlugin(api);
//   await handle.shutdown();
```

### 2. Manual adapter (fine-grained control)

```typescript
import { OpenClawAdapter } from "@krynix/adapter-openclaw";

// Constructor takes no arguments; config goes to initialize()
// AdapterConfig requires agentId and sessionId (from startSession())
const adapter = new OpenClawAdapter();
await adapter.initialize({ agentId: "my-agent", sessionId: "your-session-id" });
const traceEvent = adapter.onEvent(hookEvent);
```

## Hooks Handled

`before_tool_call`, `after_tool_call`, `llm_input`, `llm_output`, `session_start`, `session_end`

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
