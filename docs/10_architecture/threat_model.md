# Threat Model

This document identifies and analyzes threats to systems protected by Krynix. Each threat includes attack vectors, affected components, mitigations, and residual risk assessment.

See [glossary](../00_overview/glossary.md) for term definitions. See [architecture](architecture.md) for the system overview.

## Scope

This threat model covers attacks against the Krynix trust layer itself and attacks by autonomous agents that Krynix is designed to detect or prevent. It does not cover threats to the underlying infrastructure (OS, network, hardware) — those are addressed by standard infrastructure security practices.

## Threat Summary

| ID | Threat | Severity | Primary Mitigation |
|---|---|---|---|
| T1 | Prompt Injection | High | Policy rules on tool_call patterns, trace audit |
| T2 | Tool Abuse | High | Fine-grained policy rules on tool arguments |
| T3 | Privilege Escalation | Critical | External policy evaluation, hash chain integrity |
| T4 | Secret Exfiltration | Critical | Redaction engine, network stubbing in replay |
| T5 | Policy Tampering | Critical | Version control, PR review, CI enforcement |
| T6 | Trace Tampering | High | Hash Chain, golden trace CI verification |

---

## T1: Prompt Injection

### Description

An attacker crafts input that manipulates the agent into executing unintended actions. The injected prompt may instruct the agent to bypass safety guidelines, execute dangerous tools, or exfiltrate data.

### Attack Vectors

- Malicious content in user-provided documents or data sources
- Injected instructions in tool outputs (e.g., a web page containing prompt injection text)
- Multi-step injection where early benign actions position the agent for later exploitation

### Affected Components

- Agent decision-making (recorded in `decision` TraceEvents)
- Tool invocation (recorded in `tool_call` TraceEvents)

### Mitigations

1. **Policy rules matching tool_call patterns** — Policies can deny specific tool calls regardless of the agent's reasoning. A `deny` rule on `shell_exec` prevents execution even if the agent is manipulated into requesting it. See [policy_spec](policy_spec.md).

2. **Trace audit of decision events** — All agent decisions are recorded in `decision` TraceEvents with the agent's stated `reasoning`. Post-hoc audit can identify suspicious reasoning patterns that suggest injection.

3. **Structural guardrails** — Policies evaluate actions, not intentions. Even if the agent's reasoning is compromised, policy rules on the action itself provide a hard boundary.

### Residual Risk

Prompt injection that causes the agent to take actions within its permitted action set. If an action is allowed by policy, a sufficiently sophisticated injection can trigger it. Mitigation: minimize the agent's permitted action set (principle of least privilege via policies).

---

## T2: Tool Abuse

### Description

An agent uses permitted tools in unintended ways to achieve harmful outcomes. The tool call itself is within policy bounds, but the specific arguments achieve an effect outside the intended use case.

### Attack Vectors

- Using `file_write` to overwrite configuration files or inject code
- Using `shell_exec` with carefully crafted arguments to exfiltrate data (e.g., `curl` to external endpoint)
- Using `file_read` to access sensitive files outside the workspace
- Chaining multiple benign tool calls to achieve a harmful compound effect

### Affected Components

- Tool invocation (`tool_call` TraceEvents)
- Tool results (`tool_result` TraceEvents)

### Mitigations

