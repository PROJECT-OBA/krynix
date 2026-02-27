# Glossary

Canonical terminology reference for the Krynix project. All project documentation uses these terms as defined here.

---

### Agent Session

A bounded execution context identified by a unique `session_id` (UUIDv4), containing exactly one Trace. Begins with a `lifecycle:session_start` event and ends with a `lifecycle:session_end` event.

### Determinism Envelope

The complete set of constraints that guarantee replay reproducibility: fixed PRNG seeds, frozen wall-clock time, stubbed network I/O, filesystem snapshotting, and pinned dependency versions. An execution is deterministic if and only if it runs within a valid Determinism Envelope.

### Golden Trace

A verified trace committed to version control and used as a regression baseline for deterministic replay testing. Stored in `test/golden/` as `.trace.jsonl` files. CI runs replay verification against all golden traces on every build.

### Hash Chain

A cryptographic linking mechanism where each TraceEvent includes the SHA-256 hash of the previous event's content, providing tamper-evidence for the entire trace. Modifying any single event invalidates all subsequent hashes.

### Policy

A declarative YAML rule set conforming to `krynix.dev/v1` that defines allowed, denied, and approval-gated agent behaviors. Evaluated against traces at CI time and optionally at runtime. Stored as `*.policy.yaml` files.

### Policy Gate

A CI checkpoint that evaluates a trace against one or more policies and blocks merge when violations at `error` or `critical` severity are detected. Produces a Policy Verdict mapped to a CI exit code.

### Policy Verdict

The outcome of evaluating a trace against a policy:
- `pass` -- zero violations with `ci_failure: true`
- `fail` -- one or more violations with `ci_failure: true`
- `require-approval` -- at least one `require-approval` action, zero fail-level violations

### Redaction

Replacing sensitive data (secrets, PII, credentials) in TraceEvent payloads with deterministic placeholder tokens before storage. Format: `[REDACTED:SHA256_PREFIX_8]` where the suffix is the first 8 hex characters of SHA-256 of the original value, enabling correlation without exposure.

### Replay

Deterministic re-execution of a recorded trace within a Determinism Envelope. Produces byte-identical outputs given identical inputs, the same envelope, and the same code version. The mechanism by which Krynix verifies agent behavior is reproducible.

### Severity Level

A four-tier classification for policy violations that determines CI gate behavior:
- `info` -- logged, CI passes (exit 0)
- `warning` -- logged, CI passes (exit 0)
- `error` -- CI fails (exit 1)
- `critical` -- CI fails (exit 2)

### Trace

An ordered, immutable sequence of TraceEvents representing one complete agent execution session. Identified by a `session_id` (UUIDv4) and stored as a `.trace.jsonl` file (JSON Lines format).

### Trace Adapter

A plugin module that converts external agent framework events (e.g., LangChain callbacks, OpenClaw hooks) into Krynix canonical TraceEvent format. The integration boundary between external frameworks and the Krynix pipeline.

### TraceEvent

A single structured record within a trace capturing one discrete action, observation, or decision. The atomic unit of the Krynix data model. Cryptographically linked to the previous event via the hash chain.

### Trust Boundary

A logical perimeter separating agent capabilities from protected resources, enforced by policies. Actions crossing a trust boundary are subject to policy evaluation and may require explicit approval.

### Trust Pipeline

The composition of Trace, Policy, and Replay into a verification loop enforced in CI: agents produce traces, policies evaluate traces, replay verifies traces are reproducible.

---

## See Also

- [Full Glossary Document](https://github.com/artificialvirus/krynix/blob/main/docs/00_overview/glossary.md) -- Authoritative source
- [[Trust Pipeline]] -- How the primitives compose
