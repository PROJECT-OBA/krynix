<p align="center">
  <strong>Krynix</strong><br>
  <em>Trust evidence and policy spine for agentic systems</em>
</p>

<p align="center">
  <a href="https://github.com/PROJECT-OBA/krynix/actions/workflows/ci.yml">
    <img src="https://github.com/PROJECT-OBA/krynix/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node ≥20">
  <img src="https://img.shields.io/badge/pnpm-%3E%3D8-orange" alt="pnpm ≥8">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

<p align="center">
  <a href="docs/10_architecture/platform_architecture_spec.md">Platform Spec</a> &middot;
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="docs/10_architecture/architecture.md">Architecture</a> &middot;
  <a href="wiki/Home.md">Wiki</a>
</p>

---

## What Krynix Is

Krynix is the OSS trust spine for agentic systems. It standardizes trace evidence, evaluates policy decisions, and supports replay-based verification workflows in CI and post-run analysis.

Determinism is a core design principle. Current replay guarantee is **integrity + baseline diff**. Execution replay is planned.

For authoritative architecture and guarantee boundaries see the [Platform Architecture Specification](docs/10_architecture/platform_architecture_spec.md).

---

## Current Capabilities

| Status | Capability |
|--------|-----------|
| `CURRENT` | Trace integrity — `@krynix/core` hash-chain + schema and lifecycle validation |
| `CURRENT` | Policy parsing and evaluation with CI exit-code enforcement (`krynix evaluate`) |
| `CURRENT` | Replay integrity verification (`krynix replay --verify`) |
| `PARTIAL` | Behavioral drift checks via baseline comparison (`--baseline`) |
| `PARTIAL` | Redaction — key-pattern based, not universal |
| `PLANNED` | Deterministic execution replay of live agent logic |

---

## Quickstart

```bash
git clone https://github.com/PROJECT-OBA/krynix.git
cd krynix
pnpm install
pnpm build
```

Run core trust checks:

```bash
# Policy gate — exits non-zero on violations
krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Replay integrity check
krynix replay --verify --trace traces/session.trace.jsonl

# Replay drift check against a golden baseline
krynix replay --verify --trace traces/current.trace.jsonl --baseline traces/golden.trace.jsonl
```

---

## How Teams Use It

- **CI gate** — block merges on policy violations and replay verification failures
- **Post-run trust analysis** — inspect traces, drift, and compliance evidence bundles
- **Runtime integration** — choose a sidecar or framework-adapter blueprint and roll out per environment (`dev` / `staging` / `prod`)

---

## Repo Layout

```text
packages/
  core/               @krynix/core          — trace types, hash chain, redaction
  policy/             @krynix/policy        — policy parsing, evaluation, inheritance
  replay/             @krynix/replay        — integrity verification, baseline diff
  adapter-openclaw/   @krynix/adapter-openclaw   — OpenClaw framework adapter
  adapter-langchain/  @krynix/adapter-langchain  — LangChain framework adapter
  cli/                @krynix/cli           — krynix command-line tool
```

---

## Docs

| Topic | Link |
|-------|------|
| Platform architecture (canonical) | [platform_architecture_spec.md](docs/10_architecture/platform_architecture_spec.md) |
| Architecture overview | [architecture.md](docs/10_architecture/architecture.md) |
| Integration blueprints | [integration_blueprints.md](docs/10_architecture/integration_blueprints.md) |
| Consumer usage model | [consumer_usage_model.md](docs/00_overview/consumer_usage_model.md) |
| Trace specification | [trace_spec.md](docs/10_architecture/trace_spec.md) |
| Policy specification | [policy_spec.md](docs/10_architecture/policy_spec.md) |
| Determinism and replay | [determinism_spec.md](docs/10_architecture/determinism_spec.md) |
| Component contracts | [component_contract_matrix.md](docs/10_architecture/component_contract_matrix.md) |
| Glossary | [glossary_platform.md](docs/00_overview/glossary_platform.md) |
| Non-goals | [non_goals.md](docs/00_overview/non_goals.md) |

<details>
<summary>Planning and tracking</summary>

| Topic | Link |
|-------|------|
| Phase 1 backlog (canonical) | [phase1_backlog.md](docs/20_development/phase1_backlog.md) |
| Phase 1 milestones | [phase1_milestones.md](docs/20_development/phase1_milestones.md) |
| Weekly checkpoints | [weekly_checkpoints.md](docs/20_development/weekly_checkpoints.md) |
| GitHub orchestration | [github_orchestration.md](docs/20_development/github_orchestration.md) |
| IDE sidecar runbook | [runbook_ide_sidecar.md](docs/20_development/runbook_ide_sidecar.md) |
| Runtime adapter runbook | [runbook_runtime_adapter.md](docs/20_development/runbook_runtime_adapter.md) |
| CI gate runbook | [runbook_ci_gate_template.md](docs/20_development/runbook_ci_gate_template.md) |

</details>

---

## Non-Goals

- Not an agent framework or orchestrator
- Not an LLM host or provider
- Not a full runtime firewall in OSS — runtime enforcement scope varies by deployment mode (passive, sidecar, hybrid)
- Does not universally own the request ingress point
- Does not treat inferred intent alone as a trust control

See [non_goals.md](docs/00_overview/non_goals.md) for full boundaries.

<!-- machine-readable consistency markers (checked by docs:check:readme)
REPLAY_CURRENT_MODE=integrity_plus_baseline_diff
KRYNIX_ROLE=trust_spine_not_full_platform
KRYNIX_RUNTIME_ENFORCEMENT=external_runtime_controls_ci_postrun_in_oss
KRYNIX_INPUT_LAYER_MODE=deployment_specific_not_universal
KRYNIX_ENFORCEMENT_PRINCIPLE=block_on_actions_not_inferred_intent
-->
