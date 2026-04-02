<p align="center">
  <strong>Krynix</strong><br>
  <em>Policy gates for AI agent behavior — like ESLint for your agents, not your code</em>
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
  <a href="docs/00_overview/what-is-krynix.md">What Is Krynix?</a> &middot;
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="docs/00_overview/how-policies-work.md">How Policies Work</a> &middot;
  <a href="docs/10_architecture/platform_architecture_spec.md">Architecture</a>
</p>

---

## The Problem

Your AI agent runs autonomously — calling tools, querying LLMs, making decisions. But you can't answer:

- **What did it do?** No structured, tamper-proof audit trail.
- **Did it follow the rules?** No automated policy enforcement.
- **Has it changed?** No way to detect behavioral drift between runs.

## The Solution

Krynix records every agent action into a tamper-proof trace, evaluates it against your policies, and verifies nothing was altered.

```bash
# 1. Your agent runs normally — adapter captures every event automatically
#    → session.trace.jsonl (SHA-256 hash-chained log)

# 2. Check policy compliance — exits non-zero on violations
krynix evaluate --trace session.trace.jsonl --policy policies/

# 3. Verify integrity — prove the trace hasn't been tampered with
krynix replay --verify --trace session.trace.jsonl
```

Exit codes: `0` pass · `1` error · `2` violation · `3` needs approval. Wire into any CI pipeline.

---

## Quickstart

```bash
git clone https://github.com/PROJECT-OBA/krynix.git
cd krynix
pnpm install
pnpm build
```

### Write a Policy

Create `policies/no-shell.policy.yaml`:

```yaml
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: no-shell-commands
  version: "1.0"
  description: Block shell command execution by any agent
spec:
  rules:
    - id: block-shell
      description: Deny shell-like tool calls
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: matches
            value: "^(shell|bash|exec|system).*"
      action: deny
      severity: critical
      message: "Shell command execution is not permitted"
```

### Evaluate a Trace

```bash
krynix evaluate --trace traces/session.trace.jsonl --policy policies/
# Exit code 0 = all clear, 2 = violation found
```

### Verify Integrity

```bash
krynix replay --verify --trace traces/session.trace.jsonl
# Walks the SHA-256 hash chain — detects any modification, deletion, or reordering
```

### Detect Drift

```bash
krynix replay --verify \
  --trace traces/current.trace.jsonl \
  --baseline traces/golden.trace.jsonl
# Compares against a known-good baseline — flags new tools, changed models, structural changes
```

---

## Framework Support

Policies are framework-agnostic. Write once, apply to any agent:

| Framework | Integration | Status |
|-----------|-----------|--------|
| LangChain | Pre-built adapter (auto-capture) | `CURRENT` |
| OpenClaw | Pre-built adapter (auto-capture) | `CURRENT` |
| Any TypeScript agent | `@krynix/core` SDK | `CURRENT` |
| Any Python agent | `krynix-sdk-python` | `PARTIAL` |
| Any language | HTTP ingest (POST JSON) | `PLANNED` |

All adapters normalize events into 8 canonical types (`tool_call`, `tool_result`, `llm_request`, `llm_response`, `decision`, `observation`, `error`, `lifecycle`). Policies match these canonical types — zero framework awareness in the policy engine.

See [How Policies Work](docs/00_overview/how-policies-work.md) for details.

---

## Current Capabilities

| Status | Capability |
|--------|-----------|
| `CURRENT` | Trace integrity — SHA-256 hash chain with canonical JSON |
| `CURRENT` | Policy evaluation — 7 operators, first-match-wins, deterministic CI exit codes |
| `CURRENT` | Replay verification — chain integrity, event ordering, session bookends |
| `CURRENT` | Framework-agnostic policies — write once, apply to any agent |
| `PARTIAL` | Behavioral drift detection via baseline comparison |
| `PARTIAL` | Redaction — key-pattern based |
| `PLANNED` | Deterministic execution replay |
| `PLANNED` | Runtime blocking via sidecar proxy |
| `PLANNED` | Centralized governance (Control Plane) |

Current replay guarantee is **integrity + baseline diff**. Execution replay is planned.

---

## Packages

```text
packages/
  core/               @krynix/core               — trace types, hash chain, redaction
  policy/             @krynix/policy             — policy parsing, evaluation, inheritance
  replay/             @krynix/replay             — integrity verification, baseline diff
  adapter-langchain/  @krynix/adapter-langchain  — LangChain framework adapter
  adapter-openclaw/   @krynix/adapter-openclaw   — OpenClaw framework adapter
  cli/                @krynix/cli                — krynix command-line tool
```

---

## Documentation

| Topic | Link |
|-------|------|
| What Is Krynix? | [what-is-krynix.md](docs/00_overview/what-is-krynix.md) |
| How Policies Work | [how-policies-work.md](docs/00_overview/how-policies-work.md) |
| Security and Integrity | [security-and-integrity.md](docs/00_overview/security-and-integrity.md) |
| Product Model (OSS vs Paid) | [product_model.md](docs/00_overview/product_model.md) |
| Platform Architecture (canonical) | [platform_architecture_spec.md](docs/10_architecture/platform_architecture_spec.md) |
| Trace Specification | [trace_spec.md](docs/10_architecture/trace_spec.md) |
| Policy Specification | [policy_spec.md](docs/10_architecture/policy_spec.md) |
| Threat Model | [threat_model.md](docs/10_architecture/threat_model.md) |
| Glossary | [glossary_platform.md](docs/00_overview/glossary_platform.md) |

<details>
<summary>Planning and development</summary>

| Topic | Link |
|-------|------|
| Phase 1 backlog | [phase1_backlog.md](docs/20_development/phase1_backlog.md) |
| Component contracts | [component_contract_matrix.md](docs/10_architecture/component_contract_matrix.md) |
| Integration blueprints | [integration_blueprints.md](docs/10_architecture/integration_blueprints.md) |
| Consumer usage model | [consumer_usage_model.md](docs/00_overview/consumer_usage_model.md) |

</details>

---

## Non-Goals

- Not an agent framework or orchestrator
- Not an LLM host or provider
- Not a full runtime firewall in OSS — runtime enforcement varies by deployment mode (passive, sidecar, hybrid)
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
