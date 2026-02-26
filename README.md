# Krynix

**The runtime trust layer for autonomous systems.**

Krynix provides trace standardization, deterministic replay, policy enforcement, and CI guardrails for AI agents. It makes agent behavior auditable, constrainable, and reproducible.

## What Krynix Is

Krynix is infrastructure that sits alongside agent execution runtimes and provides three composable primitives:

- **Trace** — structured, tamper-evident records of everything an agent does
- **Policy** — declarative YAML rules that constrain agent behavior, enforced in CI
- **Replay** — deterministic re-execution that proves agent behavior is reproducible

These compose into a trust pipeline:

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    Trace     │ ──▶ │     Policy       │ ──▶ │     Replay      │
│              │     │                  │     │                 │
│ Capture what │     │ Evaluate what    │     │ Verify it's     │
│ the agent did│     │ was allowed      │     │ reproducible    │
└──────────────┘     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                     ┌──────────────────┐
                     │    CI Gate       │
                     │                  │
                     │ Block merge on   │
                     │ violations       │
                     └──────────────────┘
```

## Why This Matters

Autonomous agents are moving from prototypes to production. When agents make decisions, invoke tools, and produce outputs at scale, organizations need infrastructure to answer three questions:

1. **What did the agent do?** → Trace
2. **Was it allowed to do that?** → Policy
3. **Can we prove it would do the same thing again?** → Replay

Krynix provides the trust primitives that make these questions answerable — in CI, before code ships.

The OSS engine (this repository) provides the core verification infrastructure. A future [Krynix Control Plane](docs/00_overview/product_model.md) will provide centralized governance for organizations deploying agents at scale.

## What Krynix Is NOT

- **Not an agent framework** — does not run agents or provide execution runtimes
- **Not an LLM provider** — does not host models or make inference calls
- **Not a monitoring UI** — provides data export, not dashboards
- **Not a CI system** — integrates with existing CI via exit codes
- **Not a secret manager** — redacts secrets from traces, does not manage them

See [non-goals](docs/00_overview/non_goals.md) for the full boundary definition.

## Quick Start

> **Note:** Krynix is in early development. The CLI and SDK are not yet published. This section will be updated with installation and usage instructions once packages are available.

```bash
# Install (placeholder — not yet published)
npm install -g @krynix/cli

# Evaluate a trace against policies
krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Verify deterministic replay
krynix replay --verify --golden-dir test/golden/
```

## Architecture

Krynix captures agent events via **Trace Adapters**, stores them as hash-chained **TraceEvents** in `.trace.jsonl` files, evaluates them against declarative **Policies** (`.policy.yaml`), and verifies reproducibility through **Deterministic Replay** within a controlled envelope.

Key design decisions:
- **CI-first enforcement** — policies are enforced as merge gates, not just runtime suggestions
- **Hash-chained traces** — SHA-256 linking provides tamper-evidence for every recorded event
- **Determinism Envelope** — fixed seeds, frozen time, stubbed network, snapshotted filesystem
- **Infrastructure-first** — Krynix is a foundational layer, not an application
- **Two-layer product** — The OSS engine (this repository) provides core verification primitives. A planned [Control Plane](docs/00_overview/product_model.md) will add centralized governance, policy distribution, and compliance tooling.

See [architecture.md](docs/10_architecture/architecture.md) for the full system design.

## Documentation

### Overview
- [Vision](docs/00_overview/vision.md) — problem statement, core principles, target users
- [Product Model](docs/00_overview/product_model.md) — OSS engine vs. Control Plane, what's available vs. planned
- [Business Model](docs/00_overview/business_model.md) — target users, monetization hypotheses
- [Non-Goals](docs/00_overview/non_goals.md) — explicit boundaries and scope exclusions
- [Glossary](docs/00_overview/glossary.md) — canonical terminology reference

### Architecture
- [Architecture](docs/10_architecture/architecture.md) — system overview, pipeline diagram, components
- [Trace Specification](docs/10_architecture/trace_spec.md) — TraceEvent schema, hash chain, redaction
- [Policy Specification](docs/10_architecture/policy_spec.md) — YAML format, rule matching, CI mapping
- [Determinism Specification](docs/10_architecture/determinism_spec.md) — replay guarantees, golden traces
- [Threat Model](docs/10_architecture/threat_model.md) — threats, attack vectors, mitigations
- [Integration Contracts](docs/10_architecture/integration_contracts.md) — adapter interface, OpenClaw example

### Development
- [Dev Environment](docs/20_development/dev_env.md) — setup, project structure, running tests
- [PR Review](docs/20_development/pr_review.md) — review checklist, security review triggers
- [Observability](docs/20_development/observability.md) — export formats, metrics, alerting
- [Git Workflow](docs/20_development/git_workflow.md)
- [Commit Conventions](docs/20_development/commit_conventions.md)
- [Testing Strategy](docs/20_development/testing_strategy.md)
- [CI/CD](docs/20_development/ci_cd.md)
- [Security Practices](docs/20_development/security_practices.md)
- [Dependency Policy](docs/20_development/dependency_policy.md)
- [Release Process](docs/20_development/release_process.md)

### Governance
- [RFC Template](docs/40_rfc/RFC_TEMPLATE.md) — how to propose changes
- [ADR Template](docs/30_decisions/ADR_TEMPLATE.md)
- [ADR-001: Project Scope](docs/30_decisions/ADR-001-project-scope.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started. Agent contributors should start with [.agents/TASKS.md](.agents/TASKS.md).

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

MIT
