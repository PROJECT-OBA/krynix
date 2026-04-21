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

- **What did it do?** No structured, integrity-checked audit trail.
- **Did it follow the rules?** No automated policy enforcement.
- **Has it changed?** No way to detect behavioral drift between runs.

## The Solution

Krynix records every agent action into a structured, integrity-checked trace, evaluates it against your policies, and — when signed — gives you cryptographic tamper-evidence.

```bash
# 1. Your agent runs normally — adapter captures every event automatically
#    → session.trace.jsonl (SHA-256 hash-chained log)

# 2. Check policy compliance — exits non-zero on CI-failing violations.
#    Hash-chain structural integrity is verified automatically; pass
#    --public-key to also verify an Ed25519 signature (tamper-evident).
krynix evaluate --trace session.trace.jsonl --policy policies/

# 3. (Optional) Sign traces for tamper-evidence against intentional modification:
krynix keygen --out-private id.priv --out-public id.pub
krynix sign --trace session.trace.jsonl --private-key id.priv
krynix evaluate --trace session.trace.jsonl --policy policies/ --public-key id.pub
```

Integrity model:
- [CURRENT] **Structural integrity** (SHA-256 hash chain): detects naive tampering and corruption. Does **not** catch full-chain regeneration by an attacker with write access — use signing for that.
- [CURRENT] **Tamper-evidence** (Ed25519 signing, optional): catches regeneration, deletion, insertion, and reorder attacks when `krynix sign` is used and `evaluate --public-key` is enforced.

Exit codes: `0` pass · `1` CI-failing error or runtime error · `2` CI-failing critical · `3` needs approval. Wire into any CI pipeline.

---

## Quickstart

### Install

```bash
# Option 1: npm packages (recommended for TypeScript/Node.js projects)
npm install @krynix/core @krynix/policy
# Plus adapters for your framework:
npm install @krynix/adapter-langchain  # or @krynix/adapter-openclaw

# Option 2: CLI only (for CI pipelines)
npm install -g @krynix/cli
krynix --version

# Option 3: Standalone binary (no npm dependencies, requires Node.js >= 20)
curl -L https://github.com/PROJECT-OBA/krynix/releases/latest/download/krynix.cjs -o krynix.cjs
node krynix.cjs --version

# Option 4: Build from source
git clone https://github.com/PROJECT-OBA/krynix.git
cd krynix && pnpm install && pnpm build
```

See [Quickstart Guide](docs/00_overview/quickstart.md) for full integration instructions.

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
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
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
# Exit codes: 0 = pass (including non-CI-failing violations), 1 = CI-failing error or runtime error, 2 = CI-failing critical, 3 = needs approval
```

### Verify Integrity

```bash
krynix replay --verify --trace traces/session.trace.jsonl
# Walks the SHA-256 hash chain — detects any modification, deletion, or reordering
```

### Verify Golden Traces

```bash
krynix replay --verify --golden-dir test/golden/
# Verifies integrity of all golden traces in the directory — hash chain, lifecycle, structure
```

### Compare Traces for Behavioral Drift

```bash
krynix diff --baseline traces/v1.trace.jsonl --candidate traces/v2.trace.jsonl
# Detects behavioral changes between two traces — field-level diff at first divergence point
```

### Programmatic Usage (TypeScript)

```typescript
import { readFile } from "node:fs/promises";
import { createLangChainTracer } from "@krynix/adapter-langchain";
import { parsePolicy, evaluate } from "@krynix/policy";
import { readTrace } from "@krynix/core";

// 1. Attach to your LangChain agent — captures events automatically
const { handler, handle } = await createLangChainTracer({
  outputPath: "./session.trace.jsonl",
  agentId: "my-agent",
});
const result = await chain.invoke(input, { callbacks: [handler] });
await handle.shutdown();

// 2. Evaluate the trace against your policy
const events = await readTrace("./session.trace.jsonl");
const policy = parsePolicy(await readFile("policies/no-shell.policy.yaml", "utf-8"));
const evalResult = evaluate(events, policy);

console.log(evalResult.verdict);    // "pass" | "fail" | "require-approval"
console.log(evalResult.violations); // detailed violation info
```

---

## Framework Support

Policies are framework-agnostic. Write once, apply to any agent:

| Framework | Integration | Status |
|-----------|-----------|--------|
| LangChain | Pre-built adapter (auto-capture) | `CURRENT` |
| OpenClaw | Pre-built adapter (auto-capture) | `CURRENT` |
| Any TypeScript agent | `@krynix/core` SDK | `CURRENT` |
| Any Python agent | `krynix-sdk-python` | `PLANNED` |
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
| `CURRENT` | Behavioral drift comparison (`krynix diff` + `compareTraces` library) |
| `PARTIAL` | Redaction — key-pattern based |
| `PLANNED` | Deterministic execution replay |
| `PLANNED` | Runtime blocking via sidecar proxy |
| `PLANNED` | Centralized governance (Control Plane) |

Current replay guarantee is **integrity verification** via CLI. Behavioral drift comparison is available via `krynix diff` and the `compareTraces` library function. Execution replay is planned.

---

## Packages

```text
packages/
  core/               @krynix/core               — trace types, hash chain, redaction
  policy/             @krynix/policy             — policy parsing, evaluation, inheritance
  replay/             @krynix/replay             — integrity verification, drift comparison (library)
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
| Platform Architecture (canonical) | [platform_architecture_spec.md](docs/10_architecture/platform_architecture_spec.md) |
| Trace Specification | [trace_spec.md](docs/10_architecture/trace_spec.md) |
| Policy Specification | [policy_spec.md](docs/10_architecture/policy_spec.md) |
| Threat Model | [threat_model.md](docs/10_architecture/threat_model.md) |
| Glossary | [glossary_platform.md](docs/00_overview/glossary_platform.md) |


---

## Non-Goals

- Not an agent framework or orchestrator
- Not an LLM host or provider
- Not a full runtime firewall in OSS — runtime enforcement varies by deployment mode (passive, sidecar, hybrid)
- Does not universally own the request ingress point
- Does not treat inferred intent alone as a trust control

See [non_goals.md](docs/00_overview/non_goals.md) for full boundaries.

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

<!-- machine-readable consistency markers (checked by docs:check:readme)
REPLAY_CURRENT_MODE=integrity_verification
KRYNIX_ROLE=trust_spine_not_full_platform
KRYNIX_RUNTIME_ENFORCEMENT=external_runtime_controls_ci_postrun_in_oss
KRYNIX_INPUT_LAYER_MODE=deployment_specific_not_universal
KRYNIX_ENFORCEMENT_PRINCIPLE=block_on_actions_not_inferred_intent
-->
