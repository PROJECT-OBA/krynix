# Krynix Examples

How to use Krynix from "I have an agent" to "I have trust evidence."

## The User Journey

### 1. Generate a Trace

A Krynix trace is a `.trace.jsonl` file — a JSON Lines file where each line is a trace event with a SHA-256 hash chain. There are two ways to generate one:

**Option A: TypeScript adapter (local, offline)**

If your agent is TypeScript-based, use a framework adapter to capture events directly:

```typescript
import { LangChainAdapter } from "@krynix/adapter-langchain";
import { startSession, recordEvent, endSession } from "@krynix/core";

const session = await startSession({
  agentId: "my-agent",
  outputPath: "traces/my-session.trace.jsonl",
});

const adapter = new LangChainAdapter();
await adapter.initialize({ agentId: "my-agent", sessionId: session.sessionId });

// In your callback handler:
const event = adapter.onEvent({ _callback: "handleToolStart", tool: { name: "search" }, input: "query", runId: "r1" });
if (event) await recordEvent(session, event);

await endSession(session);
```

> **Note:** Create the output directory before running: `mkdir -p traces`

See: [langchain-quickstart.ts](langchain-quickstart.ts)

**Option B: HTTP ingest (any language)**

If your agent is Python, Go, .NET, or any other language, send events via HTTP to the Krynix Ingest Server. The server computes hash chains for you.

```bash
curl -X POST "https://ingest.krynix.dev/v1/sessions/$SESSION_ID/events" \
  -H "Authorization: Bearer krynix_..." \
  -d '{"events": [{"event_type": "tool_call", ...}]}'
```

See: [http-quickstart.md](http-quickstart.md)

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

### 5. Detect Behavioral Drift

Compare a current trace against a known-good baseline:

```bash
# Save a golden trace as your baseline
cp traces/my-session.trace.jsonl test/golden/my-baseline.trace.jsonl

# Later, compare new runs against the baseline
krynix replay --verify --trace traces/new-run.trace.jsonl --baseline test/golden/my-baseline.trace.jsonl
```

This detects when agent behavior drifts from the established pattern — even if no individual policy rule is violated.

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
     │  Eval   │ │Verify│ │          │
     └────┬────┘ └──┬───┘ └────┬─────┘
          │         │          │
          ▼         ▼          ▼
        CI gate   Integrity  Analytics
        (exit     check      (tokens,
        codes)               tools, etc.)
```

**Key insight:** Krynix doesn't execute your agent or intercept its traffic. It observes the trace evidence and evaluates it. Your agent runs normally — Krynix adds trust verification as a separate step.

## Example Files

| File | Description |
|------|-------------|
| [langchain-quickstart.ts](langchain-quickstart.ts) | TypeScript: LangChain adapter → session → trace → evaluate |
| [http-quickstart.md](http-quickstart.md) | Any language: HTTP ingest API with curl and Python examples |
