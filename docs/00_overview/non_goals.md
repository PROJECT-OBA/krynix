# Non-Goals

This document explicitly defines what Krynix does **not** do. These boundaries prevent scope creep and clarify where Krynix ends and other systems begin.

> **Scope:** These non-goals apply to the OSS engine (this repository). The planned [Krynix Control Plane](product_model.md) extends capabilities in some areas (e.g., centralized trace storage, org-level visibility) while preserving the same core boundaries (no agent execution, no LLM inference, no CI replacement).

See [vision](vision.md) for what Krynix does. See [architecture](../10_architecture/architecture.md) for system boundaries.

---

## 1. Krynix is NOT an Agent Framework

Krynix does not provide an agent execution runtime. It does not define how agents are structured, how they make decisions, or how they interact with the world. Agent frameworks (LangChain, OpenClaw, custom implementations) handle execution. Krynix handles trust.

**Boundary:** The Krynix OSS core receives events from agent frameworks via [Trace Adapters](../10_architecture/integration_contracts.md). It does not execute or orchestrate agents. In sidecar/gateway deployment modes, Krynix-integrated control surfaces may perform tool pre-checks and approval gating, but this is deployment-specific and not a universal OSS guarantee.

## 2. Krynix Does NOT Implement LLM Inference

Krynix does not host models, make API calls to LLM providers, or manage inference infrastructure. LLM requests and responses appear in Traces as `llm_request` and `llm_response` events, but Krynix treats them as opaque data for policy evaluation and replay.

**Boundary:** LLM provider interactions are the responsibility of the agent framework. Krynix records them for auditability. [CURRENT] Replay verifies trace integrity. [PARTIAL] Baseline drift comparison exists as a library function (`compareTraces`) but is not yet CLI-integrated. [PLANNED] Execution replay from recordings for determinism.

## 3. Krynix Does NOT Provide Real-Time Agent Monitoring UI

Krynix does not include a dashboard, web interface, or real-time visualization for observing running agents. Trace data can be exported to external observability platforms (see [observability](../20_development/observability.md)), but the Krynix OSS engine is a CLI and library, not a monitoring application. A future [Control Plane](product_model.md) may provide centralized visibility, but it will integrate with external observability platforms rather than replacing them.

**Boundary:** Krynix produces structured trace data. Visualization is the responsibility of external observability tools (Grafana, Datadog, etc.).

## 4. Krynix Does NOT Replace CI Systems

Krynix integrates with existing CI systems (GitHub Actions, etc.) via exit codes and structured output. It does not provide its own CI infrastructure, job scheduling, or pipeline orchestration.

**Boundary:** `krynix evaluate` and `krynix replay` are CLI commands that return exit codes. The CI system interprets these codes and makes merge/block decisions.

## 5. Krynix Does NOT Guarantee Real-Time Policy Enforcement

The primary enforcement model in OSS is CI-time, post-hoc evaluation. Traces are captured during agent execution, then evaluated against policies after the session completes. In sidecar or hybrid deployment modes, runtime pre-action gating may be provided by a deployment-specific control surface; this is [PARTIAL] and integration-driven, not a universal OSS guarantee.

**Boundary:** CI-time evaluation is the guaranteed OSS enforcement mechanism. Runtime enforcement scope varies by deployment mode (see [platform_architecture_spec.md](../10_architecture/platform_architecture_spec.md)).

## 6. Krynix Does NOT Handle Agent Orchestration

Krynix does not coordinate multiple agents, manage agent scheduling, handle agent-to-agent communication, or provide workflow orchestration. Each Agent Session is independent and identified by a single `session_id`.

**Boundary:** Multi-agent coordination is the responsibility of orchestration layers. Krynix traces individual agent sessions. Cross-session analysis is possible via shared `agent_id` values but is not a first-class feature.

## 7. Krynix Does NOT Provide Secret Management

Krynix provides Redaction — stripping secrets from Trace data before storage. It does not manage, store, rotate, or distribute secrets. Secret management remains the responsibility of dedicated tools (HashiCorp Vault, AWS Secrets Manager, etc.).

**Boundary:** The [Redaction engine](../10_architecture/trace_spec.md#redaction-rules) detects and removes secrets that appear in TraceEvent payloads. It does not prevent agents from accessing secrets in the first place.

## 8. Krynix Does NOT Universally Own Request Ingress

Krynix does not assume it receives every user request first. In passive/post-run mode, Krynix observes execution artifacts after the fact. In sidecar or hybrid modes, a deployment-specific control surface may receive the request before the agent, but this is not a universal OSS guarantee.

**Boundary:** Request ingress ownership depends on deployment mode. See [platform_architecture_spec.md](../10_architecture/platform_architecture_spec.md) for deployment mode definitions.

## 9. Krynix Does NOT Treat Inferred Intent As Primary Trust Control

Krynix does not use inferred intent alone as the sole basis for critical denial. Observable actions and delivery decisions are stronger enforcement points. Advisory intelligence (intent assessment, LLM-as-judge) may annotate or escalate, but critical blocking relies on deterministic or policy-based controls.

**Boundary:** Advisory signals inform; observable actions enforce. See the enforcement hierarchy in [platform_architecture_spec.md](../10_architecture/platform_architecture_spec.md).
