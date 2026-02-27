<p align="center">
  <strong>Krynix</strong><br>
  <em>The runtime trust layer for autonomous AI agents</em>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="docs/10_architecture/architecture.md">Architecture</a> &middot;
  <a href="#cli-reference">CLI Reference</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a> &middot;
  <a href="docs/00_overview/product_model.md">Product Model</a>
</p>

<p align="center">
  <img alt="CI" src="https://img.shields.io/badge/build-passing-brightgreen">
  <img alt="Tests" src="https://img.shields.io/badge/tests-passing-brightgreen">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-blue">
  <img alt="TypeScript" src="https://img.shields.io/badge/typescript-strict-blue">
</p>

---

Krynix provides **trace standardization**, **deterministic replay**, **policy enforcement**, and **CI guardrails** for AI agents. It makes agent behavior auditable, constrainable, and reproducible.

## The Problem

Autonomous AI agents operate as black boxes. They make decisions, invoke tools, and produce outputs -- but there is no standardized way to:

- **Audit** what an agent did and why
- **Constrain** what an agent is allowed to do, enforced by infrastructure
- **Reproduce** an agent's execution to verify deterministic behavior

Without these capabilities, deploying agents in production is a trust problem.

## How Krynix Solves It

Krynix is infrastructure that sits alongside agent execution runtimes and provides three composable primitives:

```
Trace                     Policy                    Replay
Capture what the    --->  Evaluate what was   --->  Verify it's
agent did                 allowed                   reproducible
                               |
                               v
                          CI Gate
                          Block merge
                          on violations
```

| Primitive | What It Does | Artifact |
|-----------|-------------|----------|
| **Trace** | Structured, tamper-evident record of every agent action | `.trace.jsonl` |
| **Policy** | Declarative YAML rules constraining agent behavior | `.policy.yaml` |
| **Replay** | Deterministic re-execution proving reproducibility | Golden traces |

Each primitive provides value independently. Together they form a **trust pipeline** enforced in CI.

## Quick Start

> Krynix is in early development. Packages are not yet published to npm.

```bash
# Clone and build
git clone https://github.com/artificialvirus/krynix.git
cd krynix
pnpm install && pnpm build

# Evaluate a trace against policies
pnpm krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Verify deterministic replay
pnpm krynix replay --verify --golden-dir test/golden/

# Compute trace analytics
pnpm krynix stats --trace traces/session.trace.jsonl

# Export to OpenTelemetry format
pnpm krynix export --format otlp-json --trace traces/session.trace.jsonl

# Generate a compliance evidence bundle
pnpm krynix compliance export --trace traces/session.trace.jsonl --output ./bundle
```

## How It Works

### 1. Trace Capture

Agent frameworks emit events through **Trace Adapters**. Krynix converts them into canonical `TraceEvent` records, applies automatic secret redaction, links them with SHA-256 hash chains for tamper evidence, and writes them to `.trace.jsonl` files.

```
Agent Framework  -->  Trace Adapter  -->  Redaction  -->  Hash Chain  -->  .trace.jsonl
```

### 2. Policy Evaluation

Declarative YAML policies define what agents may and may not do. Policies are evaluated against traces post-hoc and enforced as CI merge gates.

```yaml
# Example: no-shell-exec.policy.yaml
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: no-shell-exec
  version: "1.0.0"
  description: "Deny shell execution in production agents"
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: deny-shell
      description: "Block shell_exec tool calls"
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: critical
      message: "Shell execution is not permitted"
```

**Verdicts:** `pass` | `fail` | `require-approval` -- mapped to CI exit codes.

### 3. Deterministic Replay

The replay engine re-executes recorded traces within a **Determinism Envelope** (fixed PRNG seeds, frozen time, stubbed I/O) and verifies byte-identical outputs. Golden traces committed to version control catch behavioral regressions in CI.

### 4. CI Integration

```yaml
# .github/workflows/ci.yml
- name: Policy Gate
  run: pnpm krynix evaluate --trace $TRACE --policy policies/
  # Exit code 0 = pass, 2 = violation, 3 = requires approval

- name: Replay Gate
  run: pnpm krynix replay --verify --golden-dir test/golden/
```

Both gates must pass for a merge to proceed.

## CLI Reference

```
krynix <command> [options]
```

### Core Commands

| Command | Description |
|---------|-------------|
| `evaluate` | Evaluate a trace against one or more policies |
| `replay` | Verify or regenerate trace files |
| `validate` | Validate policy file syntax |
| `stats` | Compute per-session analytics from a trace |
| `export` | Export a trace to external formats (OTLP) |

### Policy Commands

| Command | Description |
|---------|-------------|
| `policy test` | Test a policy against a sample trace |
| `policy diff` | Compare two policies and detect regressions |
| `policy pull` | Pull policies from the Control Plane registry |
| `policy push` | Publish a policy to the Control Plane registry |

### Compliance & Auth

| Command | Description |
|---------|-------------|
| `compliance export` | Generate a compliance evidence bundle |
| `push` | Upload artifacts to the Control Plane |
| `auth login` | Authenticate with email/password |
| `auth create-key` | Create an API key |
| `auth status` | Show authentication status |
| `auth logout` | Clear stored credentials |

