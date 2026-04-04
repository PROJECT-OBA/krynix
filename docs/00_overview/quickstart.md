# Quickstart: Integrate Krynix in 5 Minutes

This guide shows you how to add Krynix to an existing TypeScript agent and run your first policy check.

## Prerequisites

- Node.js >= 20
- An existing agent (or any TypeScript/JavaScript program that makes LLM or tool calls)

## Step 1: Install

```bash
# From GitHub release tarball
curl -L https://github.com/PROJECT-OBA/krynix/releases/latest/download/krynix -o krynix
chmod +x krynix
node krynix --version

# Or clone and build from source
git clone https://github.com/PROJECT-OBA/krynix.git
cd krynix && pnpm install && pnpm build
```

## Step 2: Instrument Your Agent

Add trace recording to your agent code. This writes a `.trace.jsonl` file to your project directory.

```typescript
import {
  startSession,
  recordEvent,
  endSession,
  TraceWriter,
} from "@krynix/core";

// 1. Create a writer — traces go to YOUR project, not Krynix's directory
const writer = new TraceWriter({ outputPath: "./traces" });

// 2. Start a session
const session = startSession({ agentId: "my-agent" });

// 3. Record events as your agent runs
recordEvent(session, {
  event_type: "tool_call",
  payload: {
    tool_name: "web_search",
    arguments: { query: "latest AI news" },
  },
});

recordEvent(session, {
  event_type: "tool_result",
  payload: {
    tool_name: "web_search",
    output: "Results: ...",
    duration_ms: 150,
    exit_code: 0,
  },
});

// 4. End and write
const events = endSession(session);
await writer.writeEvents(events);
// Creates: ./traces/<session-id>.trace.jsonl
```

### Using a Pre-Built Adapter (LangChain)

If you use LangChain, the adapter handles all event recording automatically:

```typescript
import { createLangChainTracer } from "@krynix/adapter-langchain";

const tracer = createLangChainTracer({
  agentId: "my-agent",
  outputPath: "./traces",
});

// Pass to LangChain — all LLM and tool calls are captured automatically
const result = await chain.invoke(input, {
  callbacks: [tracer.handler],
});

await tracer.stop();
```

## Step 3: Write a Policy

Create `policies/safety.policy.yaml`:

```yaml
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: basic-safety
  version: "1.0"
  description: Block dangerous tool calls
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: no-shell-exec
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

## Step 4: Evaluate

```bash
# Evaluate the trace against your policy
node krynix evaluate \
  --trace ./traces/*.trace.jsonl \
  --policy ./policies/safety.policy.yaml

# Exit code 0 = pass, 1 = error-severity violation, 2 = critical
```

## Step 5: Add to CI

```yaml
# .github/workflows/ci.yml (add after your test step)
- name: Krynix policy check
  run: node krynix evaluate --trace ./traces/*.trace.jsonl --policy ./policies/
```

That's it. Your agent now has tamper-proof trace logging and policy enforcement in CI.

## What's Next

- [How Policies Work](how-policies-work.md) — understand the 8 event types, operators, and match patterns
- [Security & Integrity](security-and-integrity.md) — hash chain guarantees and threat model
- [What Is Krynix](what-is-krynix.md) — full product overview
- Verify trace integrity: `node krynix replay --verify --golden-dir ./traces/`
- Compute analytics: `node krynix stats --trace ./traces/*.trace.jsonl`
