<p align="center">
  <strong>Krynix</strong><br>
  <em>Trust evidence and policy spine for agentic systems</em>
</p>

<p align="center">
  <a href="docs/10_architecture/platform_architecture_spec.md">Canonical Platform Spec</a> &middot;
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="docs/10_architecture/architecture.md">Architecture</a> &middot;
  <a href="wiki/Home.md">Wiki</a>
</p>

## What Krynix Is
Krynix is the OSS trust spine for agentic systems. It standardizes trace evidence, evaluates policy decisions, and supports replay-based verification workflows in CI and post-run analysis.

Determinism remains a core design principle.
Current replay guarantee is integrity + baseline diff.
Execution replay is planned and tracked.

REPLAY_CURRENT_MODE=integrity_plus_baseline_diff
KRYNIX_ROLE=trust_spine_not_full_platform
KRYNIX_RUNTIME_ENFORCEMENT=external_runtime_controls_ci_postrun_in_oss

For authoritative architecture and guarantee boundaries, read:
- [Platform Architecture Specification](docs/10_architecture/platform_architecture_spec.md)
- [Integration Blueprints](docs/10_architecture/integration_blueprints.md)
- [Consumer Usage Model](docs/00_overview/consumer_usage_model.md)

## Current Capability Snapshot
- `CURRENT`: Trace integrity (`@krynix/core` hash-chain + schema/lifecycle checks)
- `CURRENT`: Policy parsing/evaluation with CI exit-code enforcement (`krynix evaluate`)
- `CURRENT`: Replay integrity verification (`krynix replay --verify`)
- `PARTIAL`: Behavioral drift checks via baseline comparison (`krynix replay --verify --trace ... --baseline ...`)
- `PARTIAL`: Redaction coverage is key-pattern based and not universal
- `PLANNED`: Deterministic execution replay of live agent logic

## Quickstart
> Packages are source-first in this repository.

```bash
git clone https://github.com/artificialvirus/krynix.git
cd krynix
pnpm install
pnpm build
```

Run core trust checks:

```bash
# Policy gate
pnpm krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Replay integrity check
pnpm krynix replay --verify --trace traces/session.trace.jsonl

# Replay drift check against baseline
pnpm krynix replay --verify --trace traces/current.trace.jsonl --baseline traces/golden.trace.jsonl
```

## How Teams Use It
- CI gate: block merges on policy violations and replay verification failures.
- Post-run trust analysis: inspect traces, drift, and evidence bundles.
- Runtime integration: choose sidecar or framework-adapter blueprint and apply profiled rollout (`dev`/`staging`/`prod`).

## Repo Layout
```text
packages/
  core/               @krynix/core
  policy/             @krynix/policy
  replay/             @krynix/replay
  adapter-openclaw/   @krynix/adapter-openclaw
  cli/                @krynix/cli
```

## Docs Map
- Canonical: [docs/10_architecture/platform_architecture_spec.md](docs/10_architecture/platform_architecture_spec.md)
- Integration: [docs/10_architecture/integration_blueprints.md](docs/10_architecture/integration_blueprints.md)
- Consumer model: [docs/00_overview/consumer_usage_model.md](docs/00_overview/consumer_usage_model.md)
- Phase 1 contract draft: [docs/10_architecture/phase1_implementation_contract.md](docs/10_architecture/phase1_implementation_contract.md)
- Phase 1 policy baseline: [docs/10_architecture/policy_baseline_phase1.md](docs/10_architecture/policy_baseline_phase1.md)
- Architecture: [docs/10_architecture/architecture.md](docs/10_architecture/architecture.md)
- Determinism/replay: [docs/10_architecture/determinism_spec.md](docs/10_architecture/determinism_spec.md)
- Policy semantics: [docs/10_architecture/policy_spec.md](docs/10_architecture/policy_spec.md)
- Component contracts: [docs/10_architecture/component_contract_matrix.md](docs/10_architecture/component_contract_matrix.md)
- Glossary: [docs/00_overview/glossary_platform.md](docs/00_overview/glossary_platform.md)
- Governance: [docs/20_development/documentation_governance.md](docs/20_development/documentation_governance.md)

## Planning And Tracking
- Backlog (canonical): [docs/20_development/phase1_backlog.md](docs/20_development/phase1_backlog.md)
- Milestones: [docs/20_development/phase1_milestones.md](docs/20_development/phase1_milestones.md)
- Weekly checkpoints: [docs/20_development/weekly_checkpoints.md](docs/20_development/weekly_checkpoints.md)
- IDE runbook: [docs/20_development/runbook_ide_sidecar.md](docs/20_development/runbook_ide_sidecar.md)
- Runtime runbook: [docs/20_development/runbook_runtime_adapter.md](docs/20_development/runbook_runtime_adapter.md)
- CI runbook: [docs/20_development/runbook_ci_gate_template.md](docs/20_development/runbook_ci_gate_template.md)

## Non-Goals (Current)
- Not an agent framework or orchestrator.
- Not an LLM host/provider.
- Not a full runtime firewall in OSS today.

See [docs/00_overview/non_goals.md](docs/00_overview/non_goals.md) for boundaries.
