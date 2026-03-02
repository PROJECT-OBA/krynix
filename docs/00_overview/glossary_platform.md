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
- `integrity` mode: validates trace structure/lifecycle/hash integrity.
- `baseline-diff` mode: compares current trace behavior against baseline trace behavior.
- `execution` mode: planned deterministic re-execution of agent logic (not current OSS behavior).

## Trust Spine
Krynix's role as the cross-layer evidence and policy backbone, not the entire runtime platform implementation.