Run `krynix <command> --help` for detailed usage.

## Package Structure

```
packages/
  core/               @krynix/core       Trace types, hash chain, redaction, stats, filtering
  policy/             @krynix/policy     Policy parser, evaluator, inheritance, diff engine
  replay/             @krynix/replay     Replay engine, determinism envelope, golden traces
  adapter-openclaw/   @krynix/adapter-openclaw   OpenClaw reference adapter
  cli/                @krynix/cli        CLI commands and binary entry point
```

**Dependency direction:** `core` <-- `policy` <-- `cli`, `core` <-- `replay` <-- `cli`, `core` <-- `adapters`. No circular dependencies.

## Architecture

Krynix is designed as a **two-layer product**:

| Layer | Scope | Status |
|-------|-------|--------|
| **OSS Engine** (this repo) | Trace, Policy, Replay, CLI, Adapters | Available (MIT) |
| **Control Plane** (planned) | Centralized governance, policy registry, compliance exports, RBAC | Design phase |

The OSS engine is fully standalone -- no network connectivity required. The Control Plane is purely additive.

See [architecture.md](docs/10_architecture/architecture.md) for the full system design and [product model](docs/00_overview/product_model.md) for the two-layer architecture.

## Key Design Properties

- **Hash-chained traces** -- SHA-256 linking provides tamper-evidence for every recorded event
- **CI-first enforcement** -- policies are enforced as merge gates, not runtime suggestions
- **Determinism envelope** -- fixed seeds, frozen time, stubbed network for reproducible replay
- **Automatic redaction** -- secrets are stripped from traces before storage
- **Pure functions** -- core modules are side-effect-free and fully testable
- **Zero runtime dependencies** -- the engine has no production dependencies beyond Node.js

## Development

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | >= 20 LTS |
| pnpm | >= 9 |
| Git | >= 2.40 |

### Setup

```bash
git clone https://github.com/artificialvirus/krynix.git
cd krynix
pnpm install
pnpm build
```

### Common Commands

```bash
pnpm test              # Run all tests
pnpm typecheck         # TypeScript strict mode check
pnpm lint              # ESLint
pnpm format:check      # Prettier check
pnpm test:golden       # Golden trace replay tests
pnpm test:integration  # Cross-package integration tests
```

See [dev_env.md](docs/20_development/dev_env.md) for the full development guide.

## Documentation

### Overview
- [Vision](docs/00_overview/vision.md) -- problem statement, core principles, target users
- [Product Model](docs/00_overview/product_model.md) -- OSS engine vs. Control Plane
- [Business Model](docs/00_overview/business_model.md) -- target users, monetization hypotheses
- [Non-Goals](docs/00_overview/non_goals.md) -- explicit boundaries and scope exclusions
- [Glossary](docs/00_overview/glossary.md) -- canonical terminology reference

### Architecture & Specifications
- [Architecture](docs/10_architecture/architecture.md) -- system overview, pipeline diagram, components
- [Trace Specification](docs/10_architecture/trace_spec.md) -- TraceEvent schema, hash chain, redaction
- [Policy Specification](docs/10_architecture/policy_spec.md) -- YAML format, rule matching, CI mapping
- [Determinism Specification](docs/10_architecture/determinism_spec.md) -- replay envelope, golden traces
- [Threat Model](docs/10_architecture/threat_model.md) -- attack vectors and mitigations
- [Control Plane Spec](docs/10_architecture/control_plane_spec.md) -- planned governance layer
- [Integration Contracts](docs/10_architecture/integration_contracts.md) -- adapter interface

### Development
- [Dev Environment](docs/20_development/dev_env.md) -- setup, project structure, running tests
- [Testing Strategy](docs/20_development/testing_strategy.md) -- unit, integration, golden trace tests
- [Git Workflow](docs/20_development/git_workflow.md) -- branch strategy, PR process
- [Commit Conventions](docs/20_development/commit_conventions.md) -- conventional commits format
- [CI/CD](docs/20_development/ci_cd.md) -- pipeline stages and gates
- [Security Practices](docs/20_development/security_practices.md) -- credential handling, redaction
- [Review Log](docs/20_development/review_log.md) -- sprint-by-sprint bug and fix tracking

## What Krynix Is NOT

- **Not an agent framework** -- does not run agents or provide execution runtimes
- **Not an LLM provider** -- does not host models or make inference calls
- **Not a monitoring UI** -- provides data export, not dashboards
- **Not a CI system** -- integrates with existing CI via exit codes
- **Not a secret manager** -- redacts secrets from traces, does not manage them

See [non-goals](docs/00_overview/non_goals.md) for the full boundary definition.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution guide. Key points:

- Branch from `main`, use [conventional commits](docs/20_development/commit_conventions.md)
- All changes require tests
- CI must pass: build, typecheck, lint, format, all tests
- For significant changes, submit an [RFC](docs/40_rfc/RFC_TEMPLATE.md) first

## Security

See [SECURITY.md](SECURITY.md) for vulnerability reporting. Do not open public issues for security vulnerabilities.

## License

[MIT](LICENSE)
