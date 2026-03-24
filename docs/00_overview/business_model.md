# Business Model

This document captures the commercial hypotheses for Krynix. All monetization is hypothetical — the OSS engine is the current focus.

See [product model](product_model.md) for the two-layer architecture.

---

## Ideal Customer Profile

Teams deploying autonomous AI agents in regulated or high-stakes environments where:

- Agent behavior must be auditable for compliance (financial services, healthcare, government)
- Agent capabilities must be constrained by organizational policy
- Agent behavior must be reproducible for incident investigation and regression testing
- Multiple teams or agents need coordinated governance
- CI/CD pipelines must enforce trust properties as merge gates

---

## Monetization Hypotheses

### OSS Engine Drives Adoption

Developers discover Krynix through CI integration and open-source usage. The engine is free, MIT licensed, and provides immediate value as a standalone tool.

Adoption signal: teams running `krynix evaluate` and `krynix replay` in CI pipelines.

### Control Plane Drives Revenue

Organizations needing centralized governance, signed attestations, compliance exports, and RBAC pay for the hosted control plane layer.

Revenue hypotheses (not validated):

- Per-seat or per-agent pricing for governance dashboard
- Usage-based pricing for trace storage and hosted replay verification
- Enterprise tier for self-hosted control plane in air-gapped or regulated environments

---

## Competitive Positioning

- **Primary wedge:** "Agent Evals + Guardrails in CI"
- **Differentiation:** [PLANNED] Deterministic execution replay (provable reproducibility), [CURRENT] hash-chain tamper evidence, [CURRENT] CI-first enforcement
- **What Krynix is NOT (OSS default):** A universal runtime gateway, SOC dashboard, or execution sandbox. OSS default is post-hoc verification and CI enforcement. In sidecar/hybrid deployments, a control surface may provide inline enforcement, but this is deployment-specific and not the OSS default posture.

---

## Status

All monetization is hypothetical. The OSS engine is the current focus. Control plane design will begin after v1.0 OSS engine stability.
