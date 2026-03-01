# Trace Specification

**Schema Version:** `1.0.0`

This document defines the canonical format for Krynix Traces and TraceEvents. All components that produce, consume, or validate traces must conform to this specification.

See [glossary](../00_overview/glossary.md) for term definitions.

## Overview

A **Trace** is an ordered, immutable sequence of **TraceEvents** representing one complete agent execution session. Each Trace is identified by a `session_id` (UUIDv4) and stored as a `.trace.jsonl` file — one TraceEvent per line, JSON Lines format, UTF-8 encoded.

Traces serve three purposes:
1. **Audit** — complete record of what an agent did and why
2. **Policy evaluation** — structured data against which [Policies](policy_spec.md) are evaluated
3. **Replay** — input to [deterministic replay](determinism_spec.md) for reproducibility verification

## TraceEvent Schema

Every TraceEvent contains the following fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `event_id` | string (UUIDv4) | yes | Unique identifier for this event |
| `session_id` | string (UUIDv4) | yes | Links all events in one Agent Session |
| `sequence_num` | uint64 | yes | Monotonically increasing, zero-indexed within session |
| `timestamp` | string (RFC 3339) | yes | Always UTC, e.g., `2026-03-15T14:22:03.847Z` |
| `event_type` | enum | yes | One of the defined event types (see below) |
| `parent_id` | string (UUIDv4) | no | Optional causal link (e.g., `tool_result` → `tool_call`) |
| `agent_id` | string | yes | Stable identifier of the agent producing this event |
| `payload` | object | yes | Event-type-specific structured data |
| `redacted` | boolean | yes | `false` by default. `true` if payload has undergone Redaction |
| `prev_hash` | string | yes | Hex-encoded SHA-256 of previous event. Empty string `""` for `sequence_num` 0 |
| `event_hash` | string | yes | SHA-256 of canonical JSON of this event (see Hash Chain) |
| `metadata` | object | no | Optional extensible key-value pairs |
| `schema_version` | string | yes | Semver string. Must be `"1.0.0"` for this spec version |

## Event Types

```
event_type: tool_call | tool_result | llm_request | llm_response
          | decision | observation | error | lifecycle
```

### `tool_call`

Records an agent's invocation of a tool.

```json
{
  "tool_name": "file_write",
  "arguments": { "path": "/tmp/output.txt", "content": "hello" },
  "approval_status": "auto"
}
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `tool_name` | string | yes | Tool identifier, e.g., `file_write`, `shell_exec` |
| `arguments` | object | yes | Tool-specific arguments |
| `approval_status` | enum | no | `auto`, `manual`, or `denied`. Present when policy requires approval |

### `tool_result`

Records the result of a tool invocation.

```json
{
  "tool_name": "file_write",
  "output": { "bytes_written": 5 },
  "exit_code": 0,
  "duration_ms": 12
}
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `tool_name` | string | yes | Matches the corresponding `tool_call` |
| `output` | any | yes | Tool return value (redacted if necessary) |
| `exit_code` | int | no | For shell-like tools |
| `duration_ms` | uint64 | yes | Execution wall-clock time in milliseconds |

### `llm_request`

Records a request sent to an LLM provider.

```json
{
  "model": "claude-opus-4-5-20251101",
  "messages": [{ "role": "user", "content": "Summarize this file." }],
  "parameters": { "temperature": 0, "max_tokens": 1024 }
}
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | yes | Model identifier |
| `messages` | array | yes | Prompt messages array |
| `parameters` | object | yes | Temperature, max_tokens, etc. |

### `llm_response`

Records a response received from an LLM provider.

```json
{
  "model": "claude-opus-4-5-20251101",
  "content": "The file contains configuration for...",
  "usage": { "prompt_tokens": 150, "completion_tokens": 42 },
  "finish_reason": "stop"
}
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | yes | Model identifier |
| `content` | string | yes | Response text (redacted if necessary) |
| `usage` | object | yes | `{ prompt_tokens: uint, completion_tokens: uint }` |
| `finish_reason` | string | yes | `stop`, `max_tokens`, or `tool_use` |

