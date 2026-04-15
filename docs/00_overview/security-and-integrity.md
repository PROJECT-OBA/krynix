# Security and Integrity

## What the Hash Chain Guarantees

Every event in a Krynix trace is cryptographically chained to the previous one using SHA-256.

**How it works:**

1. Each event is serialized into **canonical JSON** — a deterministic format where keys are sorted and whitespace is normalized. The same event always produces the same byte sequence.
2. The `prev_hash` field is set to the previous event's hash (or `""` for the first event), and `event_hash` is set to `""`.
3. The SHA-256 hash is computed over the canonical JSON of the **entire event object** (including `prev_hash`, with `event_hash` as `""`).
4. The result is stored as `event_hash` on the event itself.

```
Event 1: event.prev_hash = "",  event.event_hash = ""  → hash = SHA-256(canonical(event1))
Event 2: event.prev_hash = event1.hash, event.event_hash = "" → hash = SHA-256(canonical(event2))
Event 3: event.prev_hash = event2.hash, event.event_hash = "" → hash = SHA-256(canonical(event3))
...
```

**What the chain alone detects (structural integrity):**

- **Naive modification** — Change any field in any event and its hash no longer matches, unless the attacker also rebuilds the chain.
- **Naive deletion / insertion / reordering** — Any change that leaves the original hashes in place is caught.
- **Accidental corruption** — Bit flips, truncation, and disk errors all break the chain.

**What the chain alone does NOT detect (this is the important caveat):**

An attacker with write access to a trace file can mutate an event's payload and re-run `computeHashChain` over the result. The chain is self-consistent again; `validateHashChain` returns `valid: true`. There is no root of trust in the chain alone — it proves internal consistency, not authenticity.

**What closes the gap: Ed25519 signing.** `krynix sign --trace <path> --private-key <path>` writes a cryptographic signature over the chain tip. `krynix evaluate --public-key <path>` verifies it. Because the attacker does not have the private key, they cannot produce a signature that verifies under the trusted public key — no matter how they rebuild the chain. This defeats regeneration, deletion + rebuild, insertion + rebuild, reorder + rebuild, and truncation.

**Analogy:** The hash chain is numbered pages in a ledger — you can see if any page was torn out or substituted naively. The Ed25519 signature is the auditor's wax seal on the last page — if the ledger was rewritten from scratch, the seal still proves nothing in it is authentic.

**Verification command:**

```bash
krynix replay --verify --trace session.trace.jsonl
```

This walks the entire chain and reports exactly where it breaks, if anywhere.

## What Policy Evaluation Guarantees

Policy evaluation is **deterministic**: the same trace + the same policy = the same verdict, every time, on any machine.

**Properties:**

- **Deterministic matching** — for in-scope events, rules are evaluated in declared order with no sampling or probabilistic matching. The outcome is fully determined by the trace and policy.
- **First-match-wins** — the first matching rule determines the action for an in-scope event; later matching rules do not fire for that event.
- **Seven operators** — `eq`, `neq`, `in`, `not_in`, `matches` (regex), `contains`, `exists`. These cover exact matching, set membership, pattern matching, and field presence.
- **CI exit codes** — evaluation results map to deterministic exit codes:

| Exit Code | Meaning | CI Effect |
|-----------|---------|-----------|
| `0` | No CI-failing violations (non-CI-failing violations still exit 0) | Pipeline continues |
| `1` | CI-failing `error` severity violation, or runtime error | Pipeline fails |
| `2` | CI-failing `critical` severity violation | Pipeline fails |
| `3` | Requires approval (no CI-failing violations) | Pipeline pauses (if CI supports it) |

**What this means in practice:** Add `krynix evaluate` to your CI pipeline. If an agent triggers a CI-failing violation (`error` or `critical` severity), the pipeline fails with a non-zero exit code. No human has to review every trace manually — violations are caught automatically.

## What Replay Guarantees

Replay verification provides two levels of assurance:

### Integrity Verification (`CURRENT`)

```bash
krynix replay --verify --trace session.trace.jsonl
```

Checks:
- Hash chain is structurally unbroken (see caveat above — for tamper-evidence against regeneration, also verify the Ed25519 signature via `krynix evaluate --public-key`)
- Events are ordered by `sequence_num`
- Session is properly bookended (`session_start` and `session_end` lifecycle events)
- Schema version is consistent

### Baseline Drift Detection (`PARTIAL`)

The `@krynix/replay` package exports a `compareTraces` function that performs structural comparison between two trace event arrays — detecting new or missing events, changed event types, and payload differences. This function is unit-tested and available as a library API.

However, `compareTraces` is **not yet integrated into the CLI**. The `--golden-dir` flag on `krynix replay` verifies the integrity of all `*.trace.jsonl` files in a directory (hash chain, lifecycle, structure) — it does not compare them against a `--trace` input.

```bash
# Verify integrity of golden traces in a directory
krynix replay --verify --golden-dir test/golden/
```

CLI integration for drift comparison is planned.

### Execution Replay (`PLANNED`)

