# Integration Contracts

This document defines how external agent frameworks integrate with Krynix. It specifies the Trace Adapter interface, event mapping requirements, Policy Gate invocation, and SDK contract.

See [glossary](../00_overview/glossary.md) for term definitions. See [trace_spec](trace_spec.md) for the TraceEvent format. See [architecture](architecture.md) for where adapters fit in the pipeline.

## Overview

Krynix does not run agents. External agent frameworks (LangChain, OpenClaw, custom implementations) run agents and produce framework-specific events. Krynix provides a **Trace Adapter** interface that converts these events into canonical TraceEvents for evaluation and replay.

> **Note:** The ingress pattern (who receives the user request first) varies by deployment mode. In passive mode, Krynix observes after the fact. In sidecar or hybrid modes, a control surface may intercept before agent execution. See [platform_architecture_spec.md](platform_architecture_spec.md) for deployment mode definitions.

```
Agent Framework → Trace Adapter → Krynix Pipeline
```

## Trace Adapter Interface

Every Trace Adapter must implement the following interface:

```typescript
interface TraceAdapter {
  /** Unique adapter identifier, e.g., "openclaw" */
  readonly name: string;

  /** Adapter version (semver) */
  readonly version: string;

  /**
   * Initialize the adapter with configuration.
   * Called once before any events are processed.
   */
  initialize(config: AdapterConfig): Promise<void>;

  /**
   * Convert a single external framework event to a TraceEvent.
   * Return null to skip events that have no Krynix equivalent.
   */
  onEvent(externalEvent: unknown): TraceEvent | null;

  /**
   * Drain any buffered events.
   * Called before shutdown to ensure no events are lost.
   */
  flush(): Promise<TraceEvent[]>;

  /**
   * Clean up adapter resources.
   * Called once after all events are processed.
   */
  shutdown(): Promise<void>;
}

interface AdapterConfig {
  /** Agent ID to stamp on all produced TraceEvents */
  agentId: string;

  /** Session ID for this execution */
  sessionId: string;

  /**
   * Replay seed for deterministic operations.
   * Must be a safe integer (<= Number.MAX_SAFE_INTEGER, i.e., 2^53 - 1).
   * Seeds exceeding this range must be rejected at initialization.
   */
  replaySeed: number;

  /** Additional adapter-specific configuration */
  options?: Record<string, unknown>;
}
```

## Adapter Lifecycle

```
initialize(config) → [onEvent(e1), onEvent(e2), ...] → flush() → shutdown()
```

1. **`initialize`** — Called once. Sets up internal state, stores `agentId` and `sessionId` from config. The adapter must NOT produce a `lifecycle:session_start` event — Krynix core handles session lifecycle.

2. **`onEvent`** — Called for each external framework event. Returns a TraceEvent or `null` (to skip irrelevant events). Must be synchronous and side-effect-free for determinism.

3. **`flush`** — Called before shutdown. Returns any buffered TraceEvents that `onEvent` accumulated but did not return individually (e.g., for batching or aggregation).

4. **`shutdown`** — Called once. Releases resources. Must not produce events.

## Event Mapping Requirements

Adapters must satisfy these constraints:

### Required

