# HTTP Ingest Quickstart `[PLANNED]`

> **Status: NOT YET IMPLEMENTED.** The HTTP Ingest Server (`krynix-ingest`) and
> language-specific SDKs are under development. This document describes the planned
> integration protocol for any programming language.

## The Key Idea: You Won't Do This Manually

The raw HTTP protocol below shows every field for completeness. In practice, **you will use an SDK** that automates all of it. Here's what SDKs handle for you:

| What the SDK Handles | You Don't Touch |
|----------------------|-----------------|
| `event_id` generation (UUID) | Automatic |
| `timestamp` generation (ISO 8601 UTC) | Automatic |
| `schema_version` (constant "1.0.0") | Automatic |
| `redacted` flag (default false) | Automatic |
| Session lifecycle (start/end bookends) | Automatic |
| Batching and retry on network failure | Automatic |
| `sequence_num`, `prev_hash`, `event_hash` | Server computes these |

**What you actually write** with the Python SDK:

```python
from krynix import KrynixTracer

tracer = KrynixTracer(endpoint="https://ingest.krynix.dev", api_key="krynix_...")

with tracer.session(agent_id="my-agent") as session:
    session.tool_call("web_search", arguments={"query": "security advisory"})
    session.tool_result("web_search", output={...}, duration_ms=230)
    session.llm_request("claude-sonnet-4", messages=[...], parameters={})
    session.llm_response("claude-sonnet-4", content="...", usage={...})
```

Compare that to the raw HTTP equivalent (8+ fields per event) shown below. The SDK is the intended integration path.

## How It Works

```
Your Agent (Python, Go, .NET, curl, etc.)
    │
    ▼  POST /v1/sessions/{session_id}/events
    │  (raw JSON — no hashes needed)
    │
┌───────────────────────┐
│   Krynix Ingest       │
│ • Validates schema    │
│ • Assigns seq nums    │
│ • Computes hashes     │
│ • Writes .trace       │
└───────────────────────┘
    │
    ▼  .trace.jsonl (fully hashed, CLI-compatible)
    │
    ▼  krynix evaluate / krynix replay
```

You send raw events. The server computes the hash chain. This means **any language that can POST JSON** gets full Krynix trust guarantees without implementing canonical JSON or SHA-256 chaining.

## Authentication

API keys follow the format `Authorization: Bearer krynix_<org>_<key>`.

- **Hosted service (planned):** API keys are issued when you create a Krynix account at krynix.dev.
- **Self-hosted deployments:** You configure your own authentication mechanism.

## Step 1: Start a Session

Generate a UUID for your session. Events within a session form a single trace.

```bash
SESSION_ID=$(uuidgen)
```

## Step 2: Send Events

```bash
curl -X POST "https://ingest.krynix.dev/v1/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer krynix_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "event_id": "'$(uuidgen)'",
        "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%S.000Z)'",
        "event_type": "tool_call",
        "parent_id": null,
        "agent_id": "my-python-agent",
        "payload": {
          "tool_name": "web_search",
          "arguments": { "query": "krynix trust spine" }
        },
        "redacted": false,
        "metadata": null,
        "schema_version": "1.0.0"
      }
    ]
  }'
```

Response:
```json
{
  "accepted": 1,
  "session_id": "550e8400-e29b-...",
  "sequence_range": [0, 0],
  "head_hash": "a1b2c3d4..."
}
```

Note what you **don't** send: `sequence_num`, `prev_hash`, `event_hash`. The server handles all of these.

## Step 3: Close the Session

```bash
curl -X POST "https://ingest.krynix.dev/v1/sessions/$SESSION_ID/close" \
  -H "Authorization: Bearer krynix_YOUR_API_KEY"
```

The server writes the finalized `.trace.jsonl` file with complete hash chain.

## Step 4: Evaluate Policies (CLI)

```bash
# Download the trace (or use the local file if self-hosted)
krynix evaluate --trace traces/$SESSION_ID.trace.jsonl --policy policies/

# Verify integrity
krynix replay --verify --trace traces/$SESSION_ID.trace.jsonl
```

## Python Example (with httpx)

> **Note:** This shows the raw HTTP approach. When the Python SDK is available,
> use `KrynixTracer` instead (shown at the top of this document).

```python
import httpx
import uuid
from datetime import datetime, timezone

ENDPOINT = "https://ingest.krynix.dev"
API_KEY = "krynix_YOUR_API_KEY"
SESSION_ID = str(uuid.uuid4())

client = httpx.Client(
    base_url=ENDPOINT,
    headers={"Authorization": f"Bearer {API_KEY}"},
)

# Send a tool_call event
client.post(f"/v1/sessions/{SESSION_ID}/events", json={
    "events": [{
        "event_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": "tool_call",
        "parent_id": None,
        "agent_id": "my-agent",
        "payload": {
            "tool_name": "web_search",
            "arguments": {"query": "security advisory"},
        },
        "redacted": False,
        "metadata": None,
        "schema_version": "1.0.0",
    }],
})

# Close the session
client.post(f"/v1/sessions/{SESSION_ID}/close")
```

## Event Types Reference

| Event Type | Required Payload Fields |
|-----------|------------------------|
| `tool_call` | `tool_name`, `arguments` |
| `tool_result` | `tool_name`, `output`, `duration_ms` |
| `llm_request` | `model`, `messages`, `parameters` |
| `llm_response` | `model`, `content`, `usage`, `finish_reason` |
| `decision` | `action`, `reasoning` |
| `observation` | `source`, `content` |
| `error` | `code`, `message`, `recoverable` |
| `lifecycle` | `action` (`session_start`, `session_end`, `checkpoint`) |

## LangChain Integration (Python) `[PLANNED]`

The Python SDK will include a LangChain callback handler that captures events automatically:

```python
from krynix.integrations.langchain import KrynixCallbackHandler

handler = KrynixCallbackHandler(
    endpoint="https://ingest.krynix.dev",
    api_key="krynix_...",
    agent_id="my-langchain-agent",
)

# Pass to any LangChain chain — automatic event capture
chain.invoke({"input": "..."}, config={"callbacks": [handler]})
```

This mirrors the TypeScript `createLangChainTracer()` pattern — zero per-event code.

See [krynix-sdk-python](https://github.com/PROJECT-OBA/krynix-sdk-python) for status.
