# How Policies Work

## The Core Idea

A Krynix policy is a YAML file that defines rules for what an agent is and isn't allowed to do. Write it once, and it works with any agent framework — LangChain, CrewAI, AutoGen, a custom Python script, a Go service, anything.

This universality is the most important property of Krynix policies.

## Why Policies Are Universal

Every agent framework has its own event format. LangChain emits callbacks. OpenClaw has hooks. A raw Python agent might just log dictionaries. These formats are all different.

Krynix solves this with a normalization layer:

```
LangChain Agent  → LangChainAdapter  → canonical TraceEvent ─┐
OpenClaw Agent   → OpenClawAdapter   → canonical TraceEvent  ├→ Same Policy Engine
Python Agent     → HTTP Ingest       → canonical TraceEvent  │
Custom Agent     → Custom Adapter    → canonical TraceEvent ─┘
```

Every adapter translates framework-specific events into the same 8 canonical event types. Policies match against these canonical types. The policy engine has zero awareness of which framework produced the event.

## The 8 Canonical Event Types

| Event | What It Captures | Example |
|-------|-----------------|---------|
| `tool_call` | Agent invokes a tool | `{ tool_name: "shell_exec", arguments: { cmd: "ls" } }` |
| `tool_result` | Tool returns a result | `{ tool_name: "shell_exec", output: "file1.txt", duration_ms: 150 }` |
| `llm_request` | Agent sends a prompt to an LLM | `{ model: "claude-sonnet-4-20250514", messages: [...] }` |
| `llm_response` | LLM returns a response | `{ model: "claude-sonnet-4-20250514", content: "...", usage: {...} }` |
| `decision` | Agent makes an internal decision | `{ action: "select_tool", reasoning: "..." }` |
| `observation` | Agent observes data from the environment | `{ source: "filesystem", content: "..." }` |
| `error` | Something failed | `{ code: "TOOL_TIMEOUT", message: "...", recoverable: true }` |
| `lifecycle` | Session start, end, or checkpoint | `{ action: "session_start" }` |

These 8 types cover the complete lifecycle of an agentic interaction. Any action an agent takes maps to one of these types.

## Policy Structure

```yaml
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: production-security
  version: "1.0"
  description: Security rules for production agent deployments
spec:
  scope:
    agents: ["*"]              # Apply to all agents
    event_types: ["tool_call"] # Only evaluate tool_call events
  rules:
    - id: no-shell-commands
      description: Block shell command execution
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: matches
            value: "^(shell|bash|exec|system).*"
      action: deny
      severity: critical
      message: "Shell command execution is not permitted"

    - id: no-unapproved-file-writes
      description: Block writes outside workspace
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: "file_write"
          - field: arguments.path
            operator: matches
            value: "^/(etc|usr|var|tmp)/"
      action: deny
      severity: critical
      message: "File writes outside workspace are not permitted"

  defaults:
    unmatched_action: allow    # Events not matching any rule pass through
```

## Matching Operators

| Operator | What It Does | Example |
|----------|-------------|---------|
| `eq` | Exact equality | `tool_name eq "shell_exec"` |
| `neq` | Not equal | `model neq "gpt-4"` |
| `in` | Value is in a set | `tool_name in ["shell_exec", "bash_exec"]` |
| `not_in` | Value is not in a set | `model not_in ["gpt-3.5-turbo"]` |
| `matches` | ECMAScript regex match | `tool_name matches "^shell.*"` |
| `contains` | String contains substring | `message contains "password"` |
| `exists` | Field is present (non-null) | `arguments.api_key exists true` |

## Evaluation Rules

- **First-match-wins** — rules are evaluated in order. The first rule that matches an event determines the action.
- **Deterministic** — same trace + same policy = same verdict, every time, on any machine.
- **Scoped** — policies declare which agents and event types they apply to. Events outside scope are not evaluated.

## Actions and Exit Codes

| Action | What Happens | CI Exit Code |
|--------|-------------|-------------|
| `allow` | Event passes | `0` |
| `deny` | Event is a violation | `1` (error severity) or `2` (critical severity) |
| `require-approval` | Event needs human review | `3` (only when no CI-failing violations exist) |

