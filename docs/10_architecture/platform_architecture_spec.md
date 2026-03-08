# Platform Architecture Specification

## Purpose
Define the canonical, decision-making architecture for the Krynix platform direction and remove ambiguity between current behavior and roadmap behavior.

## Where Used
- Product and architecture decisions.
- Repository documentation alignment.
- Agent instruction and rule alignment.
- CI documentation consistency checks.
- Consumer integration design for IDE-sidecar and framework-runtime deployments.

## Guarantees (Current)
- [CURRENT] Krynix OSS is the trust spine, not the full agent platform.  
  Evidence: `docs/10_architecture/architecture.md`, `packages/core/src/index.ts`
- [CURRENT] Krynix provides trace integrity (hash chain), policy evaluation, and CI/post-run verification workflows.  
  Evidence: `packages/core/src/hash-chain.ts`, `packages/cli/src/evaluate.ts`, `packages/replay/src/replay-runner.ts`
- [CURRENT] `krynix evaluate` enforces policy outcomes via exit codes in CI.  
  Evidence: `packages/cli/src/evaluate.ts`, `packages/cli/src/help.ts`
- [CURRENT] `krynix replay --verify` validates trace structure/integrity and hash determinism.  
  Evidence: `packages/replay/src/replay-runner.ts`, `packages/replay/src/golden-validator.ts`
- [CURRENT] Deterministic trace production exists through canonical JSON + hash chain + seeded session/event generation (when seed is provided).  
  Evidence: `packages/core/src/canonical-json.ts`, `packages/core/src/session.ts`, `packages/core/src/trace-writer.ts`
- [CURRENT] Closed-assistant integrations (Copilot/Claude/Codex style) follow an observable-only contract and do not claim hidden internal reasoning access.  
  Evidence: `docs/10_architecture/integration_blueprints.md`, `docs/10_architecture/determinism_spec.md`
- [PARTIAL] `krynix replay --verify --trace <current> --baseline <golden>` detects behavior drift by comparing trace events.
- [PARTIAL] Replay behavior assurance is comparison-based and does not execute live agent logic.
- [CURRENT] Redaction is field-name-pattern based and deterministic, but scoped to matched keys only.  
  Evidence: `packages/core/src/redaction.ts`, `packages/core/src/redaction.test.ts`
- [CURRENT] Runtime blocking is external to Krynix OSS today; Krynix is primarily CI/post-run enforcement.  
  Evidence: `docs/10_architecture/policy_spec.md`, `packages/cli/src/evaluate.ts`

## Planned Guarantees (Future)
- [PLANNED] Execution-mode replay that re-runs deterministic agent decision/tool paths via a replay executor interface.
- [PLANNED] Richer input/runtime/output layer guards integrated as first-class runtime controls.
- [PLANNED] Broader redaction defaults and configurable organization policy profiles.
- [PLANNED] Stronger provenance mapping from input intent signals through output delivery decisions.

## Non-Goals
- [CURRENT] Krynix does not replace agent frameworks or orchestration runtimes.  
  Evidence: `docs/10_architecture/integration_contracts.md`
- [CURRENT] Krynix does not host LLM inference.  
  Evidence: `docs/00_overview/non_goals.md`
- [CURRENT] Krynix does not guarantee perfect malicious-intent detection.  
  Evidence: `docs/00_overview/non_goals.md`
- [CURRENT] Krynix does not claim deterministic execution replay as implemented behavior today.  
  Evidence: `packages/replay/src/replay-runner.ts`, `packages/cli/src/replay.ts`

## Interfaces / Contracts

### Layer Model
- Input Layer: context ingestion, intent/risk assessment, prompt/system guards.
- Runtime Layer: tool mediation, scanning and anti-poisoning checks, policy decisions.
- Output Layer: response mapping, provenance, output guard checks.
- Krynix Role: cross-layer trust spine for traceability, policy evidence, replay/drift verification, and compliance packaging.

### Determinism Layering
Determinism remains a core design principle.

- `CURRENT`: deterministic trace artifact generation and integrity verification.
- `PARTIAL`: deterministic drift comparison against baseline traces.
- `PLANNED`: deterministic execution replay of live decision/tool paths.

Current replay guarantee is integrity + baseline diff.
Execution replay is planned and tracked.

### Closed-Assistant Observability Limits
For Copilot/Claude/Codex-style integrations, Krynix captures only observable signals from host integration points.

Krynix captures:
- prompt/context metadata,
- tool calls/results and timings,
- guard and policy decisions,
- output mapping/provenance signals when exposed,
- CI trust gate outcomes.

Krynix does not claim:
- hidden model reasoning streams,
- private provider-side internal chain data.

