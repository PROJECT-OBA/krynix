# @krynix/adapter-openclaw

OpenClaw adapter for Krynix. Translates OpenClaw plugin hook events into Krynix trace events with zero runtime dependency on OpenClaw.

## Integration Modes

### 1. Zero-friction plugin (recommended)

```typescript
import { createKrynixPlugin } from "@krynix/adapter-openclaw";

const plugin = createKrynixPlugin({
  agentId: "my-agent",
  outputPath: "./traces",
});

// Register with OpenClaw
agent.use(plugin.handler);

await plugin.stop();
```

### 2. Manual adapter (fine-grained control)

```typescript
import { OpenClawAdapter } from "@krynix/adapter-openclaw";

const adapter = new OpenClawAdapter({ agentId: "my-agent" });
const event = adapter.translate(hookEvent);
```

## Hooks Handled

`before_tool_call`, `after_tool_call`, `llm_input`, `llm_output`, `session_start`, `session_end`

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
