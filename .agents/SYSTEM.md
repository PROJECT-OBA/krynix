# Agent System Context

Krynix is a reproducibility and audit infrastructure layer for autonomous systems.

Krynix has two layers:

1. **OSS Engine (Open Source)**
2. **Krynix Control Plane (Hosted / Monetizable Governance Layer)**

The OSS engine drives adoption.
The control plane drives monetization.

---

# Product Definition

## What Krynix Is

Krynix is a runtime trust layer for autonomous systems.

It provides:

- A trace standardization layer (structured, tamper-evident records)
- A CI-enforced policy evaluation system
- A deterministic replay engine
- A declarative policy enforcement layer

Krynix makes agent behavior:

- Reproducible
- Testable
- Merge-safe
- Auditable
- Tamper-evident

Krynix brings CI discipline to autonomous systems.

---

## Core Primitives (Non-Negotiable)

1. **Trace** — ordered, hash-chained sequence of TraceEvents  
2. **Policy** — declarative YAML rules constraining agent behavior  
3. **Replay** — deterministic re-execution for reproducibility verification  

Every implementation decision must preserve and strengthen these primitives.

If a feature does not reinforce Trace, Policy, or Replay, it must be explicitly justified.

---

# Two-Layer Architecture

## Layer 1 — OSS Engine (Free)

This repository contains the engine:

- TraceEvent schema
- Canonical JSON
- Hash chain integrity
- Redaction
- Policy parser & evaluator
- Deterministic replay engine
- CLI integration
- Framework adapters

The OSS engine:
- Does NOT execute agents
- Does NOT block runtime tool calls (CI-time enforcement only)
- Does NOT host LLM inference
- Does NOT provide a monitoring dashboard
- Does NOT replace CI systems
- Does NOT orchestrate agents

The OSS engine is developer-first and CI-first.

---

## Layer 2 — Krynix Control Plane (Future / Monetizable)

The control plane may provide:

- Centralized trace storage
- Hosted replay verification
- Golden trace registry (org-wide)
- Policy registry & distribution
- Signed execution attestations
- Compliance export bundles
- Role-based access control
- Org-level visibility over traces & policies

The control plane:

- Does NOT execute agents
- Does NOT provide runtime blocking guarantees
- Does NOT host LLM inference
- Does NOT replace CI
- Does NOT orchestrate agents

It operates around Trace, Policy, and Replay artifacts — not inside agent execution.

All OSS architectural decisions must consider future control plane integration.

---

# Repository Structure

Krynix is a pnpm monorepo with the following packages:
packages/core/    — TraceEvent types, canonical JSON, hash chain, redaction, trace reader/writer
packages/policy/  — Policy YAML parser, rule matcher, evaluator
packages/replay/  — Golden trace validator, replay verifier
packages/cli/     — CLI commands (evaluate, replay)

Dependency direction:
core ← policy ← cli
core ← replay ← cli

No circular dependencies.

No package may import from `cli`.

Each package must expose a single public entry point:
src/index.ts

All public exports must pass through this file.

---

# Architectural Principles

## 1. Determinism First

Replay must be deterministic within the defined envelope.

No hidden randomness.
No unrecorded external dependencies.
No silent drift.

If determinism is weakened, it must be documented explicitly.

---

## 2. Tamper-Evidence by Default

All traces must be:

- Hash-chained
- Canonicalized before hashing
- Redacted before hashing
- Verifiable independently

Trace integrity is foundational.

---

## 3. CI Enforcement Is the Primary Guarantee

Policy evaluation is guaranteed at CI-time.

Runtime pre-action hooks are optional and best-effort.

CI exit codes are the enforcement boundary.

---

## 4. Control Plane Compatibility

New features must consider:

- Can this artifact be uploaded?
- Can this be verified remotely?
- Can this support signed attestations?
- Can this support org-wide policy governance?

Engine design must not block future hosted infrastructure.

---

## 5. No Scope Creep Into Runtime Security

Krynix is NOT:

- An agent firewall
- An inline runtime gateway
- A SOC dashboard
- An execution sandbox host
- An LLM proxy

We provide reproducibility and verification infrastructure — not runtime control.

---

# Technology Stack

- **Runtime:** Node.js >= 20
- **Language:** TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- **Package manager:** pnpm (workspace)
- **Build:** tsup (ESM + CJS + DTS)
- **Test:** Vitest (including `expectTypeOf`)
- **Lint:** ESLint v9 (flat config, typescript-eslint/strict)
- **Format:** Prettier

---

# Key Specifications

- Schema version: `1.0.0`
- Policy API version: `krynix.dev/v1`
- Wire format types use **string unions** (not TypeScript enums)
- Regex operator uses **ECMAScript RegExp**
- Canonical JSON uses `JSON.stringify`
- Rejects NaN / Infinity / BigInt
- CI exit codes:
  - `0` — pass
  - `1` — error
  - `2` — critical
  - `3` — require-approval

All exit code semantics must remain stable.

---

# Agent Development Rules

When implementing changes:

1. Strengthen Trace, Policy, or Replay.
2. Maintain deterministic guarantees.
3. Avoid introducing hidden nondeterminism.
4. Update documentation when behavior changes.
5. Add regression tests for any behavioral change.
6. Consider control-plane compatibility for new artifacts.

If a feature does not clearly support reproducibility, auditability, CI enforcement, or future governance infrastructure, it should not be added.

---

# Strategic Direction

Krynix is not just a CLI library.

It is:

- The reproducibility engine for autonomous systems.
- The foundation for a governance control plane.
- The CI layer for agent behavior.
- Infrastructure for provable AI execution.

All decisions should move the system toward:

- Stronger determinism
- Stronger integrity
- Clearer boundaries
- Future monetizable governance capabilities