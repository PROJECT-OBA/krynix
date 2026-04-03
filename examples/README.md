# Krynix Examples

How to use Krynix from "I have an agent" to "I have trust evidence."

## The User Journey

### 1. Generate a Trace

A Krynix trace is a `.trace.jsonl` file — a JSON Lines file where each line is a trace event with a SHA-256 hash chain. There are two ways to generate one:

**Option A: TypeScript adapter (local, offline) `[CURRENT]`**

If your agent is TypeScript-based, use a framework adapter to capture events directly. The `createLangChainTracer()` plugin handles all session management and event recording automatically:

```typescript
import { createLangChainTracer } from "@krynix/adapter-langchain";

const { handler, handle } = await createLangChainTracer({
  agentId: "my-agent",
  outputPath: "traces/my-session.trace.jsonl",
});

// Pass handler to your LangChain chain — events are captured automatically
await chain.invoke({ input: "..." }, { callbacks: [handler] });

// When done, shut down to finalize the trace
await handle.shutdown();
```

> **Note:** Create the output directory before running: `mkdir -p traces`

See: [langchain-quickstart.ts](langchain-quickstart.ts)

**Option B: HTTP ingest (any language) `[PLANNED]`**

If your agent is Python, Go, .NET, or any other language, you will send events via HTTP to the Krynix Ingest Server. The server computes hash chains for you.

> **Status:** The HTTP Ingest Server and language-specific SDKs are under development.
> You will NOT need to construct events manually — SDKs handle event construction,
> session management, batching, and retry automatically.

With the Python SDK (coming soon):

```python
from krynix import KrynixTracer

tracer = KrynixTracer(endpoint="https://ingest.krynix.dev", api_key="krynix_...")

with tracer.session(agent_id="my-agent") as session:
    # One method call per event — SDK handles all fields automatically
    session.tool_call("web_search", arguments={"query": "security advisory"})
    session.tool_result("web_search", output={...}, duration_ms=230)
```

See: [http-quickstart.md](http-quickstart.md) for the raw HTTP protocol details.

### What You Provide vs What Krynix Handles

| Field | You Provide | Krynix Handles |
|-------|:-----------:|:--------------:|
| Event type + payload (what happened) | Yes | — |
| Agent ID | Yes (once, at setup) | Stamped on every event |
| Timestamps | — | Auto-generated |
| Event IDs (UUIDs) | — | Auto-generated (deterministic with replay seed) |
| Sequence numbers | — | Auto-assigned (contiguous) |
| Hash chain (prev_hash, event_hash) | — | Auto-computed (SHA-256 over canonical JSON) |
| Session lifecycle (start/end) | — | Auto-managed by adapters/SDKs |
| Schema version | — | Auto-set ("1.0.0") |

> **Note:** This table describes behavior when using adapter plugins or SDKs.
> The low-level `@krynix/core` session API requires you to provide timestamps
> and manage session lifecycle manually — see the
> [Advanced section](langchain-quickstart.ts) for details.

### 2. Evaluate Policies

Write a policy (YAML) that defines what your agent is and isn't allowed to do:

```yaml
# policies/my-policy.policy.yaml
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: no-shell
  version: "1.0.0"
  description: Block shell execution
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: deny-shell
      match:
        payload:
          - field: tool_name
            operator: matches
            value: "^(shell|bash|exec).*"
      action: deny
      severity: critical
      message: "Shell execution is not permitted"
  defaults:
    unmatched_action: allow
    unmatched_severity: info
```

Then evaluate:

```bash
krynix evaluate --trace traces/my-session.trace.jsonl --policy policies/

# Exit codes:
# 0 = all policies pass
# 1 = policy violation (error severity) or runtime error
# 2 = policy violation (critical severity)
# 3 = requires human approval
```

See example policies in [policies/examples/](../policies/examples/).

### 3. Verify Trace Integrity