1. **Fine-grained policy rules on tool arguments** — Policies can match on nested payload fields using dot notation and ECMAScript RegExp. Example: deny `file_write` where `arguments.path` matches `^/etc/.*`. See [policy_spec operator reference](policy_spec.md#operator-reference).

2. **Deny-by-default for sensitive tools** — Policies can set `defaults.unmatched_action: deny` for policies scoping sensitive event types, requiring explicit allowlisting.

3. **Rate limiting** — Policies can flag sessions with excessive tool calls via `lifecycle:session_end` context inspection.

4. **Trace-based anomaly detection** — Trace data enables post-hoc detection of unusual tool usage patterns (e.g., many file reads followed by a network call).

### Residual Risk

Novel tool abuse patterns not covered by existing policy rules. Mitigation: regular policy review, and using Replay to test agent behavior against adversarial inputs.

---

## T3: Privilege Escalation

### Description

An agent attempts to bypass policy constraints or access resources outside its Trust Boundary. This includes attempts to modify policy files, influence policy evaluation, or exploit gaps in the trust model.

### Attack Vectors

- Agent attempts to modify its own policy files via `file_write`
- Agent attempts to write to the `test/golden/` directory to plant favorable golden traces
- Agent exploits a race condition between trace capture and policy evaluation
- Agent inserts events into the trace to make a denied action appear approved

### Affected Components

- Policy engine (policy_spec.md)
- Hash Chain (trace_spec.md)
- CI Gate (architecture.md)

### Mitigations

1. **External policy evaluation** — Policy evaluation is a separate process from agent execution. The agent has no API to modify, query, or influence policy evaluation. Policies are loaded from version-controlled files that the agent cannot modify in CI.

2. **Hash Chain integrity** — The Hash Chain in the Trace prevents event insertion, deletion, or reordering. Any modification breaks the chain and is detected during verification. See [trace_spec hash chain](trace_spec.md#hash-chain).

3. **Policy protection via file path rules** — A policy can deny `file_write` to `policies/` and `test/golden/` directories:
   ```yaml
   - id: protect-policies
     match:
       event_type: tool_call
       payload:
         - field: tool_name
           operator: eq
           value: file_write
         - field: arguments.path
           operator: matches
           value: "^(policies/|test/golden/).*"
     action: deny
     severity: critical
     message: "Writing to policy or golden trace directories is not permitted"
   ```

4. **CI-time enforcement** — Policy evaluation and replay verification happen in CI after the agent session completes. The agent cannot influence the CI environment. Note: CI enforcement blocks merge of the resulting changes, but does **not** prevent the actions from having occurred during the session. Real-time pre-action gating is a future capability (see [policy_spec future work](policy_spec.md#future-work)).

### Residual Risk

Privilege escalation through vulnerabilities in the Krynix evaluation engine itself. Mitigation: treat the evaluation engine as a security-critical component with thorough testing and review requirements.

---

## T4: Secret Exfiltration

### Description

Secrets (API keys, credentials, tokens) are leaked through agent tool outputs, LLM context, or trace storage.

### Attack Vectors

- Agent accesses environment variables or configuration files containing secrets
- Secrets appear in LLM prompts or responses and are recorded in trace events
- Agent uses a tool to transmit secrets to an external endpoint
- Secrets persist in stored traces and are later accessed by unauthorized parties

### Affected Components

- Trace storage (trace_spec.md)
- Redaction engine (trace_spec.md#redaction-rules)
- Tool invocations (tool_call/tool_result events)

### Mitigations

1. **Automatic redaction** — The Redaction engine scans all TraceEvent payloads for fields matching sensitive patterns (`*_key`, `*_secret`, `*_token`, `*_password`, `*_credential`) and replaces values with `[REDACTED:SHA256_PREFIX_8]`. See [trace_spec redaction rules](trace_spec.md#redaction-rules).

2. **Redaction before hashing** — Redaction occurs before `event_hash` computation, ensuring that the unredacted value is never part of the committed trace data.

3. **Network stubbing in replay** — During deterministic replay, all network I/O is stubbed. This prevents replay from repeating any exfiltration, but does **not** prevent the original live execution from making network calls. Live exfiltration must be mitigated at the runtime level (sandboxing, firewall rules) or caught post-hoc via trace audit. See [determinism_spec](determinism_spec.md#3-network-stubbing).

4. **Policy rules on network-capable tools** — Policies can deny or require-approval for tools that make network requests (e.g., `http_request`, `shell_exec` with `curl`/`wget` arguments).

### Residual Risk

- Secrets that don't match automatic redaction patterns (non-standard field names). Mitigation: custom redaction rules (future work).
- Secrets leaked through side channels (e.g., timing, error messages). Mitigation: standard secure coding practices in agent frameworks.
- Secrets in LLM context that are not in payload fields (embedded in `content` strings). Mitigation: content scanning policies with the `matches` operator (ECMAScript RegExp).

---

## T5: Policy Tampering

### Description

An attacker modifies policy files to weaken enforcement, allowing previously denied actions to pass the Policy Gate.

### Attack Vectors

- Direct modification of `.policy.yaml` files in the repository
- Subtle changes to rule ordering that alter first-match-wins behavior
- Weakening `defaults.unmatched_action` from `deny` to `allow`
- Changing severity from `critical`/`error` to `warning`/`info` to avoid CI failure
- Adding overly broad `allow` rules before existing `deny` rules

### Affected Components

- Policy files (`policies/*.policy.yaml`)
- CI Gate

### Mitigations

1. **Version control** — All policy files are committed to Git. Every change is tracked with full history and attribution.

2. **PR review requirement** — Policy changes require PR review. Reviewers should specifically check for severity downgrades, rule reordering, and scope changes. See [PR review process](../20_development/pr_review.md).

3. **Policy diff in CI (recommended)** — CI can be configured to output a structured diff of policy changes in the PR, making it easier for reviewers to identify weakening changes. This is a recommended CI configuration enhancement, not a built-in Krynix feature.

4. **CODEOWNERS** — Policy files can be protected with GitHub CODEOWNERS, requiring approval from security team members for any modification.

### Residual Risk

A compromised reviewer approving a malicious policy change. Mitigation: require multiple reviewers for policy changes, and periodic policy audits.

---

## T6: Trace Tampering

### Description

An attacker modifies trace files to hide malicious activity, make harmful actions appear benign, or inject fabricated events.

### Attack Vectors

- Modifying a TraceEvent's payload to change the recorded action
- Deleting events that record malicious actions
- Inserting fabricated events to create a false history
- Modifying golden traces to allow malicious behavior to pass replay verification

### Affected Components

- Trace files (`.trace.jsonl`)
- Hash Chain (trace_spec.md)
- Golden Traces (`test/golden/`)

### Mitigations

1. **Hash Chain** — Every TraceEvent includes `prev_hash` (the hash of the previous event) and `event_hash` (the hash of the current event). Any modification to any event invalidates all subsequent hashes. Verification recomputes all hashes and checks the chain. See [trace_spec hash chain](trace_spec.md#hash-chain).

2. **Golden Trace CI verification** — Golden Traces are committed to version control and verified on every CI build. Modifying a golden trace changes the file in Git, which is reviewable in the PR. See [determinism_spec golden trace testing](determinism_spec.md#golden-trace-testing).

3. **Trace validation on load** — Before policy evaluation or replay, the trace is validated: hash chain integrity, required fields, contiguous sequence numbers, proper lifecycle events. Invalid traces are rejected entirely.

4. **Future: cryptographic signing** — Hash chain signing with Ed25519 keys (planned for schema version `2.0.0`) will provide non-repudiation — proving not just that the trace is unmodified, but that it was produced by a specific trusted agent. See [trace_spec future work](trace_spec.md#future-work).

### Residual Risk

Tampering at the point of trace creation (before the first hash is computed). If the trace capture mechanism itself is compromised, the hash chain protects fabricated data. Mitigation: trace capture runs in a trusted environment, separate from the agent runtime.

---

## Threat Interaction Matrix

Threats can compound. An attacker may chain multiple threats for greater impact.

| Chain | Description | Combined Mitigation |
|---|---|---|
| T1 → T2 | Prompt injection triggers tool abuse | Policy rules block the tool call regardless of agent reasoning |
| T1 → T4 | Prompt injection leads to secret exfiltration | Redaction strips secrets from traces; network policies block exfil tools |
| T5 → T3 | Policy tampering enables privilege escalation | PR review + CODEOWNERS on policy files |
| T6 → T5 | Trace tampering hides policy tampering evidence | Hash chain verification + version control audit trail |

## Review Cadence

This threat model should be reviewed:
- When new event types are added to the TraceEvent schema
- When new tool types are supported
- When the policy evaluation model changes
- At minimum, quarterly