## Write Once, Apply Everywhere

Here's why universality matters. This single policy blocks shell commands from **any** agent framework:

```yaml
- id: no-shell
  description: Block shell command execution
  match:
    event_type: tool_call
    payload:
      - field: tool_name
        operator: matches
        value: "^(shell|bash|exec|system).*"
  action: deny
  severity: critical
  message: "Shell command execution is not permitted"
```

It works because:

1. **LangChain agent** calls `ShellTool` → LangChain adapter normalizes it to `{ event_type: "tool_call", payload: { tool_name: "shell_exec", ... } }` → policy matches → **denied**
2. **Python agent** POSTs `{ tool_name: "bash_exec", ... }` via HTTP ingest → normalized to canonical event → policy matches → **denied**
3. **Custom Go agent** uses the SDK to emit `{ tool_name: "system_cmd", ... }` → policy matches → **denied**

Zero policy modification. The adapter handles the translation; the policy stays the same.

## Four Integration Paths

You don't need to write a custom adapter. Choose the integration path that fits your situation:

### 1. HTTP Ingest — Any Agent, Any Language

POST JSON events to the ingest endpoint. No library, no SDK, no adapter code.

```bash
curl -X POST https://ingest.your-host.com/v1/events \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "tool_call",
    "agent_id": "my-agent",
    "payload": {
      "tool_name": "web_search",
      "arguments": { "query": "latest news" }
    }
  }'
```

Works from Python, Go, Rust, Java, bash scripts — anything that can make HTTP requests.

**Status:** `PLANNED` — the HTTP ingest server is the first component of the Control Plane.

### 2. SDK — Python or TypeScript

Install the SDK and add a few lines to your agent code:

```python
from krynix import KrynixTracer

tracer = KrynixTracer(session_id="my-session")
tracer.tool_call("web_search", {"query": "latest news"})
# ... your agent logic ...
tracer.tool_result("web_search", result, duration_ms=150)
tracer.flush()  # writes trace.jsonl
```

**Status:** TypeScript SDK is `CURRENT`. Python SDK is `PARTIAL` (basic functionality).

### 3. Pre-Built Adapter — Auto-Capture for Supported Frameworks

Drop in an adapter and all events are captured automatically — no manual instrumentation:

```typescript
import { LangChainAdapter } from "@krynix/adapter-langchain";

const adapter = new LangChainAdapter({ sessionId: "my-session" });
// Attach to your LangChain agent — all tool calls, LLM requests,
// and responses are captured automatically
```

**Status:** `CURRENT` for LangChain and OpenClaw adapters.

### 4. Custom Adapter — For New Frameworks

If your framework isn't supported and you want auto-capture (rather than manual SDK instrumentation), implement the `TraceAdapter` interface:

```typescript
interface TraceAdapter {
  onEvent(externalEvent: unknown): TraceEvent | null;
}
```

This is approximately 200-300 lines of code that translates your framework's events into canonical TraceEvents. Once written, all existing policies work with your framework unchanged.

**When to use this vs HTTP ingest:** Use HTTP ingest for quick integration. Use a custom adapter for zero-instrumentation auto-capture in a framework you use heavily.

## Policy Composition

Policies are composable — you can apply multiple policies to the same trace:

```bash
krynix evaluate \
  --trace session.trace.jsonl \
  --policy policies/security.policy.yaml \
  --policy policies/compliance.policy.yaml \
  --policy policies/cost-control.policy.yaml
```

Or point to a directory and all `.policy.yaml` files are loaded:

```bash
krynix evaluate --trace session.trace.jsonl --policy policies/
```

This lets teams maintain separate policies for security, compliance, cost control, and operational rules, composed together at evaluation time.

## Learn More

- [What Is Krynix?](what-is-krynix.md) — product overview
- [Security and Integrity](security-and-integrity.md) — hash chain, limitations, data protection
- [Policy Specification](../10_architecture/policy_spec.md) — full policy schema and operator reference
- [Trace Specification](../10_architecture/trace_spec.md) — canonical event schema
