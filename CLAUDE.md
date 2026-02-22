# CLAUDE.md — Agent Runtime Trust Layer (ARTL)

## 0. Purpose

You are contributing to **ARTL (Agent Runtime Trust Layer)**.

ARTL is a secure, testable runtime that sits between LLM agents and tools/data/execution.

It guarantees:
- Policy compliance
- Safe tool calls
- Verifiable outputs
- Auditability
- Deterministic replay
- CI-enforced behavioral regression detection

Primary wedge:
👉 “Agent Evals + Guardrails in CI”

This repository is infrastructure-first.
We optimize for correctness, determinism, and testability over speed.

---

## 1. Authoritative Documents (Read Before Coding)

Architecture & Contracts:
- docs/10_architecture/architecture.md
- docs/10_architecture/trace_spec.md
- docs/10_architecture/policy_spec.md
- docs/10_architecture/determinism_spec.md
- docs/10_architecture/threat_model.md

Engineering Rules:
- docs/20_development/git_workflow.md
- docs/20_development/commit_conventions.md
- docs/20_development/testing_strategy.md
- docs/20_development/ci_cd.md
- docs/20_development/security_practices.md
- docs/20_development/dependency_policy.md
- docs/20_development/release_process.md

Agent Workflow:
- .agents/SYSTEM.md
- .agents/RULES.md
- .agents/WORKFLOW.md
- .agents/REVIEW.md

---

## 2. Hard Rules

1. No schema changes without:
   - updating the corresponding spec document
   - updating fixtures
   - updating tests

2. Every feature must include tests.

3. Determinism is mandatory:
   - Same input must produce identical replay output.

4. No large dependencies without justification.

5. Never modify main directly.

---

## 3. Definition of Done

A change is complete when:
- Tests pass
- CI passes
- No schema inconsistencies
- Replay determinism preserved
- Documentation updated if required

---

## 4. Contribution Goal

ARTL must remain modular and integration-friendly.
Design with future interoperability (e.g., OpenClaw integration) in mind.