### `decision`

Records an agent's internal decision.

```json
{
  "action": "write_test_file",
  "reasoning": "The function lacks test coverage and the user requested tests.",
  "confidence": 0.92
}
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `action` | string | yes | What the agent decided to do |
| `reasoning` | string | yes | Agent's stated reasoning |
| `confidence` | float | no | Optional 0.0–1.0 confidence score |

### `observation`

Records data the agent observed from its environment.

```json
{
  "source": "file_system",
  "content": { "path": "/src/index.ts", "exists": true, "size_bytes": 2048 }
}
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | yes | Where the observation came from |
| `content` | any | yes | Structured observation data |

### `error`

Records an error encountered during execution.

```json
{
  "code": "TOOL_TIMEOUT",
  "message": "shell_exec exceeded 30s timeout",
  "recoverable": true
}
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `code` | string | yes | Machine-readable error code |
| `message` | string | yes | Human-readable description |
| `recoverable` | boolean | yes | Whether the agent can continue |

### `lifecycle`

Records session lifecycle transitions.

```json
{
  "action": "session_start",
  "context": {
    "agent_version": "0.1.0",
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
```

| Payload Field | Type | Required | Description |
|---|---|---|---|
| `action` | enum | yes | `session_start`, `session_end`, or `checkpoint` |
| `context` | object | no | For `session_start`: includes `replay_seed` (uint64), optional `environment` (`EnvironmentContext` object — see below), and optional user metadata. For `session_end`: summary stats |

**`EnvironmentContext` object** (optional, present in `context.environment` for `session_start`):

| Field | Type | Description |
|---|---|---|
| `ci_provider` | `string \| null` | CI provider name: `"github-actions"`, `"gitlab-ci"`, `"jenkins"`, `"circleci"`, `"travis-ci"`, `"unknown-ci"`, or `null` if not in CI |
| `ci_run_id` | `string \| null` | CI pipeline/workflow run ID |
| `ci_run_url` | `string \| null` | Full URL to the CI run |
| `git_sha` | `string \| null` | Git commit SHA |
| `git_branch` | `string \| null` | Git branch name |
| `git_repository` | `string \| null` | Git repository URL or slug |
| `extra` | `Record<string, string>` | Additional user-supplied key-value pairs |

## Trace Lifecycle

Every valid Trace must satisfy:

1. Event at `sequence_num` 0 must be `lifecycle` with `action: session_start`
2. Final event must be `lifecycle` with `action: session_end`
3. Optional `lifecycle:checkpoint` events may appear at any position between start and end
4. All events share the same `session_id`
5. `sequence_num` values are contiguous: 0, 1, 2, ..., N with no gaps

## Hash Chain

The Hash Chain provides tamper-evidence for the entire Trace. Any modification to a single event breaks the chain for all subsequent events.

### Algorithm

1. **For `sequence_num == 0`:** `prev_hash = ""`
2. **For `sequence_num > 0`:** `prev_hash = event_hash` of the event at `sequence_num - 1`
3. **`event_hash` computation:**
   - Take all fields of the TraceEvent, setting `event_hash` to `""`
   - Serialize to canonical JSON (sorted keys, no whitespace, UTF-8)
   - Compute SHA-256 and hex-encode the result

### Canonical JSON

Canonical JSON serialization rules:
- Keys sorted lexicographically (Unicode code point order)
- No whitespace between tokens
- UTF-8 encoding
- No trailing newline
- Only finite JSON numbers are allowed. `NaN`, `Infinity`, `-Infinity`, and `BigInt` values must be rejected before serialization. These are not valid JSON and indicate a bug in trace production.
- Numbers use minimal representation following `JSON.stringify` output for finite numbers (no leading zeros, no trailing zeros after decimal point, e.g., `1.0` serializes as `1`, `0.10` as `0.1`). This ensures implementability in TypeScript/Node.js without custom numeric formatting.

### Worked Example

**Event 0** (session_start):
```json
{"agent_id":"agent-1","event_hash":"","event_id":"550e8400-e29b-41d4-a716-446655440000","event_type":"lifecycle","metadata":null,"parent_id":null,"payload":{"action":"session_start","context":{"replay_seed":42}},"prev_hash":"","redacted":false,"schema_version":"1.0.0","sequence_num":0,"session_id":"7c9e6679-7425-40de-944b-e07fc1f90ae7","timestamp":"2026-03-15T14:00:00.000Z"}
```
→ `event_hash = SHA-256(above) = "a1b2c3..."` (abbreviated)

**Event 1** (tool_call):
- `prev_hash = "a1b2c3..."` (the `event_hash` of Event 0)
- Serialize with `event_hash` set to `""`, compute SHA-256
→ `event_hash = "d4e5f6..."`

**Event 2** (tool_result):
- `prev_hash = "d4e5f6..."` (the `event_hash` of Event 1)
- Continue the chain

### Verification

To verify a Trace's integrity:
1. Recompute `event_hash` for each event (setting `event_hash` to `""` before hashing)
2. Verify each event's `prev_hash` matches the preceding event's computed `event_hash`
3. Verify `prev_hash` of event 0 is `""`
4. If any check fails, the chain is broken — report the first divergence point

## Redaction Rules

Redaction prevents sensitive data from persisting in stored Traces.

### Automatic Redaction Patterns

Fields matching these patterns are automatically redacted:
- `*_key`
- `*_secret`
- `*_token`
- `*_password`
- `*_credential`

Pattern matching is case-insensitive and applies to payload field names at any nesting depth.

### Redaction Format

Redacted values are replaced with:

```
[REDACTED:SHA256_PREFIX_8]
```

Where `SHA256_PREFIX_8` is the first 8 hex characters of SHA-256 of the original value. This enables correlation of the same secret across events without exposing the value.

**Example:**

Before:
```json
{ "api_key": "sk-abc123secret", "path": "/tmp/output.txt" }
```

After:
```json
{ "api_key": "[REDACTED:7f2a91c4]", "path": "/tmp/output.txt" }
```

### Redaction Ordering

Redaction is applied **before** `event_hash` computation. The Hash Chain covers the redacted form of events, not the original plaintext. This means:
- Hash Chain verification works on redacted traces
- The original values cannot be recovered from the trace
- The `redacted` field on the TraceEvent is set to `true` if any payload field was redacted

## Validation Rules

A TraceEvent is valid if and only if all of the following hold:

1. All required fields are present and non-null
2. `event_id` and `session_id` are valid UUIDv4
3. `sequence_num` is non-negative and contiguous within the session
4. `timestamp` is valid RFC 3339 UTC
5. `event_type` is a recognized enum value
6. `schema_version` matches the expected version (`"1.0.0"`)
7. `event_hash` matches the recomputed hash
8. `prev_hash` matches the `event_hash` of the preceding event (or `""` for seq 0)
9. Payload conforms to the schema for the given `event_type`

A Trace is valid if and only if:

1. All contained TraceEvents are individually valid
2. All events share the same `session_id`
3. `sequence_num` values form a contiguous sequence starting at 0
4. First event is `lifecycle:session_start`
5. Last event is `lifecycle:session_end`
6. Hash Chain is unbroken

## Wire Format

- **File extension:** `.trace.jsonl`
- **Encoding:** UTF-8
- **Format:** JSON Lines — one TraceEvent per line, no trailing comma, newline-terminated
- **Compression:** Optional gzip (`.trace.jsonl.gz`) for archival storage

## Storage Conventions

| Location | Purpose |
|---|---|
| `test/golden/*.trace.jsonl` | Golden Traces for deterministic replay testing |
| `traces/` | Runtime trace output directory (gitignored) |

## Future Work

- **Hash Chain Signing:** Extend `event_hash` with cryptographic signatures (Ed25519) for non-repudiation. The current hash chain provides tamper-evidence but not attribution. Signature support will be introduced in schema version `2.0.0`.
- **Streaming Validation:** Real-time hash chain verification during trace capture, enabling immediate detection of integrity violations.
- **Binary Wire Format:** Protocol Buffers or CBOR encoding for high-throughput scenarios where JSON parsing overhead is prohibitive.
