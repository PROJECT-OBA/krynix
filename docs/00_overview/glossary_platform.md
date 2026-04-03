# Platform Glossary

This glossary standardizes architecture vocabulary for the layered Krynix platform direction.

## Input Layer
The pre-execution trust layer that evaluates user/system context, intent risk, and prompt safety signals before runtime actions are attempted.

## Runtime Layer
The execution-adjacent trust layer that mediates tool usage, performs runtime checks, and issues enforceable guard decisions.

## Output Layer
The post-execution trust layer that classifies responses, applies output policies/redaction, and emits provenance for delivery decisions.

## Guard
A deterministic or model-assisted control component that evaluates signals and emits a structured decision (`allow`, `deny`, `require-approval`, `warn`).

## Decision
A structured outcome produced by a guard or policy engine, including action, severity, rationale, and evidence references.

## Provenance
A traceable evidence chain linking input context, runtime actions, and output mappings to immutable artifacts (trace IDs, event IDs, bundle entries).

## Drift
Behavioral difference between a current trace and an approved baseline trace for equivalent scenario intent.

## Replay Mode
The verification mode for replay workflows.
- `integrity` mode: validates trace structure/lifecycle/hash integrity. This is available via `krynix replay --verify`.
- `baseline-diff` mode: compares two trace event arrays for structural drift. Available as `compareTraces` library function (`PARTIAL`); not yet integrated into the CLI.
- `execution` mode: planned deterministic re-execution of agent logic (not current OSS behavior).

## Trust Spine
Krynix's role as the cross-layer evidence and policy backbone, not the entire runtime platform implementation.

## Advisory Intelligence
Model-assisted or heuristic control signals (intent assessment, LLM-as-judge, risk scoring) used to annotate, escalate, or require approval. Advisory intelligence must not be the sole basis for critical denial unless explicitly configured by a deployment profile.

## Deployment Mode
The operational topology determining how Krynix integrates with agent execution. Modes: Passive/Post-Run, Inline Sidecar/Gateway, Hybrid. These modes must not be conflated.

## Control Surface
The deployment-specific set of enforcement points (input intake, runtime mediation, output delivery) that may integrate with Krynix as the trust spine. Distinct from Krynix OSS Core.

## Request Ingress
The point at which a user request enters the system. Krynix does not universally own request ingress; ownership depends on deployment mode.

## Enforcement Hierarchy
The ordered precedence of control types: (1) Deterministic Hard Controls, (2) Policy-Based Controls, (3) Advisory Intelligence.

## Sidecar Control Point
A trusted interception boundary in sidecar/wrapper deployment mode where enforcement actions (normalize, guard, allow/deny/require-approval, scan, classify) occur and emit trace evidence.