- All produced TraceEvents must conform to the [TraceEvent schema](trace_spec.md#traceevent-schema)
- `agent_id` must be set from `AdapterConfig.agentId`
- `session_id` must be set from `AdapterConfig.sessionId`
- `schema_version` must be `"1.0.0"`
- `event_type` must be one of the 8 canonical types
- `sequence_num` is NOT set by the adapter — Krynix core assigns sequence numbers after collecting events from the adapter
- `event_id` is NOT set by the adapter — Krynix core assigns deterministic event IDs (seeded by `replaySeed`) to ensure replay compatibility
- `prev_hash` and `event_hash` are NOT set by the adapter — Krynix core computes these after sequencing

### Recommended

- Set `parent_id` for causal linking (e.g., `tool_result` → `tool_call`)
- Map `timestamp` from the external event's timestamp if available, otherwise use the adapter's processing time
- Preserve as much structured data as possible in `payload` for policy matching

### Prohibited

- Adapters must NOT compute hash chain values
- Adapters must NOT apply redaction (Krynix core handles this)
- Adapters must NOT modify the `metadata` field reserved keys (prefix `_krynix_`)
- Adapters should use mandatory metadata namespace prefixes (`intent.*`, `guard.*`, `runtime.*`, `output.*`) for keys inside the `metadata` object. The `metadata.intent.*` notation in the [canonical spec](platform_architecture_spec.md) denotes the parent object path, not a literal key prefix.

## Policy Gate Integration

### CLI Invocation

The Policy Gate is invoked via the Krynix CLI:

```bash
krynix evaluate --trace <trace-file> --policy <path>
```

**Arguments:**
- `--trace` — path to a `.trace.jsonl` file
- `--policy` — path to a directory of `.policy.yaml` files or a single `.policy.yaml` file

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | All policies pass |
| 1 | One or more `error`-severity violations |
| 2 | One or more `critical`-severity violations |
| 3 | `require-approval` triggered, no fail-level violations |

**Stdout:** Structured JSON report of all violations.

### CI Pipeline Integration

```yaml
# GitHub Actions example
- name: Evaluate trace against policies
  run: krynix evaluate --trace traces/session.trace.jsonl --policy policies/
```

The exit code determines the CI step result. Non-zero exits fail the step and block merge.

## OpenClaw Example

OpenClaw is used here as an illustrative example of how a framework-specific Trace Adapter integrates with Krynix. The interface below represents OpenClaw's assumed callback model.

### OpenClaw Callback Interface (assumed)

```typescript
// OpenClaw's native event callback interface
interface OpenClawHooks {
  onToolCall(event: {
    toolId: string;
    toolName: string;
    args: Record<string, unknown>;
    timestamp: string;
  }): void;

  onToolResult(event: {
    toolId: string;
    toolName: string;
    result: unknown;
    durationMs: number;
    timestamp: string;
  }): void;

  onLLMCall(event: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    params: Record<string, unknown>;
    timestamp: string;
  }): void;

  onLLMResponse(event: {
    model: string;
    content: string;
    usage: { promptTokens: number; completionTokens: number };
    finishReason: string;
    timestamp: string;
  }): void;
}
```

### OpenClaw Trace Adapter Implementation

```typescript
import { TraceAdapter, AdapterConfig, TraceEvent } from "@krynix/core";

export class OpenClawAdapter implements TraceAdapter {
  readonly name = "openclaw";
  readonly version = "1.0.0";

  private agentId!: string;
  private sessionId!: string;
  private pendingToolCalls = new Map<string, number>(); // toolId → index in emitted events
  private eventIndex = 0;

  async initialize(config: AdapterConfig): Promise<void> {
    this.agentId = config.agentId;
    this.sessionId = config.sessionId;
  }

  onEvent(externalEvent: unknown): TraceEvent | null {
    const event = externalEvent as Record<string, unknown>;
    const type = event._type as string;

    switch (type) {
      case "tool_call":
        return this.mapToolCall(event);
      case "tool_result":
        return this.mapToolResult(event);
      case "llm_call":
        return this.mapLLMRequest(event);
      case "llm_response":
        return this.mapLLMResponse(event);
      default:
        return null; // Skip unknown event types
    }
  }

  async flush(): Promise<TraceEvent[]> {
    return []; // No buffering in this adapter
  }

  async shutdown(): Promise<void> {
    this.pendingToolCalls.clear();
  }

  private mapToolCall(event: Record<string, unknown>): TraceEvent {
    const index = this.eventIndex++;
    this.pendingToolCalls.set(event.toolId as string, index);

    return {
      event_id: "",        // Assigned by Krynix core (deterministic, seeded)
      session_id: this.sessionId,
      sequence_num: 0,     // Assigned by Krynix core
      timestamp: event.timestamp as string,
      event_type: "tool_call",
      parent_id: null,
      agent_id: this.agentId,
      payload: {
        tool_name: event.toolName as string,
        arguments: event.args as Record<string, unknown>,
      },
      redacted: false,
      prev_hash: "",       // Computed by Krynix core
      event_hash: "",      // Computed by Krynix core
      metadata: { "runtime.adapter": "openclaw" },
      schema_version: "1.0.0",
    };
  }

  private mapToolResult(event: Record<string, unknown>): TraceEvent {
    // parent_id linking is handled by Krynix core using adapter-local
    // correlation hints stored in metadata.
    this.pendingToolCalls.delete(event.toolId as string);

    return {
      event_id: "",
      session_id: this.sessionId,
      sequence_num: 0,
      timestamp: event.timestamp as string,
      event_type: "tool_result",
      parent_id: null,     // Core resolves via runtime.openclaw.tool_id if needed
      agent_id: this.agentId,
      payload: {
        tool_name: event.toolName as string,
        output: event.result,
        duration_ms: event.durationMs as number,
      },
      redacted: false,
      prev_hash: "",
      event_hash: "",
      metadata: { "runtime.adapter": "openclaw", "runtime.openclaw.tool_id": event.toolId as string },
      schema_version: "1.0.0",
    };
  }

  private mapLLMRequest(event: Record<string, unknown>): TraceEvent {
    this.eventIndex++;
    return {
      event_id: "",
      session_id: this.sessionId,
      sequence_num: 0,
      timestamp: event.timestamp as string,
      event_type: "llm_request",
      parent_id: null,
      agent_id: this.agentId,
      payload: {
        model: event.model as string,
        messages: event.messages,
        parameters: event.params,
      },
      redacted: false,
      prev_hash: "",
      event_hash: "",
      metadata: { "runtime.adapter": "openclaw" },
      schema_version: "1.0.0",
    };
  }

  private mapLLMResponse(event: Record<string, unknown>): TraceEvent {
    this.eventIndex++;
    return {
      event_id: "",
      session_id: this.sessionId,
      sequence_num: 0,
      timestamp: event.timestamp as string,
      event_type: "llm_response",
      parent_id: null,
      agent_id: this.agentId,
      payload: {
        model: event.model as string,
        content: event.content as string,
        usage: {
          prompt_tokens: (event.usage as Record<string, number>).promptTokens,
          completion_tokens: (event.usage as Record<string, number>).completionTokens,
        },
        finish_reason: event.finishReason as string,
      },
      redacted: false,
      prev_hash: "",
      event_hash: "",
      metadata: { "runtime.adapter": "openclaw" },
      schema_version: "1.0.0",
    };
  }
}
```

### Sample Policy for OpenClaw Agents

```yaml
apiVersion: krynix.dev/v1
kind: Policy

metadata:
  name: openclaw-default
  version: "1.0.0"
  description: Default policy for agents using the OpenClaw adapter
  labels:
    adapter: openclaw

spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]

  rules:
    - id: deny-shell
      description: Deny all shell execution from OpenClaw agents
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: critical
      message: "Shell execution denied for OpenClaw agents"

    - id: approve-file-write
      description: Require approval for file writes
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: file_write
      action: require-approval
      severity: error
      message: "File write requires manual approval"
      on_violation:
        notify: ["slack:#openclaw-reviews"]

  defaults:
    unmatched_action: allow
```

### CI Pipeline with OpenClaw

```yaml
name: OpenClaw Agent CI
on: [push, pull_request]

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Krynix
        run: npm install -g @krynix/cli

      - name: Run agent session with tracing
        run: openclaw run --trace-output traces/session.trace.jsonl

      - name: Evaluate trace
        run: krynix evaluate --trace traces/session.trace.jsonl --policy policies/

      - name: Verify determinism
        run: krynix replay --verify --golden-dir test/golden/
```

## SDK Contract

The Krynix SDK exposes the following minimum API surface for programmatic integration:

```typescript
interface KrynixSDK {
  /**
   * Start a new Agent Session.
   * Returns a session handle for recording events.
   */
  startSession(config: {
    agentId: string;
    /** Must be <= Number.MAX_SAFE_INTEGER */
    replaySeed?: number;
    metadata?: Record<string, unknown>;
  }): Promise<Session>;

  /**
   * Record a TraceEvent in the current session.
   * Handles event_id assignment, sequencing, hash chain computation, and redaction.
   */
  recordEvent(session: Session, event: Omit<TraceEvent,
    "event_id" | "sequence_num" | "prev_hash" | "event_hash" | "redacted"
  >): TraceEvent;

  /**
   * End the current session.
   * Writes the lifecycle:session_end event and finalizes the trace file.
   */
  endSession(session: Session, summary?: Record<string, unknown>): Promise<void>;

  /**
   * Evaluate a trace against policies.
   * Returns the aggregate policy verdict.
   */
  evaluate(tracePath: string, policyDir: string): Promise<{
    verdict: "pass" | "fail" | "require-approval";
    violations: Violation[];
    exitCode: number;
  }>;

  /**
   * Replay a trace and verify determinism.
   * Returns pass/diverge result.
   */
  replay(tracePath: string, options?: {
    verify?: boolean;
    verbose?: boolean;
  }): Promise<{
    status: "pass" | "diverged";
    divergence?: DivergenceReport;
  }>;
}
```

## Writing a New Adapter

To add support for a new agent framework:

1. Create a new package: `packages/adapter-<framework-name>/`
2. Implement the `TraceAdapter` interface
3. Map all relevant framework events to canonical TraceEvent types
4. Write tests using recorded framework events (see [testing strategy](../20_development/testing_strategy.md))
5. Add a sample policy file demonstrating framework-specific rules
6. Document the event mapping in the adapter's README

## Adapter Registry

| Adapter | Framework | Status | Package |
|---|---|---|---|
| `openclaw` | OpenClaw | Reference implementation | `packages/adapter-openclaw/` |
| `langchain` | LangChain | Reference implementation | `packages/adapter-langchain/` |

Additional adapters will be added as community contributions following the process above.

## Plugin API

For frameworks that support a plugin/extension model, Krynix provides a ready-to-use plugin factory. The plugin handles session lifecycle, hook registration, and trace file management automatically.

### OpenClaw Plugin

The `@krynix/adapter-openclaw` package exports `createKrynixPlugin`, a factory function that returns an OpenClaw-compatible plugin initializer:

```typescript
import { createKrynixPlugin } from "@krynix/adapter-openclaw";

// In an OpenClaw extensions/krynix/index.ts:
export default createKrynixPlugin({
  outputPath: "./trace.jsonl",
  replaySeed: 42,                // Optional: deterministic replay seed
  agentId: "my-agent",           // Optional: defaults to "openclaw-agent"
  metadata: { env: "production" } // Optional: session metadata
});
```

The plugin uses a minimal interface (`OpenClawPluginApiMinimal`) that requires only an `on()` method for hook registration, making it structurally compatible with OpenClaw's `OpenClawPluginApi` without a runtime dependency on OpenClaw.

**Registered hooks:** `session_start`, `session_end`, `before_tool_call`, `after_tool_call`, `llm_input`, `llm_output`.

**Lifecycle:** Session starts on plugin initialization. Events are recorded through the `OpenClawAdapter`. Session ends on `session_end` hook or explicit `shutdown()`.

**Plugin handle:** The plugin returns a `KrynixPluginHandle` with `shutdown()` (for programmatic cleanup) and `getTracePath()` (to retrieve the output file path).

## Environment Context

Sessions can capture CI/CD and Git environment metadata in the `lifecycle:session_start` event. This enables compliance bundles and audit logs to record where and how an agent session was executed.

### `EnvironmentContext` Interface

```typescript
interface EnvironmentContext {
  /** Known values: "github-actions", "gitlab-ci", "jenkins", "circleci", "travis-ci", "unknown-ci". Custom strings allowed. */
  ci_provider: string | null;
  ci_run_id: string | null;
  ci_run_url: string | null;
  git_sha: string | null;
  git_branch: string | null;
  git_repository: string | null;
  extra: Record<string, string>;
}
```

### Placement in Trace

The `EnvironmentContext` object is stored in the `lifecycle:session_start` event at `payload.context.environment`:

```json
{
  "event_type": "lifecycle",
  "payload": {
    "action": "session_start",
    "context": {
      "replay_seed": 42,
      "environment": {
        "ci_provider": "github-actions",
        "ci_run_id": "456",
        "ci_run_url": "https://github.com/org/repo/actions/runs/456",
        "git_sha": "abc123def456",
        "git_branch": "main",
        "git_repository": "org/repo",
        "extra": {}
      }
    }
  }
}
```

### Detection

`@krynix/core` exports `detectEnvironment(env?)` which auto-detects CI provider and Git metadata from environment variables. The detected context can be passed to `startSession({ environment })` or `generateComplianceBundle({ environment })`.

### Compliance Bundle Integration

When `environment` is provided to `generateComplianceBundle`, it is included in the bundle manifest at the top level, enabling auditors to correlate bundles with specific CI runs.

## Bundle Verification

The `verifyComplianceBundle(bundleDir)` function in `@krynix/core` performs local integrity verification of a compliance bundle directory.

### Verification Steps

1. Read `manifest.json` from the bundle directory
2. Validate `manifest_version` is supported (`"1.0.0"`)
3. For each artifact in the manifest:
   - Reject paths containing `..` (path traversal protection)
   - Read the artifact file from disk
   - Compute SHA-256 digest and compare against the manifest's `digest` field
4. Return a structured result

### Result Interface

```typescript
interface BundleVerificationResult {
  valid: boolean;
  manifest_found: boolean;
  artifact_count: number;
  verified_count: number;
  errors: BundleVerificationError[];
}

interface BundleVerificationError {
  artifact_path: string;
  error_type: "digest_mismatch" | "file_missing" | "path_traversal" | "manifest_parse_error";
  expected_digest: string;
  actual_digest: string;
}
```

### CLI Usage

```bash
krynix compliance verify --dir <bundle-dir>
```

Returns exit code 0 if all artifacts pass verification, non-zero otherwise.
