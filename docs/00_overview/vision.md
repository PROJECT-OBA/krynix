# Vision

See [glossary](glossary.md) for term definitions.

## Problem Statement

Autonomous AI agents operate as black boxes. They make decisions, invoke tools, and produce outputs — but there is no standardized way to:

- **Audit** what an agent did and why it made specific decisions
- **Constrain** what an agent is allowed to do, enforced by infrastructure rather than by the agent itself
- **Reproduce** an agent's execution to verify that its behavior is deterministic and understood

Without these capabilities, deploying autonomous agents in production is a trust problem. Teams cannot verify safety, detect regressions, or prove compliance.

## Krynix Vision

Krynix is a **runtime trust layer** that makes agent behavior:

- **Auditable** — every action, decision, and observation is captured in a structured, tamper-evident Trace
- **Constrainable** — declarative Policies define what agents may and may not do, enforced at CI time
- **Reproducible** — deterministic Replay verifies that agent behavior can be exactly replicated

Krynix is infrastructure. It does not run agents, host models, or provide an execution runtime. It sits alongside existing agent frameworks and provides the trust primitives they lack.

## Core Principles

### 1. Infrastructure-First

Krynix is a foundational layer, not an application framework. It provides primitives (Trace, Policy, Replay) that other systems compose. Agent frameworks integrate with Krynix; Krynix does not integrate into agent frameworks.

### 2. Determinism as a Core Principle

If you cannot replay an agent's execution and get identical results, you cannot trust that the agent's behavior is fully understood. Determinism is not optional — it is the mechanism by which trust is established. See [determinism spec](../10_architecture/determinism_spec.md).

### 3. CI-First Enforcement

Policies are not suggestions. They are enforced in CI via Policy Gates that block merge when violations are detected. Runtime enforcement is supplementary; CI enforcement is the primary mechanism. This ensures that no code reaches production without passing trust verification. See [policy spec](../10_architecture/policy_spec.md).

### 4. Trace-Policy-Replay Pipeline

The three primitives compose into a trust loop:

```
Agent produces Trace → Policy evaluates Trace → Replay verifies Trace
```

Each primitive provides value independently, and they compound when used together. See [architecture](../10_architecture/architecture.md).

## Target Users

Teams deploying autonomous AI agents in production environments where:

- Agent behavior must be auditable for compliance, debugging, or safety analysis
- Agent capabilities must be constrained by organizational policy
- Agent behavior must be reproducible for regression testing and incident investigation
- CI/CD pipelines must enforce trust properties as merge gates

## Product Layers

Krynix is designed as a two-layer product:

- **OSS Engine (this repository)** — The core verification infrastructure: trace standardization, policy evaluation, deterministic replay, CLI, and framework adapters. Developer-first, CI-first, MIT licensed.
- **Krynix Control Plane (planned)** — Centralized governance infrastructure for organizations: trace storage, policy registry, signed attestations, compliance exports, RBAC. See [product model](product_model.md).

The OSS engine is the current focus. The control plane is in design phase.

## Success Criteria for v1.0

- TraceEvent schema is stable and implemented with hash chain integrity
- Policy engine supports the full YAML v1 specification with CI exit code mapping
- Replay engine supports the full Determinism Envelope with golden trace testing
- At least one Trace Adapter (OpenClaw reference implementation) is complete
- CLI supports `krynix evaluate` and `krynix replay` commands
- Documentation covers all specifications, threat model, and integration contracts
