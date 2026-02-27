# Architecture Overview

This page describes the Krynix system architecture -- the components, how they interact, and the design decisions behind them.

## System Design

Krynix is infrastructure, not an agent framework. It sits alongside agent execution runtimes and provides trust primitives they lack:

1. **Trace** -- structured, immutable record of agent behavior
2. **Policy** -- declarative rules constraining what agents may do
3. **Replay** -- deterministic re-execution for reproducibility verification

These compose into a **trust pipeline** enforced in CI. See [[Trust Pipeline]] for the full composition model.

## Two-Layer Product

Krynix is designed as a two-layer product:

| Layer | Scope | Status |
|-------|-------|--------|
| **OSS Engine** (this repo) | Core verification: trace, policy, replay, CLI, adapters | Available (MIT) |
| **Control Plane** (planned) | Centralized governance: trace storage, policy registry, compliance, RBAC | Design phase |

The OSS engine is fully standalone -- no network connectivity required. The Control Plane is purely additive. See [[Control Plane]] for details.

## Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Agent Runtime                              │
│  (external: LangChain, OpenClaw, custom frameworks)              │
└──────────────────────┬───────────────────────────────────────────┘
                       | events
                       v
┌──────────────────────────────────────────────────────────────────┐
│                    Trace Capture                                  │
│                                                                   │
│  Trace Adapter -> TraceEvent -> Redaction -> Hash Chain -> .jsonl │
└──────────────────────┬────────────────────────────────────────────┘
                       | .trace.jsonl
                       v
┌──────────────────────────────────────────────────────────────────┐
│                   Policy Evaluation                               │
│                                                                   │
│  Load Policies -> Match Rules -> Compute Verdict -> Exit Code     │
└──────────────────────┬────────────────────────────────────────────┘
                       | verdict
                       v
┌──────────────────────────────────────────────────────────────────┐
│                  Deterministic Replay                              │
│                                                                   │
│  Load Trace -> Apply Envelope -> Re-execute -> Compare -> Report  │
└──────────────────────┬────────────────────────────────────────────┘
                       | pass/fail
                       v
┌──────────────────────────────────────────────────────────────────┐
│                     CI Gate                                       │
│                                                                   │
│  Policy Verdict + Replay Result -> merge/block decision           │
└──────────────────────────────────────────────────────────────────┘
```

## Components

### Trace Capture

Converts raw agent events into canonical TraceEvents and persists them.

- **Input:** Raw events from agent frameworks (via Trace Adapters)
- **Output:** `.trace.jsonl` files with hash-chained, redacted events
- **Trust property:** Hash chain provides tamper evidence; redaction prevents secret persistence

### Policy Evaluation

Evaluates a complete trace against one or more policies and produces a verdict.

- **Input:** `.trace.jsonl` + `.policy.yaml` files
- **Output:** Verdict (`pass`, `fail`, `require-approval`) and exit code
- **Trust property:** Policies are version-controlled, reviewed, and external to the agent

### Deterministic Replay

Re-executes a recorded trace and verifies reproducibility.

- **Input:** `.trace.jsonl` + Determinism Envelope configuration
- **Output:** Pass/fail with divergence report
- **Trust property:** Reproducibility proves behavior is deterministic and understood

### CI Gate

Integrates policy and replay results into CI pipelines.

- **Input:** Exit codes from evaluation and replay
- **Output:** GitHub Actions check pass/fail
- **Trust property:** Non-bypassable enforcement via merge protection rules

## Package Structure

See [[Package Structure]] for the detailed monorepo layout.

```
packages/
  core/               @krynix/core       Trace types, hash chain, redaction, stats, filtering
  policy/             @krynix/policy     Parser, evaluator, inheritance, diff, HTTP resolver
  replay/             @krynix/replay     Replay engine, determinism envelope, golden traces
  adapter-openclaw/   @krynix/adapter-openclaw   OpenClaw reference adapter
  cli/                @krynix/cli        CLI commands, router, binary entry point
```

**Dependency direction:**

```
core  <--  policy  <--  cli
core  <--  replay  <--  cli
core  <--  adapters
```

No circular dependencies. No package may import from `cli`. Core is a leaf dependency.

## System Boundaries

### What Krynix Owns

| Component | Description |
|-----------|-------------|
| TraceEvent schema | Canonical event format and validation |
| Hash chain | Tamper-evidence computation and verification |
| Redaction engine | Sensitive data detection and replacement |
| Policy engine | YAML parsing, rule matching, verdict computation |
| Replay engine | Determinism Envelope management and divergence detection |
| CLI | All `krynix` commands |
| Trace Adapter interface | Contract for framework-specific adapters |

### What Krynix Does NOT Own

| Component | Owned By |
|-----------|----------|
| Agent execution runtime | External frameworks |
| LLM inference | LLM providers |
| CI infrastructure | GitHub Actions, etc. |
| Secret management | Vault, AWS SSM, etc. |
| Agent orchestration | External orchestration layers |

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| CI-first enforcement | Policies as merge gates, not runtime suggestions |
| Hash-chained traces | Tamper evidence without external infrastructure |
| Determinism Envelope | Fixed seeds + frozen time + stubbed I/O = reproducible replay |
| Post-hoc evaluation | Traces captured first, evaluated after -- no runtime latency |
| Pure functions | Core modules are side-effect-free for testability |
| Dependency inversion | Core doesn't import policy/replay; callbacks injected at CLI layer |

## See Also

- [Architecture Document](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/architecture.md) -- Full specification
- [[Trust Pipeline]] -- How the primitives compose
- [[Package Structure]] -- Monorepo layout
- [[Control Plane]] -- Planned governance layer
