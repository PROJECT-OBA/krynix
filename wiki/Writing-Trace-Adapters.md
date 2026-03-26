# Writing Trace Adapters

A **Trace Adapter** bridges an agent framework to Krynix's canonical TraceEvent format. This guide explains how to create an adapter for your framework.

## What an Adapter Does

```
Your Agent Framework  -->  Your Adapter  -->  Krynix TraceEvents  -->  .trace.jsonl
```

An adapter:
1. Hooks into your framework's event system (callbacks, hooks, event emitters)
2. Converts framework-specific events into Krynix `TraceEvent` format
3. Returns structured events that Krynix core processes (redaction, hash chain, persistence)

## Adapter Interface

Every adapter implements the `TraceAdapter` interface:

```typescript
interface TraceAdapter {
  /** Unique adapter identifier, e.g., "openclaw". */
  readonly name: string;

  /** Adapter version (semver). */
  readonly version: string;

  /** Initialize the adapter. Called once before any events. */
  initialize(config: AdapterConfig): Promise<void>;

  /** Convert a framework event to a TraceEvent. Return null to skip. */
  onEvent(frameworkEvent: unknown): TraceEvent | null;

  /** Drain any buffered events before shutdown. */
  flush(): Promise<TraceEvent[]>;

  /** Release resources. Called once after all events. */
  shutdown(): Promise<void>;
}

interface AdapterConfig {
  agentId: string;
  sessionId: string;
  /** Replay seed for deterministic operations. */
  replaySeed: number;
  /** Additional adapter-specific configuration. */
  options?: Record<string, unknown>;
}
```

**Lifecycle:** `initialize → [onEvent...] → flush → shutdown`

## Event Type Mapping

Map your framework's events to Krynix's 8 event types:

| Framework Event | Krynix Event Type | When to Use |
|----------------|-------------------|-------------|
| Tool/function call initiated | `tool_call` | Agent invokes a tool |
| Tool/function returns | `tool_result` | Tool execution completes |
| LLM API request sent | `llm_request` | Prompt sent to model |
| LLM API response received | `llm_response` | Model response received |
| Agent reasoning step | `decision` | Internal decision point |
| Environment read | `observation` | Agent observes external state |
| Exception/failure | `error` | Something went wrong |
| Session start/end | `lifecycle` | Session boundaries |

## Step-by-Step Guide

### 1. Create the Package

```bash
mkdir -p packages/adapter-myframework/src
cd packages/adapter-myframework
```

Create `package.json`:

```json
{
  "name": "@krynix/adapter-myframework",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@krynix/core": "workspace:*"
  }
}
```

### 2. Implement the Adapter

```typescript
// src/adapter.ts
import type { TraceAdapter, TraceEvent, AdapterConfig } from "@krynix/core";

interface MyFrameworkEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export class MyFrameworkAdapter implements TraceAdapter {
  readonly name = "myframework";
  readonly version = "0.1.0";

  private config: AdapterConfig | null = null;

  async initialize(config: AdapterConfig): Promise<void> {
    this.config = config;
  }

  onEvent(event: unknown): TraceEvent | null {
    if (this.config === null) return null;
    const fwEvent = event as MyFrameworkEvent;

    switch (fwEvent.type) {
      case "tool_invoke":
        return this.mapToolCall(fwEvent);
      case "tool_complete":
        return this.mapToolResult(fwEvent);
      case "llm_call":
        return this.mapLlmRequest(fwEvent);
      case "llm_response":
        return this.mapLlmResponse(fwEvent);
      default:
        return null; // Ignore unknown events
    }
  }

  async flush(): Promise<TraceEvent[]> {
    return [];
  }

  async shutdown(): Promise<void> {
    this.config = null;
  }

  private mapToolCall(event: MyFrameworkEvent): TraceEvent {
    const cfg = this.config;
    if (cfg === null) throw new Error("Adapter not initialized");

    return {
      event_id: "", // Filled by session manager
      session_id: cfg.sessionId,
      sequence_num: 0, // Filled by session manager
      timestamp: event.timestamp,
      event_type: "tool_call",
      agent_id: cfg.agentId,
      payload: {
        tool_name: event.data["tool_name"] as string,
        arguments: event.data["args"] as Record<string, unknown>,
      },
      redacted: false,
      prev_hash: "", // Filled by hash chain
      event_hash: "", // Filled by hash chain
      schema_version: "1.0.0",
    };
  }

  // ... similar methods for other event types
}
```

### 3. Handle Optional Fields

Only include optional fields when they have values:

```typescript
private mapToolCall(event: MyFrameworkEvent): TraceEvent {
  const payload: Record<string, unknown> = {
    tool_name: event.data["tool_name"],
    arguments: event.data["args"],
  };

  // Only include approval_status when present
  if (event.data["approval"] !== undefined) {
    payload["approval_status"] = event.data["approval"];
  }

  return { /* ... */ payload, /* ... */ };
}
```

This prevents `undefined` values from leaking into the payload.

### 4. Add Tests

```typescript
// src/adapter.test.ts
import { describe, test, expect } from "vitest";
import { MyFrameworkAdapter } from "./adapter.js";

describe("MyFrameworkAdapter", () => {
  test("onEvent before initialize returns null", () => {
    const adapter = new MyFrameworkAdapter();
    expect(adapter.onEvent({ type: "tool_invoke", data: {}, timestamp: "..." })).toBeNull();
  });

  test("maps tool_invoke to tool_call event", async () => {
    const adapter = new MyFrameworkAdapter();
    await adapter.initialize({ agentId: "agent-1", sessionId: "session-1", replaySeed: 42 });

    const result = adapter.onEvent({
      type: "tool_invoke",
      data: { tool_name: "file_read", args: { path: "/tmp/f.txt" } },
      timestamp: "2026-01-15T12:00:00.000Z",
    });

    expect(result).not.toBeNull();
    expect(result!.event_type).toBe("tool_call");
    expect(result!.payload.tool_name).toBe("file_read");
  });

  test("ignores unknown event types", async () => {
    const adapter = new MyFrameworkAdapter();
    await adapter.initialize({ agentId: "agent-1", sessionId: "session-1", replaySeed: 42 });

    expect(adapter.onEvent({ type: "internal_debug", data: {}, timestamp: "..." })).toBeNull();
  });
});
```

### 5. Export from Index

```typescript
// src/index.ts
export { MyFrameworkAdapter } from "./adapter.js";
```

## Reference Implementation

The OpenClaw adapter (`packages/adapter-openclaw/`) is the reference implementation. Study it for:
- How to map framework-specific hook events to TraceEvents
- How to handle `session_start` and `session_end` lifecycle events
- How to conditionally include optional fields
- How to provide a default policy file

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| `undefined` in payload | Only include fields when defined |
| `onEvent` before `initialize` | Guard with null config check, return null |
| Missing `timestamp` | Always use the framework's timestamp, not `Date.now()` |
| Large payloads | Redaction handles secrets, but consider trimming very large tool outputs |
| Non-string `agent_id` | Convert to string if your framework uses numeric IDs |

## See Also

- [[Trace]] -- TraceEvent format and hash chain
- [[TraceEvent Schema]] -- Complete field reference
- [Integration Contracts](https://github.com/PROJECT-OBA/krynix/blob/main/docs/10_architecture/integration_contracts.md) -- Adapter interface specification
- [OpenClaw Adapter Source](https://github.com/PROJECT-OBA/krynix/tree/main/packages/adapter-openclaw/src) -- Reference implementation