```bash
# Verify hash chain, lifecycle bookends, sequence numbers, determinism
krynix replay --verify --trace traces/my-session.trace.jsonl
```

This checks:
- Hash chain is valid (no tampering)
- Lifecycle events are present (session_start and session_end)
- Sequence numbers are contiguous
- Hashes are deterministically reproducible

### 4. Add to CI

Add Krynix to your GitHub Actions (or any CI) to gate merges on policy compliance:

```yaml
# .github/workflows/trust-gate.yml
name: Krynix Trust Gate
on: [pull_request]
jobs:
  trust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install
      - run: pnpm build

      # Your agent test run produces a trace
      - run: node your-agent-test.js

      # Krynix gates
      - run: krynix evaluate --trace traces/session.trace.jsonl --policy policies/
      - run: krynix replay --verify --trace traces/session.trace.jsonl
```

If `krynix evaluate` exits non-zero, the CI step fails and the PR is blocked.

### 5. Verify Golden Trace Integrity `[CURRENT]`

Maintain a set of golden traces and verify their integrity:

```bash
# Save a golden trace
cp traces/my-session.trace.jsonl test/golden/my-baseline.trace.jsonl

# Verify integrity of all golden traces
krynix replay --verify --golden-dir test/golden/
```

This verifies that golden traces haven't been tampered with — hash chain, lifecycle events, and structure are all checked.

> **Note:** The `@krynix/replay` package exports a `compareTraces` function for structural drift comparison between two traces (`PARTIAL`), but it is not yet integrated into the CLI. CLI-level drift detection is planned.

## Where Krynix Sits in Your Workflow

```
┌─────────────────────────────────────────────────┐
│                  Your Agent                      │
│  (LangChain, CrewAI, AutoGen, custom, etc.)     │
│                                                  │
│  ┌──────────────┐                                │
│  │ LLM calls    │──┐                             │
│  │ Tool calls   │  │  Adapter or HTTP            │
│  │ Decisions    │  │  captures events            │
│  │ Observations │  │                             │
│  └──────────────┘  │                             │
└────────────────────┼─────────────────────────────┘
                     │
                     ▼
           ┌──────────────────┐
           │   Krynix Trace   │  .trace.jsonl
           │   (hash chain)   │  SHA-256 integrity
           └────────┬─────────┘
                    │
          ┌─────────┼──────────┐
          │         │          │
          ▼         ▼          ▼
     ┌─────────┐ ┌──────┐ ┌──────────┐
     │ Policy  │ │Replay│ │  Stats   │
     │  Eval   │ │Verify│ │[CURRENT] │
     └────┬────┘ └──┬───┘ └────┬─────┘
          │         │          │
          ▼         ▼          ▼
        CI gate   Integrity  Analytics
        (exit     check      (tokens,
        codes)               tools, etc.)
```

**Key insight:** Krynix doesn't execute your agent or intercept its traffic. It observes the trace evidence and evaluates it. Your agent runs normally — Krynix adds trust verification as a separate step.

## Integration Status

| Integration Path | Status | Description |
|------------------|--------|-------------|
| TypeScript + LangChain | `[CURRENT]` | `createLangChainTracer()` — zero-friction plugin |
| TypeScript + OpenClaw | `[CURRENT]` | `createKrynixPlugin()` — zero-friction plugin |
| TypeScript + custom agent | `[CURRENT]` | `@krynix/core` session API (manual but flexible) |
| HTTP Ingest Server | `[PLANNED]` | Any language via HTTP POST — server handles hashing |
| Python SDK | `[PLANNED]` | Thin HTTP client + LangChain callback handler |

## Example Files

| File | Description |
|------|-------------|
| [langchain-quickstart.ts](langchain-quickstart.ts) | TypeScript: LangChain tracer plugin → trace → evaluate |
| [http-quickstart.md](http-quickstart.md) | `[PLANNED]` Any language: HTTP ingest API protocol details |
