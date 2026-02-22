# Architecture

This document describes the Krynix system architecture — the Trace-Policy-Replay pipeline that forms the runtime trust layer for autonomous agent systems.

See [glossary](../00_overview/glossary.md) for term definitions.

## System Overview

Krynix is infrastructure, not an agent framework. It sits alongside agent execution runtimes and provides three composable primitives:

1. **Trace** — structured, immutable record of agent behavior ([spec](trace_spec.md))
2. **Policy** — declarative rules constraining what agents may do ([spec](policy_spec.md))
3. **Replay** — deterministic re-execution for reproducibility verification ([spec](determinism_spec.md))

These three primitives compose into a trust loop: agents produce Traces, Policies evaluate Traces, and Replay verifies that Traces are reproducible.

## Pipeline Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Runtime                            │
│  (external: LangChain, OpenClaw, custom frameworks)             │
└──────────────────────┬──────────────────────────────────────────┘
                       │ events
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Trace Capture                                │
│                                                                  │
│  Trace Adapter → TraceEvent → Redaction → Hash Chain → .jsonl   │
│                                                                  │
│  See: trace_spec.md                                              │
└──────────────────────┬───────────────────────────────────────────┘
                       │ .trace.jsonl
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Policy Evaluation                             │
│                                                                  │
│  Load Policies → Match Rules → Compute Verdict → Exit Code      │
│                                                                  │
│  See: policy_spec.md                                             │
└──────────────────────┬───────────────────────────────────────────┘
                       │ verdict
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Deterministic Replay                           │
│                                                                  │
│  Load Trace → Apply Envelope → Re-execute → Compare → Report    │
│                                                                  │
│  See: determinism_spec.md                                        │
└──────────────────────┬───────────────────────────────────────────┘
                       │ pass/fail
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                      CI Gate                                     │
│                                                                  │
│  Policy Verdict + Replay Result → merge/block decision           │
│                                                                  │
│  GitHub Actions integration via exit codes                       │
└──────────────────────────────────────────────────────────────────┘
```

## Components

### Trace Capture

**Responsibility:** Convert raw agent events into canonical TraceEvents and persist them.

**Input:** Raw events from agent frameworks (via Trace Adapters).
**Output:** `.trace.jsonl` files containing hash-chained, optionally redacted TraceEvents.

**Process:**
1. Trace Adapter receives external framework events
2. Adapter converts each event to a canonical TraceEvent (per [trace_spec](trace_spec.md))
3. Krynix core assigns `sequence_num` and `event_id`
4. Redaction engine scans payloads for sensitive data patterns
5. Hash Chain module computes `prev_hash` and `event_hash` (over the redacted form)
6. TraceEvent is serialized and appended to the `.trace.jsonl` file

**Trust properties:**
- Hash Chain provides tamper-evidence
- Redaction prevents secret persistence
- Structured format enables automated evaluation

### Policy Evaluation

**Responsibility:** Evaluate a complete Trace against one or more Policies and produce a verdict.

**Input:** `.trace.jsonl` file + `policies/*.policy.yaml` files.
**Output:** Policy Verdict (`pass`, `fail`, `require-approval`) and corresponding exit code.

**Process:**
1. Load and validate all `.policy.yaml` files in the policy directory
2. Load and validate the `.trace.jsonl` file (including hash chain verification)
3. For each TraceEvent, evaluate against each Policy's rules (first-match-wins within a policy)
4. Aggregate violations across all events and all policies
5. Compute final verdict using most-restrictive-wins composition
6. Return exit code per [CI mapping](policy_spec.md#severity-levels-and-ci-mapping)

**Trust properties:**
- Policies are version-controlled and PR-reviewed
- Evaluation is external to the agent (agent cannot modify its own policies)
- CI enforcement is non-bypassable (merge requires passing gate)

### Deterministic Replay

**Responsibility:** Re-execute a recorded Trace and verify reproducibility.

**Input:** `.trace.jsonl` file + Determinism Envelope configuration.
**Output:** Pass/fail result with divergence report if applicable.

**Process:**
1. Load the Trace and extract the Determinism Envelope from the `session_start` event
2. Initialize the replay environment (freeze time, stub network, snapshot filesystem, seed PRNG)
3. Replay each event in sequence, comparing agent decisions against recorded events
4. On divergence, report the exact event and field-level diff
5. On completion, verify the replayed hash chain matches the original

**Trust properties:**
- Reproducibility proves that agent behavior is deterministic and understandable
- Golden Traces in CI catch behavioral regressions
- Divergence reports pinpoint exactly where and how behavior changed

### CI Gate

**Responsibility:** Integrate Policy and Replay results into the CI pipeline to enforce trust properties on every merge.

**Input:** Policy Verdict exit code + Replay verification exit code.
**Output:** GitHub Actions check pass/fail.

**Process:**
1. CI runs `krynix evaluate` — produces policy exit code
2. CI runs `krynix replay --verify` — produces replay exit code
3. Both must exit 0 for the CI check to pass
4. Violations and divergence reports are surfaced as CI annotations

## System Boundaries

### What Krynix Owns

| Component | Description |
|---|---|
| TraceEvent schema | The canonical event format and all validation rules |
| Hash Chain | Tamper-evidence computation and verification |
| Redaction engine | Sensitive data detection and replacement |
| Policy engine | YAML parsing, rule matching, verdict computation |
| Replay engine | Determinism Envelope management and divergence detection |
| CLI | `krynix evaluate`, `krynix replay`, and related commands |
| Trace Adapter interface | The contract that framework-specific adapters implement |

### What Krynix Does Not Own

| Component | Owned By |
|---|---|
| Agent execution runtime | External frameworks (LangChain, OpenClaw, etc.) |
| LLM inference | LLM providers (Anthropic, OpenAI, etc.) |
| CI infrastructure | GitHub Actions (or other CI systems) |
| Secret management | External secret managers (Vault, AWS SSM, etc.) |
| Agent orchestration | External orchestration layers |

See [non-goals](../00_overview/non_goals.md) for the full boundary definition.

## Data Flow

```
Agent Framework
     │
     │  (1) raw events via callback/hook
     ▼
Trace Adapter
     │
     │  (2) canonical TraceEvents
     ▼
Redaction Engine ──→ strips secrets from payloads
     │
     │  (3) redacted TraceEvents
     ▼
Hash Chain Module ──→ computes prev_hash, event_hash
     │
     │  (4) hash-chained TraceEvents
     ▼
Trace Writer ──→ appends to .trace.jsonl
     │
     │  (5) complete .trace.jsonl file
     ├──────────────────────────┐
     ▼                          ▼
Policy Evaluator           Replay Engine
     │                          │
     │  (6a) verdict            │  (6b) pass/diverge
     ▼                          ▼
CI Gate ──→ exit code ──→ GitHub Actions check
```

## Package Structure

```
packages/
├── core/              # TraceEvent types, canonical JSON, hash chain, redaction
├── policy/            # Policy parser, rule matcher, evaluator
├── replay/            # Replay engine, determinism envelope, golden trace runner
├── adapters/          # Trace Adapter implementations (one per framework)
│   └── openclaw/      # OpenClaw adapter (reference implementation)
└── cli/               # CLI commands (evaluate, replay)
```

**Dependency direction:** `core` ← `policy` ← `cli`, `core` ← `replay` ← `cli`, `core` ← `adapters`. No circular dependencies. No package may import from `cli`. See [STYLE.md](../../.agents/STYLE.md) for module boundary rules.

## Trust Model

Krynix's trust model is based on three layers:

1. **Trace integrity** — Hash Chains ensure that recorded behavior cannot be silently modified. Any tampering breaks the chain and is detected during verification.

2. **Policy enforcement** — Policies are evaluated externally from the agent and enforced via CI gates. The agent cannot bypass, modify, or influence its own policy evaluation.

3. **Replay verification** — Deterministic Replay proves that the recorded behavior is reproducible. If behavior cannot be replayed, it may not be trustworthy.

These layers are independent. Each provides value on its own, and they compound when used together. See [threat model](threat_model.md) for the detailed analysis of threats and mitigations.

## Integration Points

External systems integrate with Krynix through:

1. **Trace Adapters** — convert framework-specific events to TraceEvents. See [integration contracts](integration_contracts.md).
2. **CLI** — `krynix evaluate` and `krynix replay` are the primary integration points for CI/CD pipelines.
3. **Observability export** — Traces can be exported to external observability platforms. See [observability](../20_development/observability.md).
