# Product Model

## Purpose

Define the boundary between OSS capabilities and planned platform capabilities. This document is the authoritative reference for what is free, what is paid, and why.

## Where Used

- Product scope decisions
- OSS vs Control Plane messaging
- Go-to-market and onboarding clarity
- Feature prioritization and roadmap planning

## OSS Engine (Always Free — MIT License)

The OSS engine is everything in this repository. It runs locally, offline, with zero external dependencies.

### Packages

| Package | What It Does | Status |
|---------|-------------|--------|
| `@krynix/core` | Trace schema, SHA-256 hash chain, canonical JSON, SeededRandom, redaction | `CURRENT` |
| `@krynix/policy` | Policy evaluation engine, YAML parsing, 7 match operators, first-match-wins | `CURRENT` |
| `@krynix/replay` | Trace integrity verification, baseline drift comparison | `CURRENT` / `PARTIAL` |
| `@krynix/cli` | `evaluate`, `replay`, `stats`, `export` commands with CI exit codes | `CURRENT` |
| `@krynix/adapter-langchain` | Auto-capture adapter for LangChain agents | `CURRENT` |
| `@krynix/adapter-openclaw` | Auto-capture adapter for OpenClaw agents | `CURRENT` |

### Capabilities

- [CURRENT] Trace capture and local storage (`.trace.jsonl` files)
- [CURRENT] SHA-256 hash chain integrity — tamper detection for every event
- [CURRENT] Policy evaluation in CI — deterministic exit codes (0/1/2/3)
- [CURRENT] Replay integrity verification — chain, ordering, session bookends
- [CURRENT] Framework-agnostic policies — write once, apply to any agent
- [CURRENT] Compliance export — evidence bundles for audit
- [CURRENT] Offline operation — zero network calls, zero telemetry
- [PARTIAL] Baseline drift detection — structural comparison, not semantic
- [PARTIAL] Redaction — key-pattern based, not universal content scanning

### What OSS Does NOT Include

- No centralized policy management across teams
- No team dashboards or trace browsing UI
- No compliance report generation (SOC2, ISO packaging)
- No org-wide governance (role-based access, policy override controls)
- No real-time runtime blocking (CI/post-run enforcement only)
- No input-layer intelligence (intent classification, content scanning)

## Control Plane (Planned — Paid)

The Control Plane adds centralized governance for teams and organizations. It builds on top of the OSS engine — the OSS packages remain free and are required for the Control Plane to work.

### Components

| Component | What It Does | Status |
|-----------|-------------|--------|
| HTTP Ingest Server | Centralized trace collection from any language via HTTP POST | `PLANNED` |
| Policy Registry | Centralized policy management, versioning, and distribution | `PLANNED` |
| Team Dashboard | Trace browsing, violation history, agent activity views | `PLANNED` |
| Compliance Reports | SOC2, ISO evidence packaging from stored traces | `PLANNED` |
| Org Governance | Role-based access, policy override workflows, approval chains | `PLANNED` |
| Runtime Blocking | Webhook-based deny/approve for sidecar deployment mode | `PLANNED` |
| IntentClassifier | Advisory risk scoring and intent labeling (input-layer intelligence) | `PLANNED` |
| MultiScanGuard | Content scanning for data poisoning and malicious payloads | `PLANNED` |

### Deployment Modes

| Mode | Description | Status |
|------|------------|--------|
| **Passive / Post-Run** | OSS engine evaluates traces after agent execution | `CURRENT` |
| **Inline Sidecar** | Control Plane intercepts tool calls in real-time before execution | `PLANNED` |
| **Hybrid** | Partial runtime controls with post-run verification | `PLANNED` |

### Licensing

- OSS packages (`krynix` repo): MIT — always free
- SDK packages (`krynix-sdk-python`): MIT — always free (they send data TO the paid server)
- Control Plane services (`krynix-ingest`, future `krynix-platform`): Proprietary or BSL

## Integration Paths

| Path | Language | Requires | Cost |
|------|----------|----------|------|
| Pre-built adapter | TypeScript | OSS only | Free |
| TypeScript SDK | TypeScript | OSS only | Free |
| Python SDK | Python | OSS only | Free |
| HTTP Ingest (`PLANNED`) | Any | Control Plane | Paid |
| Custom adapter | TypeScript | OSS only | Free |

The HTTP ingest path (`PLANNED`) will be the universal, zero-adapter integration for any language. It is the first paid component because it requires a running server.

## Non-Goals

- [CURRENT] OSS does not replace agent orchestration runtimes.
- [CURRENT] OSS does not host LLM inference.
- [CURRENT] OSS does not provide full inline runtime prevention as a built-in guarantee.
- [CURRENT] OSS does not universally own the request ingress point.
- [CURRENT] Advisory intelligence alone is not a basis for critical denial.

## Interfaces / Contracts

- Canonical architecture: `docs/10_architecture/platform_architecture_spec.md`
- OSS package contracts: `docs/10_architecture/component_contract_matrix.md`
- Control Plane design: `docs/10_architecture/control_plane_spec.md`

## Known Gaps and Roadmap

- [PARTIAL] Replay is integrity + structural drift diff, not execution replay.
- [PARTIAL] Redaction is key-pattern based, not universal content scanning.
- [PLANNED] Execution replay — re-run agent with same inputs, verify same outputs.
- [PLANNED] Layered input/runtime/output enforcement contracts.
- [PLANNED] HTTP ingest server — first paid component, universal integration path.
- [CURRENT] Schema v1.0.0 optional fields — cost tracking, approval fields, streaming marker (backward-compatible additions; traces still declare `schema_version: "1.0.0"`).