### Sidecar Control Point Behavior
Trusted interception boundaries for sidecar/wrapper model:

| Boundary | Trigger | Control Action | Trace Evidence |
|---|---|---|---|
| Prompt ingress | user sends prompt/task | classify/guard/check policy context | `observation` + `metadata.intent.*` |
| Tool pre-check | candidate command/tool call | allow/deny/require-approval | `decision` + `metadata.guard.*` |
| Tool post-check | command/tool completed | scan output, evaluate follow-up risk | `tool_result` + `metadata.runtime.*` |
| Output egress | assistant response ready | map delivery action, apply redaction/hold | `decision` + `metadata.output.*` |

### Runtime Profile Semantics (Truth Table)
| Condition | dev | staging | prod |
|---|---|---|---|
| Sidecar unavailable | Fail-open + warning evidence | Fail-closed for protected controls | Fail-closed for protected controls |
| Medium/high uncertain risk | Monitor + annotate | Require approval | Require approval |
| Deterministic critical violation | Monitor + annotate | Require approval or deny by rule | Deny |
| Approval timeout | Continue with warning by profile rule | Block | Block |

### Default Critical Deny Baseline (Profile: prod)
Categories:
1. Exfiltration-risk actions.
2. Destructive file/command actions.

Examples:
- transmit secret-like values to non-approved destination,
- write credential-like content to outbound channel,
- destructive workspace command without approval,
- unauthorized writes outside approved project boundary.

### Approval Path (Local + CI)
1. Runtime/local trust control emits `require-approval` with evidence refs.
2. Local user approval captures rationale (who/why/when).
3. Approval event is persisted in trace metadata.
4. CI evaluates final trace with policy + replay checks.
5. Merge gate enforces unresolved or denied approvals as blocking outcomes.

### Input -> Runtime -> Output Sequence (Krynix as Spine)
```mermaid
sequenceDiagram
  participant U as User/Trigger
  participant I as Input Layer Guards
  participant R as Runtime Layer Mediation
  participant O as Output Layer Mapping
  participant K as Krynix Spine

  U->>I: Prompt + context ingress
  I->>K: Intent + guard observations (metadata.intent.*, metadata.guard.*)
  I->>R: Guard decision (allow/deny/require-approval)
  R->>K: Tool pre/post events + runtime evidence (metadata.runtime.*)
  R->>O: Candidate response + execution outcomes
  O->>K: Output mapping + provenance (metadata.output.*)
  K-->>U: Trace artifacts + policy/replay/compliance evidence path
```

### Integration Insertion Points
| Insertion Point | Layer | Required Capture | Trace Mapping |
|---|---|---|---|
| Prompt ingress | Input | actor, workspace, repo SHA/branch, request source, intent signals | `observation` + metadata namespaces |
| Tool pre-check | Runtime | guard decision, rule id, approval state, arguments hash | `decision` + `tool_call` metadata |
| Tool post-check | Runtime | duration, output scan, policy impact, violations | `tool_result` + `observation` |
| Response egress | Output | classification, policy flags, provenance ref, delivery action | `decision` + `observation` |

### Mandatory Metadata Namespace Rules
- `metadata.intent.*`: intent model/judge signals and confidence.
- `metadata.guard.*`: guard rule ids, severities, decision rationale.
- `metadata.runtime.*`: runtime scan outcomes, tool mediation facts.
- `metadata.output.*`: response mapping, delivery decision, provenance references.

Rules:
- Namespace keys must be stable and lowercase.
- Reserved internal keys prefixed with `_krynix_` must not be overridden by adapters.
- Metadata values must be JSON-serializable.

### Contract Draft: `IntentAssessment`
Producer: Input layer classifiers and optional judge adapters.  
Consumer: Runtime policy engine and provenance builder.

Fields:
- `id: string`
- `risk_score: number` (0 to 1)
- `risk_labels: string[]`
- `confidence: number` (0 to 1)
- `signals: string[]`
- `timestamp: string` (ISO-8601)

Invariants:
- `risk_score` and `confidence` must be within [0, 1].
- `risk_labels` must be normalized lowercase tokens.

Insertion event type mapping to current trace schema:
- `observation` payload for captured signals.
- `decision` payload for routing outcome.
- metadata namespaces: `metadata.intent.*`, `metadata.guard.*`.

Example:
```json
{
  "id": "intent-8f2a",
  "risk_score": 0.82,
  "risk_labels": ["prompt_injection", "exfiltration_risk"],
  "confidence": 0.76,
  "signals": ["system_override_attempt", "credential_request"],
  "timestamp": "2026-03-02T10:21:00Z"
}
```

### Contract Draft: `GuardDecision`
Producer: Input/runtime/output guard components.  
Consumer: Runtime policy engine, trace bridge, output mapper.

