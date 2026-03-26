# Trace

A **Trace** is an ordered, immutable sequence of **TraceEvents** representing one complete agent execution session. Traces are the foundation of Krynix's audit, policy, and replay capabilities.

## Overview

Every action, decision, and observation an agent makes is recorded as a `TraceEvent`. Events are linked together with a SHA-256 hash chain, making the entire trace tamper-evident. Traces are stored as `.trace.jsonl` files (JSON Lines, one event per line, UTF-8 encoded).

```
Agent Framework  -->  Trace Adapter  -->  Redaction  -->  Hash Chain  -->  .trace.jsonl
```

## TraceEvent Schema

Every TraceEvent contains these fields:

| Field | Type | Description |
|-------|------|-------------|
| `event_id` | UUIDv4 | Unique identifier for this event |
| `session_id` | UUIDv4 | Links all events in one session |
| `sequence_num` | uint64 | Monotonically increasing, zero-indexed |
| `timestamp` | RFC 3339 | Always UTC |
| `event_type` | enum | One of 8 event types (see below) |
| `parent_id` | UUIDv4 | Optional causal link (e.g., `tool_result` -> `tool_call`) |
| `agent_id` | string | Stable identifier of the producing agent |
| `payload` | object | Event-type-specific structured data |
| `redacted` | boolean | `true` if payload has undergone redaction |
| `prev_hash` | string | SHA-256 of previous event (empty for seq 0) |
| `event_hash` | string | SHA-256 of canonical JSON of this event |
| `metadata` | object | Optional extensible key-value pairs |
| `schema_version` | string | Must be `"1.0.0"` |

## Event Types

Krynix defines 8 event types:

| Type | Purpose |
|------|---------|
| `tool_call` | Agent invoked a tool (file write, API call, shell exec) |
| `tool_result` | Result returned from a tool invocation |
| `llm_request` | Request sent to an LLM provider |
| `llm_response` | Response received from an LLM provider |
| `decision` | Agent made an internal decision |
| `observation` | Agent observed external state |
| `error` | An error occurred during execution |
| `lifecycle` | Session lifecycle events (start, end, checkpoint) |

### `tool_call` Example

```json
{
  "event_type": "tool_call",
  "payload": {
    "tool_name": "file_write",
    "arguments": { "path": "/tmp/output.txt", "content": "hello" },
    "approval_status": "auto"
  }
}
```

### `lifecycle` Example

```json
{
  "event_type": "lifecycle",
  "payload": {
    "action": "session_start",
    "context": {
      "replay_seed": 42,
      "agent_version": "0.1.0"
    }
  }
}
```

## Hash Chain

Every TraceEvent is cryptographically linked to its predecessor:

1. `sequence_num: 0` has `prev_hash: ""` (empty string)
2. All subsequent events set `prev_hash` to the `event_hash` of the previous event
3. `event_hash` is computed as `SHA-256(canonicalize(event_with_hash_zeroed))`

This creates a chain where modifying any single event invalidates all subsequent hashes. Hash chain integrity is verified during:
- Policy evaluation
- Replay verification
- Compliance bundle generation
- Trace upload to the Control Plane

## Redaction

Sensitive data is automatically stripped from trace payloads before storage:

- **Built-in patterns** match common secret field names: `api_key`, `password`, `secret`, `token`, `authorization`, etc.
- **Custom patterns** can be configured via `redactWithPatterns()` for domain-specific fields
- Redacted values use the format `[REDACTED:SHA256_PREFIX_8]` -- the 8-char SHA-256 prefix enables correlation without exposing the value
- The `redacted: true` flag is set on events that have undergone redaction

## Trace Adapters

Trace Adapters bridge external agent frameworks to Krynix's canonical format:

```
LangChain  -->  LangChain Adapter  --\
                                      +--> TraceEvent --> .trace.jsonl
OpenClaw   -->  OpenClaw Adapter   --/
```

Each adapter implements an `initialize()` and `onEvent()` interface. The OpenClaw adapter is provided as a reference implementation in `@krynix/adapter-openclaw`.

See [[Writing Trace Adapters]] for how to create an adapter for your framework.

## Working with Traces

```bash
# Compute analytics from a trace
krynix stats --trace session.trace.jsonl

# Evaluate against policies
krynix evaluate --trace session.trace.jsonl --policy policies/

# Export to OpenTelemetry
krynix export --format otlp-json --trace session.trace.jsonl

# Filter events before processing
krynix stats --trace session.trace.jsonl --filter-type tool_call --after 2026-01-15T12:00:00Z
```

## See Also

- [Trace Specification](https://github.com/PROJECT-OBA/krynix/blob/main/docs/10_architecture/trace_spec.md) -- Full schema reference
- [[Policy]] -- How traces are evaluated against rules
- [[Replay]] -- How traces are replayed for verification
- [[TraceEvent Schema]] -- Complete field reference for all event types
