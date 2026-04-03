# What Is Krynix?

## The Problem

Your AI agent runs autonomously — calling APIs, reading files, querying databases, making decisions. But you can't answer basic questions about what it did:

- **What happened?** There's no reliable audit trail. Logs are scattered, incomplete, or easy to tamper with.
- **Did it follow the rules?** There's no way to check whether the agent violated your security policies, stayed within scope, or used only approved tools.
- **Has its behavior changed?** You deployed the same agent last week and it worked fine. Today it's doing something different. How do you detect that?
- **Can you prove the logs are real?** If someone (or something) modified the activity log, how would you know?

These aren't hypothetical problems. They're blockers for any team that wants to deploy AI agents in production with confidence.

## What Krynix Does

Krynix is a trust and observability toolkit for AI agents. It records what your agent does, checks it against your rules, and proves the records haven't been tampered with.

Four capabilities, each solving one of the problems above:

| Capability | What It Does | Analogy |
|-----------|-------------|---------|
| **Trace** | Records every action your agent takes — tool calls, LLM requests, decisions, errors — into a structured, tamper-evident log | A flight recorder for your AI agent |
| **Evaluate** | Checks that log against rules you define in YAML: "never call shell commands," "only use approved models," "require approval for database writes" | ESLint for agent behavior, not code |
| **Verify** | Proves the log hasn't been altered. Each event is cryptographically chained to the previous one using SHA-256 hashes. Break one link, and verification fails instantly | A wax seal on every page of a ledger |
| **Replay** | Verifies trace integrity — proves the log hasn't been altered or reordered. A library-level comparator (`PARTIAL`) can detect structural drift between two traces | Integrity seal + snapshot testing (planned for CLI) |

## How It Works

```
1. Your Agent runs normally
   ↓
   [Adapter captures every event automatically]
   ↓
2. trace.jsonl — structured, hash-chained log of all agent activity
   ↓
3. krynix evaluate --trace trace.jsonl --policy rules/
   → Exit 0 (pass), 1 (error or runtime error), 2 (critical), 3 (needs approval)
   ↓
4. krynix replay --verify --trace trace.jsonl
   → Integrity check: hash chain unbroken, events ordered, session complete
```

That's it. Three commands give you policy enforcement and integrity verification in any CI pipeline.

## Framework-Agnostic Policies

Write a policy once. It works with any agent framework — LangChain, CrewAI, AutoGen, custom agents, any language.

This works because Krynix normalizes all agent activity into **8 canonical event types**: `tool_call`, `tool_result`, `llm_request`, `llm_response`, `decision`, `observation`, `error`, and `lifecycle`. Every adapter translates framework-specific events into these types. Policies match against the canonical fields, not framework internals.

**Example policy** — block shell command execution regardless of which framework triggered it:

```yaml
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: no-shell-commands
  version: "1.0"
  description: Prevent shell command execution
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: block-shell
      description: Deny any tool call that executes shell commands
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

This catches `shell_exec` whether it came from LangChain, a Python script, or a Go agent. Zero modification needed.

## Three Ways to Integrate

You don't need to write a custom adapter. Choose the path that fits your stack:

| Path | Effort | Who It's For |
|------|--------|-------------|
| **Pre-built adapter** | Drop-in auto-capture with zero instrumentation code | LangChain, OpenClaw (more coming) |
| **SDK** | Import `@krynix/core` (TypeScript) or the Python SDK + a few lines of code | Python or TypeScript agents |
| **HTTP ingest** (`PLANNED`) | POST JSON events to an endpoint — no library needed | Any agent, any language |

For current integrations, use a pre-built adapter or the SDK. HTTP ingest is `PLANNED` as the first Control Plane component — it will provide zero-library integration for any language.

## What's Free vs Paid

| | OSS (this repo) | Control Plane (`PLANNED`) |
|---|---|---|
| Trace capture and storage | Yes | Yes |
| Policy evaluation in CI | Yes | Yes |
| Hash chain integrity verification | Yes | Yes |
| Baseline drift detection | `PARTIAL` (library only, not in CLI) | Full |
| CLI tooling (evaluate, replay, export) | Yes | Yes |
| Centralized policy registry | No | Yes |
| Team dashboards and compliance reports | No | Yes |
| Org-wide governance controls | No | Yes |

The OSS engine is production-ready for CI-based trust workflows. The Control Plane adds centralized governance for teams and organizations.

## Current Status

Be explicit about what works today and what's planned:

- **`CURRENT`**: Trace integrity, policy CI evaluation, replay integrity checks, CLI workflows — production-ready.
- **`PARTIAL`**: Behavioral drift comparison exists as a library function (`compareTraces` in `@krynix/replay`), but is not yet integrated into the CLI.
- **`PLANNED`**: Deterministic execution replay, runtime blocking (sidecar mode), centralized governance.

## Quick Start

```bash
# Clone and build
git clone https://github.com/PROJECT-OBA/krynix.git
cd krynix && pnpm install && pnpm build

# Evaluate a trace against policies
krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Verify trace integrity
krynix replay --verify --trace traces/session.trace.jsonl

# Verify integrity of golden traces
krynix replay --verify --golden-dir test/golden/
```

Exit codes: `0` = pass, `1` = error-severity violation or runtime error, `2` = critical-severity violation, `3` = requires approval (no CI-failing violations). Wire these into your CI pipeline.

## Learn More

- [How Policies Work](how-policies-work.md) — policy universality, the 8 event types, all integration paths
- [Security and Integrity](security-and-integrity.md) — what the hash chain guarantees, limitations, data protection
- [Product Model](product_model.md) — OSS vs Control Plane boundary
- [Platform Architecture Spec](../10_architecture/platform_architecture_spec.md) — canonical architecture reference