Fields:
- `component: string`
- `action: "allow" | "deny" | "require-approval" | "warn"`
- `severity: "info" | "warning" | "error" | "critical"`
- `rule_id: string`
- `message: string`
- `evidence_refs: string[]`

Invariants:
- `rule_id` must be stable and traceable to a ruleset.
- `evidence_refs` must point to immutable trace or artifact identifiers.

Insertion event type mapping to current trace schema:
- `decision` payload for guard action.
- `observation` payload for supporting evidence snapshots.
- metadata namespaces: `metadata.guard.*`.

Example:
```json
{
  "component": "multi_scan_guard",
  "action": "require-approval",
  "severity": "error",
  "rule_id": "MSG-014",
  "message": "Potential poisoned instruction block detected",
  "evidence_refs": ["trace:session-1:seq-21", "artifact:file:/workspace/prompt.md"]
}
```

### Contract Draft: `ToolExecutionEnvelope`
Producer: Runtime tool mediation proxy.  
Consumer: Trace bridge, policy engine, observability pipeline.

Fields:
- `tool_name: string`
- `arguments_hash: string`
- `pre_checks: GuardDecision[]`
- `post_checks: GuardDecision[]`
- `duration_ms: number`

Invariants:
- `arguments_hash` must be deterministic for identical tool arguments.
- `duration_ms` must be non-negative.

Insertion event type mapping to current trace schema:
- `tool_call` payload for tool identity and arguments.
- `tool_result` payload for outputs and duration.
- metadata namespaces: `metadata.runtime.*`, `metadata.guard.*`.

Example:
```json
{
  "tool_name": "file_write",
  "arguments_hash": "2f7a2e...",
  "pre_checks": [
    {
      "component": "path_guard",
      "action": "allow",
      "severity": "info",
      "rule_id": "PG-001",
      "message": "Path within workspace",
      "evidence_refs": ["trace:session-1:seq-11"]
    }
  ],
  "post_checks": [],
  "duration_ms": 17
}
```

### Contract Draft: `OutputMapping`
Producer: Output layer mapper and provenance builder.  
Consumer: Delivery channel, audit/compliance export, analytics.

Fields:
- `classification: "safe" | "needs-review" | "blocked" | "incomplete"`
- `policy_flags: string[]`
- `provenance_ref: string`
- `delivery_action: "deliver" | "hold" | "redact" | "block"`

Invariants:
- `delivery_action` must be consistent with `classification`.
- `provenance_ref` must resolve to trace-linked evidence.

Insertion event type mapping to current trace schema:
- `decision` payload for delivery action.
- `observation` payload for provenance linkage.
- metadata namespaces: `metadata.output.*`.

Example:
```json
{
  "classification": "needs-review",
  "policy_flags": ["approval_required", "high_risk_intent"],
  "provenance_ref": "prov:session-1:out-4",
  "delivery_action": "hold"
}
```

### Consumer Deployment Topologies
| Topology | Placement | Typical Consumer | Tradeoff |
|---|---|---|---|
| Local sidecar | Developer machine / dev container | VSCode/Codex-style workflows | Lowest adoption friction, weaker centralized runtime control |
| In-process plugin | Agent runtime process | Framework teams (OpenClaw/custom) | Highest fidelity hook coverage, tighter coupling |
| Service-side collector | Remote control/processing service | Platform/security teams | Better governance centralization, higher integration effort |

## Operational Usage
- CI Gate (primary):
  - `krynix evaluate --trace <trace.jsonl> --policy <policy-or-dir>`
  - `krynix replay --verify --trace <current.trace.jsonl> --baseline <golden.trace.jsonl>`
- Integrity checks for golden sets:
  - `krynix replay --verify --golden-dir test/golden/`
- Compliance evidence packaging:
  - `krynix compliance export --trace <trace.jsonl> --output <bundle-dir>`

Consistency marker statements (used by CI docs checks):
- `REPLAY_CURRENT_MODE=integrity_plus_baseline_diff`
- `KRYNIX_ROLE=trust_spine_not_full_platform`
- `KRYNIX_RUNTIME_ENFORCEMENT=external_runtime_controls_ci_postrun_in_oss`

## Known Gaps And Roadmap
- [PARTIAL] Replay assurance: integrity + drift comparison exists; deterministic execution replay is not implemented.
- [PARTIAL] Redaction defaults do not cover every common secret key naming pattern.
- [PARTIAL] Runtime enforcement blueprint exists, but implementation remains mostly external/integration-driven.
- [PLANNED] Execution replay mode with deterministic executor contract.
- [PLANNED] Input/runtime/output enforcement profile rollout (`dev`, `staging`, `prod`).
