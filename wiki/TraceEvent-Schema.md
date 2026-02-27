# TraceEvent Schema

Complete field reference for all Krynix TraceEvent types. See the [Trace Specification](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/trace_spec.md) for the authoritative source.

## Common Fields

Every TraceEvent contains these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event_id` | string (UUIDv4) | Yes | Unique identifier for this event |
| `session_id` | string (UUIDv4) | Yes | Links all events in one Agent Session |
| `sequence_num` | uint64 | Yes | Monotonically increasing, zero-indexed within session |
| `timestamp` | string (RFC 3339) | Yes | Always UTC, e.g., `2026-03-15T14:22:03.847Z` |
| `event_type` | enum | Yes | One of: `tool_call`, `tool_result`, `llm_request`, `llm_response`, `decision`, `observation`, `error`, `lifecycle` |
| `parent_id` | string (UUIDv4) | No | Optional causal link (e.g., `tool_result` -> `tool_call`) |
| `agent_id` | string | Yes | Stable identifier of the agent producing this event |
| `payload` | object | Yes | Event-type-specific structured data (see below) |
| `redacted` | boolean | Yes | `false` by default. `true` if payload has undergone redaction |
| `prev_hash` | string | Yes | Hex-encoded SHA-256 of previous event. Empty `""` for `sequence_num` 0 |
| `event_hash` | string | Yes | SHA-256 of canonical JSON of this event (with `event_hash` zeroed) |
| `metadata` | object | No | Optional extensible key-value pairs |
| `schema_version` | string | Yes | Must be `"1.0.0"` |

## Event Type Payloads

### `tool_call`

Records an agent's invocation of a tool.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `tool_name` | string | Yes | Tool identifier (e.g., `file_write`, `shell_exec`) |
| `arguments` | object | Yes | Tool-specific arguments |
| `approval_status` | enum | No | `auto`, `manual`, or `denied` |

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

### `tool_result`

Records the result of a tool invocation. Use `parent_id` to link to the corresponding `tool_call`.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `tool_name` | string | Yes | Matches the corresponding `tool_call` |
| `output` | any | Yes | Tool return value (redacted if necessary) |
| `exit_code` | int | No | For shell-like tools |
| `duration_ms` | uint64 | Yes | Execution wall-clock time in milliseconds |

```json
{
  "event_type": "tool_result",
  "parent_id": "evt-uuid-of-tool-call",
  "payload": {
    "tool_name": "file_write",
    "output": { "bytes_written": 5 },
    "exit_code": 0,
    "duration_ms": 12
  }
}
```

### `llm_request`

Records a request sent to an LLM provider.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `model` | string | Yes | Model identifier |
| `messages` | array | Yes | Prompt messages array |
| `parameters` | object | Yes | Temperature, max_tokens, etc. |

```json
{
  "event_type": "llm_request",
  "payload": {
    "model": "claude-opus-4-5-20251101",
    "messages": [{ "role": "user", "content": "Summarize this file." }],
    "parameters": { "temperature": 0, "max_tokens": 1024 }
  }
}
```

### `llm_response`

Records a response from an LLM provider.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `model` | string | Yes | Model identifier |
| `content` | string | Yes | Generated text |
| `usage` | object | Yes | Token usage breakdown |
| `usage.prompt_tokens` | uint64 | Yes | Input tokens |
| `usage.completion_tokens` | uint64 | Yes | Output tokens |
| `finish_reason` | string | No | `stop`, `max_tokens`, `tool_use`, etc. |

```json
{
  "event_type": "llm_response",
  "payload": {
    "model": "claude-opus-4-5-20251101",
    "content": "The file contains...",
    "usage": { "prompt_tokens": 150, "completion_tokens": 87 },
    "finish_reason": "stop"
  }
}
```

### `decision`

Records an agent's internal decision.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `decision` | string | Yes | Description of the decision made |
| `reasoning` | string | No | Why the decision was made |
| `alternatives` | array | No | Other options considered |

```json
{
  "event_type": "decision",
  "payload": {
    "decision": "Use file_write to save output",
    "reasoning": "Output is small enough for a single write",
    "alternatives": ["stream_write", "append_file"]
  }
}
```

### `observation`

Records an agent observing external state.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `source` | string | Yes | Where the observation came from |
| `content` | any | Yes | What was observed |

```json
{
  "event_type": "observation",
  "payload": {
    "source": "file_read:/tmp/config.json",
    "content": { "debug": true, "port": 3000 }
  }
}
```

### `error`

Records an error during execution.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `error_type` | string | Yes | Error classification |
| `message` | string | Yes | Error message |
| `stack` | string | No | Stack trace |
| `recoverable` | boolean | No | Whether execution can continue |

```json
{
  "event_type": "error",
  "payload": {
    "error_type": "ToolExecutionError",
    "message": "Permission denied: /etc/passwd",
    "recoverable": true
  }
}
```

### `lifecycle`

Records session lifecycle events.

| Payload Field | Type | Required | Description |
|---------------|------|----------|-------------|
| `action` | string | Yes | `session_start`, `session_end`, or `checkpoint` |
| `context` | object | For start | Session context (replay_seed, agent_version, etc.) |
| `duration_ms` | uint64 | For end | Total session duration |

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

The hash chain is computed as follows:

1. For `sequence_num: 0`: `prev_hash = ""`
2. For all others: `prev_hash = event_hash` of the previous event
3. `event_hash = SHA256(canonicalize(event_with_event_hash_zeroed))`

Where `canonicalize()` produces canonical JSON (sorted keys, no whitespace, no trailing comma).

## Redaction

When sensitive data is detected in a payload:

1. The value is replaced with `[REDACTED:SHA256_PREFIX_8]`
2. The `redacted` flag is set to `true`
3. The 8-char SHA-256 prefix enables correlation without exposure

Built-in patterns match: `api_key`, `password`, `secret`, `token`, `authorization`, `credential`, `private_key`, and similar field names.

## See Also

- [Trace Specification](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/trace_spec.md) -- Authoritative spec document
- [[Trace]] -- Trace concepts overview
- [[Writing Trace Adapters]] -- How to produce TraceEvents
