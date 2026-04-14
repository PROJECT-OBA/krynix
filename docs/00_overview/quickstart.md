# Quickstart: Integrate Krynix in 5 Minutes

This guide shows you how to add Krynix to an existing TypeScript agent and run your first policy check.

## Prerequisites

- Node.js >= 20
- An existing agent (or any TypeScript/JavaScript program that makes LLM or tool calls)

## Step 1: Install

```bash
# From GitHub release (standalone binary)
curl -L https://github.com/PROJECT-OBA/krynix/releases/latest/download/krynix.cjs -o krynix.cjs
chmod +x krynix.cjs
node krynix.cjs --version

# Or clone and build from source
git clone https://github.com/PROJECT-OBA/krynix.git
cd krynix && pnpm install && pnpm build
```

## Step 2: Instrument Your Agent

Add trace recording to your agent code. This writes a `.trace.jsonl` file to your project directory.

```typescript
import { startSession, recordEvent, endSession } from "@krynix/core";

const TRACE_PATH = "./traces/my-agent-session.trace.jsonl";

async function instrumentAgent(): Promise<void> {
  // 1. Start a session — opens TRACE_PATH for writing (directory must exist)
  const session = await startSession({
    agentId: "my-agent",
    outputPath: TRACE_PATH,
  });

  // 2. Record events as your agent runs
  await recordEvent(session, {
    event_type: "tool_call",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: "my-agent",
    metadata: null,
    payload: {
      tool_name: "web_search",
      arguments: { query: "latest AI news" },
    },
  });

  await recordEvent(session, {
    event_type: "tool_result",
    timestamp: new Date().toISOString(),
    parent_id: null,
    agent_id: "my-agent",
    metadata: null,
    payload: {
      tool_name: "web_search",
      output: "Results: ...",
      duration_ms: 150,
      exit_code: 0,
    },
  });

  // 3. End session — writes session_end and closes the trace file
  await endSession(session);
  // Trace written to: TRACE_PATH
}

instrumentAgent().catch(console.error);
```

### Using a Pre-Built Adapter (LangChain)

If you use LangChain, the adapter handles all event recording automatically:

```typescript
import { createLangChainTracer } from "@krynix/adapter-langchain";

const { handler, handle } = await createLangChainTracer({
  agentId: "my-agent",
  outputPath: "./traces/my-agent.trace.jsonl",
});

// Pass to LangChain — all LLM and tool calls are captured automatically
const result = await chain.invoke(input, {
  callbacks: [handler],
});

await handle.shutdown();
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
# Evaluate the trace against your policy (--trace takes a single .trace.jsonl file)
node krynix.cjs evaluate \
  --trace ./traces/my-agent-session.trace.jsonl \
  --policy ./policies/safety.policy.yaml

# Exit code 0 = pass, 1 = error-severity violation, 2 = critical
```

## Step 5: Add to CI

```yaml
# .github/workflows/ci.yml (add after your test step)
- name: Download Krynix
  run: |
    curl -L https://github.com/PROJECT-OBA/krynix/releases/latest/download/krynix.cjs -o krynix.cjs
    chmod +x krynix.cjs
- name: Krynix policy check
  run: node krynix.cjs evaluate --trace ./traces/my-agent-session.trace.jsonl --policy ./policies/
```

That's it. Your agent now has integrity-checked trace logging and policy enforcement in CI. For full tamper-evidence against intentional modification, generate a signing keypair (`krynix keygen`), sign traces after capture (`krynix sign`), and verify them during evaluation (`krynix evaluate --public-key`). See [Security & Integrity](security-and-integrity.md).

## What's Next

- [How Policies Work](how-policies-work.md) — understand the 8 event types, operators, and match patterns
- [Security & Integrity](security-and-integrity.md) — hash chain guarantees and threat model
- [What Is Krynix](what-is-krynix.md) — full product overview
- Verify trace integrity: `node krynix.cjs replay --verify --golden-dir ./traces/`
- Compute analytics: `node krynix.cjs stats --trace ./traces/my-agent-session.trace.jsonl`
