# Product Model

Krynix is designed as a two-layer product. This document defines the boundary between what is available today (OSS engine) and what is planned (Control Plane).

See [vision](vision.md) for the problem statement and core principles. See [business model](business_model.md) for target users and monetization hypotheses.

---

## Two-Layer Architecture

### Layer 1 — OSS Engine (This Repository)

The open-source reproducibility and audit engine. Available today, MIT licensed.

**What it provides:**

- TraceEvent schema with hash-chain tamper evidence
- Canonical JSON serialization
- Automatic secret redaction
- Policy parser and evaluator (YAML v1)
- Deterministic replay engine with golden trace testing
- CLI commands: `evaluate`, `replay`, `export`, `stats`, `policy validate`, `policy test`, `policy diff`
- Framework adapters (OpenClaw reference implementation)
- OTLP trace export

**Who it's for:** Developers and platform teams integrating trust verification into CI/CD pipelines.

**Design principles:** CI-first enforcement, determinism-first, infrastructure-first.

---

### Layer 2 — Krynix Control Plane (Planned)

Centralized governance infrastructure for organizations deploying agents at scale.

**What it may provide:**

- Centralized trace storage
- Hosted replay verification
- Golden trace registry (org-wide)
- Policy registry and distribution
- Signed execution attestations
- Compliance export bundles
- Role-based access control
- Org-level visibility over traces and policies

**Who it's for:** Organizations needing coordinated governance across multiple teams, agents, and environments.

**Status:** Design phase — not yet implemented. See [control plane spec](../10_architecture/control_plane_spec.md) for the full architecture.

**Integration model:** The control plane operates around Trace, Policy, and Replay artifacts — not inside agent execution. It consumes the same artifacts the OSS engine produces.

---

## What's Available vs. Planned

| Capability | Layer | Status |
|---|---|---|
| TraceEvent schema + hash chain | OSS Engine | Available |
| Policy evaluator (YAML v1) | OSS Engine | Available |
| Deterministic replay engine | OSS Engine | Available |
| CLI (evaluate, replay, export, stats, policy test/diff/validate) | OSS Engine | Available |
| Framework adapters | OSS Engine | Available (OpenClaw reference) |
| OTLP trace export | OSS Engine | Available |
| Custom redaction patterns | OSS Engine | Available |
| Policy inheritance | OSS Engine | Available |
| Policy diff engine | OSS Engine | Available |
| Streaming hash chain validation | OSS Engine | Available |
| Centralized trace storage | Control Plane | Planned |
| Policy registry and distribution | Control Plane | Planned |
| Signed execution attestations | Control Plane | Planned |
| Compliance export bundles | Control Plane | Planned |
| RBAC and org-level governance | Control Plane | Planned |

---

## Shared Non-Goals (Both Layers)

These boundaries hold for the entire Krynix product:

- Neither layer executes agents
- Neither layer hosts LLM inference
- Neither layer replaces CI systems
- Neither layer orchestrates agents
- Neither layer provides an agent execution sandbox

See [non-goals](non_goals.md) for the full boundary definition.

---

## Design Constraint

All OSS engine architectural decisions must consider future control plane integration. Specifically:

- Can this artifact be uploaded to a centralized store?
- Can this be verified remotely?
- Can this support signed attestations?
- Can this support org-wide policy governance?

Engine design must not block future hosted infrastructure.
