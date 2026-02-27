# Krynix Wiki

**Krynix** is a runtime trust layer for autonomous AI agents. It provides trace standardization, deterministic replay, policy enforcement, and CI guardrails that make agent behavior auditable, constrainable, and reproducible.

---

## Navigation

### Getting Started
- [[Getting Started]] -- Setup, prerequisites, first commands
- [[CLI Reference]] -- Complete command reference with examples

### Core Concepts
- [[Trace]] -- Structured, tamper-evident records of agent behavior
- [[Policy]] -- Declarative YAML rules constraining agent behavior
- [[Replay]] -- Deterministic re-execution for reproducibility verification
- [[Trust Pipeline]] -- How Trace, Policy, and Replay compose

### Architecture
- [[Architecture Overview]] -- System design, components, data flow
- [[Package Structure]] -- Monorepo layout and dependency direction
- [[Control Plane]] -- Planned centralized governance layer

### Developing
- [[Development Guide]] -- Building, testing, linting, IDE setup
- [[Writing Trace Adapters]] -- How to integrate new agent frameworks
- [[Writing Policies]] -- Policy YAML format and rule matching
- [[Testing Strategy]] -- Unit, integration, and golden trace tests

### Reference
- [[TraceEvent Schema]] -- Complete field reference for all event types
- [[Policy YAML Schema]] -- Full policy specification
- [[Glossary]] -- Canonical terminology
- [[FAQ]] -- Frequently asked questions

---

## Quick Links

| Resource | Description |
|----------|-------------|
| [README](https://github.com/artificialvirus/krynix/blob/main/README.md) | Project overview |
| [CONTRIBUTING](https://github.com/artificialvirus/krynix/blob/main/CONTRIBUTING.md) | Contribution guide |
| [SECURITY](https://github.com/artificialvirus/krynix/blob/main/SECURITY.md) | Vulnerability reporting |
| [Architecture Spec](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/architecture.md) | Full architecture document |
| [Trace Spec](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/trace_spec.md) | Trace format specification |
| [Policy Spec](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/policy_spec.md) | Policy format specification |
| [Determinism Spec](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/determinism_spec.md) | Replay specification |