`PLANNED`: Re-run the exact same inputs through the agent and verify the outputs match. This requires deterministic agent execution, which is not yet implemented.

## Current Limitations

| Limitation | Why It Exists | Mitigation | Roadmap |
|-----------|--------------|-----------|---------|
| **Post-run only** — no real-time blocking in OSS | OSS is a library, not a runtime | CI exit codes fail pipelines on violations | `PLANNED`: Sidecar proxy mode enables real-time blocking before tool execution |
| **Traces are plaintext JSONL** | Simplicity, portability, debuggability | Use filesystem permissions; redact sensitive fields before storage | `PLANNED`: Optional AES-256 encryption at rest |
| **Completeness depends on adapter** | Adapter might miss events the framework doesn't expose | HTTP ingest captures at the network level (harder to miss) | `PLANNED`: Proxy mode guarantees 100% capture |
| **No cost tracking** | Not in v1.0 schema | Policies can match on token counts (`usage.prompt_tokens`) | Optional `estimated_cost` field added (`schema_version` remains `"1.0.0"`) |
| **Drift detection is structural** | Semantic comparison requires execution replay | Structural diff catches most obvious drift | `PLANNED`: Execution replay for full behavioral comparison |

## Data Protection

### Where Traces Are Stored

Traces are stored **locally by default** as `.trace.jsonl` files. No data leaves your machine unless you explicitly send it somewhere. There is no phone-home, telemetry, or third-party data sharing.

### Redaction

Krynix supports key-pattern-based redaction to strip sensitive fields from traces before storage:

- Common patterns: API keys, tokens, passwords, secrets
- Redaction happens **before** hash computation — the hash chain covers the redacted form, not the original plaintext
- Redacted fields are replaced with a marker, not deleted, so the trace structure is preserved

### Network Behavior

- **OSS (this repo):** Core trust checks (`evaluate`, `replay`, `export`) run offline by default — no phone-home, telemetry, or third-party data sharing. Optional Control Plane integration commands (`auth`, `push`, `policy pull/push`, `golden *`) perform network calls when explicitly used.
- **HTTP ingest (`PLANNED`):** TLS in transit. Optional encryption at rest. Self-hosted by design — you control where traces are stored.
- **Control Plane (`PLANNED`):** Centralized storage with access controls, encryption, and compliance features.

## Threat Model Summary

Krynix addresses six primary threats. Full details in [threat_model.md](../10_architecture/threat_model.md).

| Threat | Severity | How Krynix Handles It |
|--------|----------|----------------------|
| **Prompt injection** | High | Effects-based: policies catch the dangerous *action* (e.g., `shell_exec`), not the injected text. The policy doesn't care *why* the agent called the tool — it blocks the call regardless. |
| **Tool abuse** | High | Fine-grained policy rules on tool arguments. Deny `file_write` where `arguments.path` matches `/etc/.*`. |
| **Privilege escalation** | Critical | External policy evaluation — the agent cannot modify its own policies. Hash chain proves the trace wasn't altered to hide escalation. |
| **Secret exfiltration** | Critical | Redaction engine strips sensitive fields. Policies can deny network-capable tool calls. |
| **Policy tampering** | Critical | Policies are version-controlled files reviewed via PR. CI enforces the committed version. |
| **Trace tampering** | High | SHA-256 hash chain catches naive tampering and corruption. Ed25519 signing (`krynix sign` + `evaluate --public-key`) catches regeneration and other rebuild attacks — enforce `--public-key` in CI for tamper-evident guarantees. Golden trace integrity verification runs in CI (`--golden-dir`). |

### Effects-Based Security Model

Krynix takes an **effects-based approach** to security, not an intent-based approach:

```
Intent-based:   Scan input → detect malicious intent → block
Effects-based:  Record what agent DOES → block dangerous ACTIONS via policy
```

This is by design. If a prompt injection tricks the agent into calling `shell_exec("rm -rf /")`:
- Krynix does **not** detect the injection in the prompt
- Krynix **does** catch the `tool_call` to `shell_exec` via policy and flags it (post-run) or blocks it (`PLANNED`: sidecar mode)
- The policy fires regardless of *why* the agent made the call

This is analogous to how a WAF blocks dangerous HTTP requests regardless of the attacker's motivation. You don't need to understand intent to prevent the harmful action.

### Input-Layer Intelligence (`PLANNED`)

For teams that want intent-based detection in addition to effects-based enforcement, the `PLANNED` Control Plane includes:

- **IntentClassifier** — risk scoring and intent labeling before the agent acts
- **MultiScanGuard** — content scanning for data poisoning and malicious payloads in tool outputs

These are advisory signals that feed into policy evaluation. Per the enforcement hierarchy: deterministic hard controls > policy-based controls > advisory intelligence. Advisory signals alone are never the sole basis for critical denial.

## Learn More

- [Threat Model](../10_architecture/threat_model.md) — full threat analysis with attack vectors and mitigations
- [What Is Krynix?](what-is-krynix.md) — product overview
- [How Policies Work](how-policies-work.md) — policy universality and integration paths
