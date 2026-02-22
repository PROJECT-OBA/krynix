# Krynix Glossary

This is the canonical terminology reference for the Krynix project. All project documentation uses these terms exactly as defined here. When a term listed below appears in any Krynix document, it carries the meaning specified in this glossary.

To propose a new term or amend an existing definition, submit an RFC using the [RFC template](../40_rfc/RFC_TEMPLATE.md).

---

## Terms

### Agent Session

A bounded execution context identified by a unique `session_id` (UUIDv4), containing exactly one Trace. An Agent Session begins with a `lifecycle:session_start` event and ends with a `lifecycle:session_end` event.

Defined in: [trace_spec.md](../10_architecture/trace_spec.md)

### Determinism Envelope

The complete set of constraints that guarantee Replay reproducibility. The envelope comprises: fixed PRNG seeds, frozen wall-clock time, stubbed network I/O, filesystem snapshotting, and pinned dependency versions. An execution is deterministic if and only if it runs within a valid Determinism Envelope.

Defined in: [determinism_spec.md](../10_architecture/determinism_spec.md)

### Golden Trace

A verified Trace committed to version control and used as a regression baseline for deterministic Replay testing. Golden Traces are stored in `test/golden/` as `.trace.jsonl` files. CI runs replay verification against all Golden Traces on every build.

Defined in: [determinism_spec.md](../10_architecture/determinism_spec.md)

### Hash Chain

A cryptographic linking mechanism where each TraceEvent includes the SHA-256 hash of the previous event's content, providing tamper-evidence for the entire Trace. Any modification to a single event invalidates all subsequent hashes.

Defined in: [trace_spec.md](../10_architecture/trace_spec.md)

### Policy

A declarative YAML rule set conforming to `krynix.dev/v1` that defines allowed, denied, and approval-gated agent behaviors. Policies are evaluated against TraceEvents at CI time and optionally at runtime. Stored as `*.policy.yaml` files.

Defined in: [policy_spec.md](../10_architecture/policy_spec.md)

### Policy Gate

A CI checkpoint that evaluates a Trace against one or more Policies and blocks merge when violations at `error` or `critical` severity are detected. The Policy Gate produces a Policy Verdict and maps it to a CI exit code.

Defined in: [policy_spec.md](../10_architecture/policy_spec.md)

### Policy Verdict

The outcome of evaluating a complete Trace against a Policy. One of three values:
- `pass` — zero violations with `ci_failure: true`
- `fail` — one or more violations with `ci_failure: true`
- `require-approval` — at least one `require-approval` action triggered, zero fail-level violations

Defined in: [policy_spec.md](../10_architecture/policy_spec.md)

### Redaction

The process of replacing sensitive data (secrets, PII, credentials) in TraceEvent payloads with deterministic placeholder tokens before storage or transmission. Redacted values use the format `[REDACTED:SHA256_PREFIX_8]` where the suffix is the first 8 hex characters of SHA-256 of the original value, enabling correlation without exposure.

Defined in: [trace_spec.md](../10_architecture/trace_spec.md)

### Replay

Deterministic re-execution of a recorded Trace within a Determinism Envelope. A valid Replay produces byte-identical outputs given identical inputs, the same Determinism Envelope, and the same code version. Replay is the mechanism by which Krynix verifies that agent behavior is reproducible.

Defined in: [determinism_spec.md](../10_architecture/determinism_spec.md)

### Severity Level

A four-tier classification assigned to policy violations that determines CI gate behavior and notification routing:
- `info` — logged, CI passes (exit code 0)
- `warning` — logged, CI passes (exit code 0)
- `error` — CI fails (exit code 1)
- `critical` — CI fails (exit code 2)

Defined in: [policy_spec.md](../10_architecture/policy_spec.md)

### Trace

An ordered, immutable sequence of TraceEvents representing one complete agent execution session. Each Trace is identified by a `session_id` (UUIDv4) and stored as a `.trace.jsonl` file (one TraceEvent per line, JSON Lines format).

Defined in: [trace_spec.md](../10_architecture/trace_spec.md)

### Trace Adapter

A plugin module that converts external agent framework events (e.g., LangChain callbacks, OpenClaw hooks) into Krynix canonical TraceEvent format. Adapters implement a defined interface and are the integration boundary between external frameworks and the Krynix pipeline.

Defined in: [integration_contracts.md](../10_architecture/integration_contracts.md)

### TraceEvent

A single structured record within a Trace capturing one discrete action, observation, or decision. The atomic unit of the Krynix data model. Each TraceEvent is cryptographically linked to the previous event via a Hash Chain.

Defined in: [trace_spec.md](../10_architecture/trace_spec.md)

### Trust Boundary

A logical perimeter separating agent capabilities from protected resources, enforced by Policies at CI time and runtime. Actions crossing a Trust Boundary are subject to policy evaluation and may require explicit approval.

Defined in: [architecture.md](../10_architecture/architecture.md)
