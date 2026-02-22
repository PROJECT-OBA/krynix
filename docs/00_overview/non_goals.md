# Non-Goals

This document explicitly defines what Krynix does **not** do. These boundaries prevent scope creep and clarify where Krynix ends and other systems begin.

See [vision](vision.md) for what Krynix does. See [architecture](../10_architecture/architecture.md) for system boundaries.

---

## 1. Krynix is NOT an Agent Framework

Krynix does not provide an agent execution runtime. It does not define how agents are structured, how they make decisions, or how they interact with the world. Agent frameworks (LangChain, OpenClaw, custom implementations) handle execution. Krynix handles trust.

**Boundary:** Krynix receives events from agent frameworks via [Trace Adapters](../10_architecture/integration_contracts.md). It does not control or influence agent execution.

## 2. Krynix Does NOT Implement LLM Inference

Krynix does not host models, make API calls to LLM providers, or manage inference infrastructure. LLM requests and responses appear in Traces as `llm_request` and `llm_response` events, but Krynix treats them as opaque data for policy evaluation and replay.

**Boundary:** LLM provider interactions are the responsibility of the agent framework. Krynix records them for auditability and replays from recordings for determinism.

## 3. Krynix Does NOT Provide Real-Time Agent Monitoring UI

Krynix does not include a dashboard, web interface, or real-time visualization for observing running agents. Trace data can be exported to external observability platforms (see [observability](../20_development/observability.md)), but Krynix itself is a CLI and library, not a monitoring application.

**Boundary:** Krynix produces structured trace data. Visualization is the responsibility of external observability tools (Grafana, Datadog, etc.).

## 4. Krynix Does NOT Replace CI Systems

Krynix integrates with existing CI systems (GitHub Actions, etc.) via exit codes and structured output. It does not provide its own CI infrastructure, job scheduling, or pipeline orchestration.

**Boundary:** `krynix evaluate` and `krynix replay` are CLI commands that return exit codes. The CI system interprets these codes and makes merge/block decisions.

## 5. Krynix Does NOT Guarantee Real-Time Policy Enforcement

The primary enforcement model is CI-time, post-hoc evaluation. Traces are captured during agent execution, then evaluated against policies after the session completes. Runtime pre-action gating (evaluating policy before a tool call executes) is a future consideration, not a v1 commitment.

**Boundary:** CI-time evaluation is the guaranteed enforcement mechanism. Runtime hooks are best-effort and depend on the agent framework's support for pre-action callbacks.

## 6. Krynix Does NOT Handle Agent Orchestration

Krynix does not coordinate multiple agents, manage agent scheduling, handle agent-to-agent communication, or provide workflow orchestration. Each Agent Session is independent and identified by a single `session_id`.

**Boundary:** Multi-agent coordination is the responsibility of orchestration layers. Krynix traces individual agent sessions. Cross-session analysis is possible via shared `agent_id` values but is not a first-class feature.

## 7. Krynix Does NOT Provide Secret Management

Krynix provides Redaction — stripping secrets from Trace data before storage. It does not manage, store, rotate, or distribute secrets. Secret management remains the responsibility of dedicated tools (HashiCorp Vault, AWS Secrets Manager, etc.).

**Boundary:** The [Redaction engine](../10_architecture/trace_spec.md#redaction-rules) detects and removes secrets that appear in TraceEvent payloads. It does not prevent agents from accessing secrets in the first place.
