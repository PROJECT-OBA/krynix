# Control Plane Specification

**Status:** Design Phase — Not Yet Implemented

**Deployment Model:** v1 is a modular monolith. The components described in this document are logical modules with well-defined boundaries — not independent microservices. They share a single deployment unit, a single database, and a single process in v1. Module boundaries exist to enable future decomposition if scaling demands require it.

This document defines the architecture of the Krynix Control Plane — a centralized governance layer that operates around the OSS engine's Trace, Policy, and Replay artifacts. The Control Plane provides organizational visibility, compliance tooling, and policy distribution for teams deploying agents at scale.

See [product model](../00_overview/product_model.md) for the two-layer architecture. See [architecture](architecture.md) for the OSS engine pipeline. See [business model](../00_overview/business_model.md) for the target customer.

---

## Invariants

The Control Plane:

- Does **NOT** execute agents
- Does **NOT** perform runtime blocking (no inline request interception)
- Does **NOT** host LLM inference
- Does **NOT** replace CI (CI gates remain the primary enforcement mechanism)
- Operates **around** Trace/Policy/Replay artifacts, never inside agent execution

---

## Control Plane Boundaries

The Control Plane is an **artifact aggregation and governance layer**. It receives artifacts that the OSS engine has already produced — traces, evaluation results, replay reports — and provides centralized storage, search, and compliance packaging around them.

**What the Control Plane does:**

- Stores and indexes traces that have been captured and hash-chain-verified locally
- Distributes policies authored and version-controlled by security teams
- Aggregates evaluation results for organizational visibility
- Packages evidence bundles for audit and compliance handoff
- Enforces role-based access to stored artifacts

**What the Control Plane does NOT do:**

- Capture traces (the OSS engine does this locally)
- Evaluate policies at runtime (the OSS engine does this in CI or locally)
- Execute replay (the OSS engine performs integrity and drift verification locally; hosted replay execution is deferred to v2)
- Perform any inline agent interception or blocking
- Store pre-redaction data (redaction happens at the source, before upload)
- Require network connectivity for any OSS engine operation

**Offline-first guarantee:** The OSS engine is fully functional without the Control Plane. All trace capture, policy evaluation, replay, and CLI operations work offline. The Control Plane is a network-optional layer that adds centralized governance when connectivity is available. If `krynix push` fails due to network issues, the local workflow is unaffected.

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                   DEVELOPER WORKSTATION / CI                        │
│                                                                     │
│  ┌────────────────┐   ┌────────────────────────┐   ┌────────────┐ │
│  │ Agent Runtime   │──▶│ Krynix OSS Engine      │──▶│.trace.jsonl│ │
│  │ (LangChain,    │   │  - Trace Capture        │   │.policy.yaml│ │
│  │  OpenClaw, etc)│   │  - Policy Evaluation    │   │ Eval Result│ │
│  └────────────────┘   │  - Replay Engine        │   └──────┬─────┘ │
│                        │  - CLI                   │          │       │
│                        └────────────────────────┘          │       │
│                                                             │       │
│  ┌──────────────────────────────────────────────────────────┤       │
│  │                   Krynix CLI                              │       │
│  │                                                           │       │
│  │  krynix push ─── upload trace ────────────────────────────┼──┐   │
│  │  krynix policy pull ─── fetch policies ───────────────────┼──┤   │
│  │  krynix replay --remote ─── request hosted replay (v2) ───┼──┤   │
│  │  krynix compliance export ─── generate bundle ────────────┼──┤   │
│  └──────────────────────────────────────────────────────────┘  │   │
│                                                                 │   │
└─────────────────────────────────────────────────────────────────┼───┘
                                                                  │
                            HTTPS / TLS 1.2+                      │
                                                                  │
┌─────────────────────────────────────────────────────────────────┼───┐
│         KRYNIX CONTROL PLANE (Cloud / Self-Hosted)              │   │
│         v1: Single deployment unit (modular monolith)           │   │
│                                                                 ▼   │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                      API Gateway                               │ │
│  │       Authentication · Rate Limiting · Request Routing         │ │
│  └────┬────────┬────────┬────────┬────────┬────────┬─────────────┘ │
│       │        │        │        │        │        │               │
│       ▼        ▼        ▼        ▼        ▼        ▼               │
│  ┌────────┐┌────────┐┌────────┐┌───────┐┌────────┐┌────────────┐  │
│  │ Trace  ││ Policy ││ Replay ││Golden ││Compli- ││ Dashboard  │  │
│  │ Ingest ││Registry││ Report ││ Trace ││ ance   ││ API        │  │
│  │        ││        ││ Ingest ││Regis- ││ Engine ││            │  │
│  │        ││        ││        ││ try   ││        ││            │  │
│  └───┬────┘└───┬────┘└───┬────┘└──┬────┘└───┬────┘└──────┬─────┘  │
│      │         │         │        │         │            │         │
│      ▼         ▼         ▼        ▼         ▼            ▼         │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                   Shared Data Layer                            │ │
│  │                                                                │ │
│  │  Object Store   │ Metadata DB  │ Search Index │ Audit Log     │ │
│  │  (traces, blobs)│ (PostgreSQL) │ (traces,     │ (append-only) │ │
│  │                 │              │  policies)   │               │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │                   Auth & Access Control                        │ │
│  │       Org management · API key issuance · Role assignment      │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Deployment Note

The diagram above shows logical components. In v1, all components run in a single process behind a single API gateway. They share a PostgreSQL database and an S3-compatible object store. This modular monolith architecture avoids premature infrastructure complexity while maintaining clean internal boundaries that enable future decomposition.

### Component Summary

| Component | Boundary | Responsibility |
|---|---|---|
| Agent Runtime | External (Local / CI) | Executes agents (NOT Krynix) |
| Krynix OSS Engine | External (Local / CI) | Trace capture, policy evaluation, replay, CLI |
| Krynix CLI (push/pull) | External (Local / CI) | Communicates with Control Plane APIs |
| API Gateway | Control Plane (ingress) | Authentication, rate limiting, routing |
| Trace Ingest | Control Plane (logical) | Receives, validates, and stores traces |
| Policy Registry | Control Plane (logical) | Stores, versions, and distributes policies |
| Replay Report Ingest | Control Plane (logical) | Receives locally-produced replay results (v1); hosted replay execution (v2) |
| Golden Trace Registry | Control Plane (logical) | Org-wide golden trace storage and verification |
| Compliance Engine | Control Plane (logical) | Generates compliance evidence bundles |
| Dashboard API | Control Plane (logical) | Powers visibility UI, search, and analytics |
| Auth & Access Control | Control Plane (logical) | Authentication, authorization, org management |
| Shared Data Layer | Control Plane (infra) | Persistent storage: object store, database, search |

---

## 2. Data Flow: CLI to Control Plane

All data flows are **explicit, user-initiated, and post-hoc**. The Control Plane never reaches into local environments. The OSS engine never requires network connectivity. All uploads are push-based — the CLI sends artifacts after local operations complete.

### 2.1 Trace Upload

After an agent session completes locally (or in CI), the user explicitly pushes the trace to the Control Plane.

```
Step 1: CLI reads the .trace.jsonl file
Step 2: CLI computes a SHA-256 digest of the full file (integrity check)
Step 3: CLI sends POST /api/v1/traces with:
          Header: Authorization: Bearer <org-scoped-token>
          Header: X-Krynix-Digest: sha256:<file-digest>
          Body: multipart/form-data with the .trace.jsonl file
          Metadata: agent_id, session_id (extracted from trace)
Step 4: Trace Ingest receives the upload
Step 5: Ingest verifies the hash chain using StreamingHashValidator
          (event-by-event, memory-efficient, rejects on first break)
Step 6: If hash chain is valid:
          - Store trace in object store (keyed by org_id/session_id)
          - Extract metadata (agent_id, event counts, timestamps, stats)
          - Index metadata in search index
          - Record ingest event in audit log
          - Return 201 Created with trace_id
Step 7: If hash chain is invalid:
          - Reject with 422 Unprocessable Entity
          - Include the broken_at sequence_num and error message
          - Record rejection in audit log (potential tampering indicator)
```

**CLI command:** `krynix push --trace <path>`

**Failure behavior:** If the push fails (network error, auth failure, server error), the local trace file is unaffected. The CLI logs the error and exits with a non-zero code. CI pipelines can be configured to treat push failures as non-blocking (`fail_on_push_error: false`).

### 2.2 Policy Sync

The CLI pulls policies from the Control Plane's Policy Registry. This enables org-wide policy governance: security teams publish policies centrally (via `krynix policy push`), and all teams/CI pipelines consume them (via `krynix policy pull`).

Policies in the registry are managed through a GitOps-compatible workflow: policies are authored in version control, pushed to the registry as part of a CI pipeline, and pulled by consuming pipelines before evaluation.

```
Step 1: CLI sends GET /api/v1/policies with:
          Header: Authorization: Bearer <org-scoped-token>
          Query: ?labels=environment:production (optional filter)
          Query: ?since=<RFC3339-timestamp> (incremental sync)
Step 2: Policy Registry returns a list of policy definitions:
          Each policy: name, version, YAML content, SHA-256 digest
          Policies matching the filter and newer than since timestamp
Step 3: CLI writes policies to the local policy directory
          Verifies each policy's digest matches content
          Skips policies with matching name+version already present locally
Step 4: CLI runs krynix evaluate using the synced policies
```

**CLI command:** `krynix policy pull [--labels environment:production]`

The `PolicyResolver` callback in `inheritance.ts` (currently file-based) supports injection of a remote resolver. For Control Plane integration, the resolver fetches parent policies from the registry via `GET /api/v1/policies/:name` instead of reading from the local filesystem.

### 2.3 Evaluation Result Reporting

After running `krynix evaluate` locally, the CLI can report results to the Control Plane for centralized visibility. Evaluation is always performed locally by the OSS engine — the Control Plane aggregates results, it does not perform evaluation.

```
Step 1: CLI runs krynix evaluate --trace <path> --policy <path>
Step 2: CLI sends POST /api/v1/evaluations with:
          Header: Authorization: Bearer <org-scoped-token>
          Body: JSON containing:
            trace_id (session_id from trace)
            policy_name and policy_version used
            verdict (pass | fail | require-approval)
            exit_code
            violations[] (array of Violation objects)
            evaluated_at (RFC3339 timestamp)
            environment (ci | local | staging)
Step 3: Control Plane stores evaluation result linked to the trace
Step 4: Dashboard surfaces evaluation results in org-wide views
```

**CLI command:** `krynix push --evaluation <path>` (for separate upload) or `krynix push --trace <path> --evaluation <path>` (combined upload)

### 2.4 Replay Report Ingestion (v1) / Hosted Replay (v2)

**v1 — Replay Report Ingestion:**

In v1, replay executes locally using the OSS engine. The Control Plane accepts replay reports — the structured output of a local replay run — for centralized storage and visibility. The Control Plane validates report metadata (trace reference exists, schema conformance) but does not re-execute replay.

```
Step 1: User runs krynix replay locally, producing a replay report
Step 2: CLI sends POST /api/v1/replays with:
          Header: Authorization: Bearer <org-scoped-token>
          Body: JSON containing:
            trace_id (session_id of the replayed trace)
            result_status: "pass" | "diverged"
            events_verified: integer
            divergence_report: { event_index, expected, actual } (if diverged)
            replayed_at: RFC3339 timestamp
            engine_version: string (krynix version used for replay)
Step 3: Control Plane validates:
          - Referenced trace_id exists in storage
          - Report schema is valid
          - Store report linked to trace
Step 4: Dashboard surfaces replay results alongside trace and evaluation data
```

**CLI command:** `krynix push --replay-report <path>`

**v2 — Hosted Replay (Deferred):**

When hosted replay is implemented, the Control Plane will execute deterministic replay in a sandboxed environment. This requires isolated Node.js execution with no network access (network stubbing is part of the Determinism Envelope). Deferred from v1 due to high infrastructure cost and the need to validate product-market fit with trace storage first.

### 2.5 Compliance Evidence Bundle Generation

For regulated environments, the Compliance Engine generates evidence bundles — structured archives containing all artifacts needed for audit handoff.

```
Step 1: CLI (or Dashboard UI) sends POST /api/v1/compliance/exports with:
          Header: Authorization: Bearer <org-scoped-token>
          Body: {
            trace_ids: [<session_id>, ...],     (or)
            date_range: { from, to },           (or)
            agent_ids: [<agent_id>, ...]
            include_otlp: boolean
          }
Step 2: Compliance Engine retrieves matching traces from object store
Step 3: For each trace, the engine assembles:
          The full .trace.jsonl file
          Hash chain verification result (re-verified at bundle time)
          Policy evaluation results (all evaluations stored for this trace)
          Replay report (if available)
          Trace statistics (computed via computeTraceStats)
          OTLP export (computed via convertToOtlp) if requested
Step 4: Engine produces a bundle with:
          manifest.json listing all artifacts and their SHA-256 digests
          All artifact files organized by type
          The manifest itself is integrity-checked (see Section 6)
Step 5: Returns the bundle as a downloadable archive
Step 6: Bundle generation event recorded in audit log
```

**CLI command:** `krynix compliance export --trace <file> [--trace <file>...] --output <path>`

---

## 3. Security Model

### 3.1 Authentication

| Mechanism | Use Case | Format |
|---|---|---|
| Org-scoped API keys | CI pipelines, automated uploads | `krynix-key-<org_id>-<random-32-bytes-hex>` |
| Short-lived tokens | Interactive CLI sessions | JWT, 1-hour TTL, signed by Control Plane |
| Service accounts | CI/CD pipeline identity | API key with `service_account` flag and restricted permissions |

**API keys** are scoped to a single organization and issued via `krynix auth create-key`. Keys do not expire by default but:

- Support revocation (`PLANNED` — no CLI command yet)
- Support optional expiration (planned: `--expires-in 90d`)
- Have a `last_used_at` timestamp for staleness detection
- Are stored as salted bcrypt hashes (plaintext shown only at creation time)

**Token exchange flow for interactive sessions:**

```
1. krynix auth login --email <email> --password <password>
2. CLI POSTs credentials to Control Plane /api/v1/auth/token
3. Control Plane validates credentials and issues a short-lived JWT
4. CLI stores JWT in ~/.krynix/credentials (mode 0600)
```

**SSO/OIDC integration:** Deferred to v2. v1 supports email-based authentication with password. OIDC provider integration (for enterprise SSO) is planned for v2 and will support standard providers (Okta, Azure AD, Google Workspace).

**Service accounts** are API keys with a `service_account: true` flag. They:

- Are created server-side (UI or API); the CLI creates generic API keys via `krynix auth create-key --name "CI pipeline"` — server-side designation as service account is `PARTIAL` and not yet exposed via CLI flag
- Have permissions equivalent to `member` role (push traces, pull policies)
- Cannot access the Dashboard API or manage users
- Are the recommended authentication method for CI pipelines

### 3.2 Authorization: RBAC Model

v1 uses four roles plus service accounts:

| Role | Permissions | Typical User |
|---|---|---|
| `org_admin` | Full org management: manage members, manage API keys, publish policies, view all traces, generate compliance exports, view audit log, delete traces | CTO, VP Engineering |
| `maintainer` | Publish policies to registry, promote golden traces, view all team traces, generate compliance exports | Security lead, engineering manager |
| `member` | Push traces, push evaluation/replay reports, pull policies, view own team's traces and evaluations | Individual contributor |
| `auditor` | Read-only access to all traces, evaluations, replay reports, compliance exports, and audit log across the org. Cannot modify policies, push traces, or manage users | Compliance officer, external auditor |

**Service accounts** are not a role — they are an authentication type with `member`-level permissions restricted to:

- Push traces (`POST /api/v1/traces`)
- Push evaluation results (`POST /api/v1/evaluations`)
- Push replay reports (`POST /api/v1/replays`)
- Pull policies (`GET /api/v1/policies`)

**Permission matrix:**

| Action | org_admin | maintainer | member | auditor | service_account |
|---|---|---|---|---|---|
| Push traces | Yes | Yes | Yes | No | Yes |
| Push evaluation results | Yes | Yes | Yes | No | Yes |
| Push replay reports | Yes | Yes | Yes | No | Yes |
| Pull policies | Yes | Yes | Yes | Yes | Yes |
| View traces (own team) | Yes | Yes | Yes | Yes | No |
| View traces (all org) | Yes | No | No | Yes | No |
| Publish policy to registry | Yes | Yes | No | No | No |
| Generate compliance export | Yes | Yes | No | Yes | No |
| Promote golden traces | Yes | Yes | No | No | No |
| Manage API keys | Yes | No | No | No | No |
| Manage members | Yes | No | No | No | No |
| View audit log | Yes | No | No | Yes | No |
| Delete traces | Yes | No | No | No | No |
| Access Dashboard API | Yes | Yes | Yes | Yes | No |

### 3.3 Data Integrity

**On ingest:**

- Every trace upload undergoes full hash chain verification using `StreamingHashValidator` logic (event-by-event, checking `prev_hash` linkage and recomputing `event_hash` via canonical JSON + SHA-256)
- Traces with broken hash chains are rejected with a `422` status and a specific error indicating the `sequence_num` where the chain broke
- Rejected uploads are recorded in the audit log as potential tampering events

**At rest:**

- Stored traces are immutable. No API allows modification of a stored trace
- Object store versioning is enabled to prevent accidental or malicious deletion
- Periodic integrity checks re-verify stored traces (background job, configurable interval)

**Future (trace schema v2.0):**

- Ed25519 signatures on traces (non-repudiation: proves which agent produced the trace)
- Signed attestations on compliance evidence bundles

### 3.4 Encryption

| Layer | Mechanism |
|---|---|
| In transit | TLS 1.2+ required (prefer TLS 1.3) with modern AEAD cipher suites (AES-128-GCM, AES-256-GCM, ChaCha20-Poly1305). No plaintext fallback. HSTS enforced. |
| At rest | Envelope encryption via KMS. Data encrypted with data encryption keys (DEKs); DEKs encrypted with key encryption keys (KEKs) managed by the KMS provider (AWS KMS, GCP Cloud KMS, or self-managed HSM for on-premise). Object store and database encryption are both KMS-backed. |
| Key rotation | KEKs are rotated on a configurable schedule (default: 90 days). Rotation is transparent — existing data is not re-encrypted; new data uses the new KEK. Old KEKs are retained for decryption until all data encrypted under them has expired or been re-encrypted during a maintenance window. |
| API keys | Stored as salted bcrypt hashes in metadata DB. Plaintext shown only at creation time. |
| Credentials file | CLI stores tokens in OS keychain where available, falls back to `~/.krynix/credentials` with `0600` permissions. |

### 3.5 Redaction Preservation

The Control Plane **never** stores pre-redaction data. Redaction is performed locally by the OSS engine before traces are produced. The Control Plane receives traces that have already been redacted. There is no "un-redact" API. The `[REDACTED:SHA256_PREFIX_8]` format is preserved verbatim in storage and compliance exports.

The Control Plane enforces this property:

- No API accepts raw (pre-redaction) payloads
- The `redacted` field on TraceEvents is stored as-is
- Search indexing operates over redacted content only
- Compliance exports include a statement that data was redacted at the source

### 3.6 Audit Trail

Every Control Plane action is logged to an append-only audit log:

```json
{
  "audit_id": "uuid-v4",
  "timestamp": "2026-03-15T14:22:03.847Z",
  "org_id": "org-uuid",
  "actor_id": "user-or-key-uuid",
  "actor_type": "user | api_key | service_account",
  "role": "member",
  "action": "trace.push | policy.publish | replay.push | compliance.export | ...",
  "resource_type": "trace | policy | replay | export | user | api_key",
  "resource_id": "uuid",
  "result": "success | denied | error",
  "ip_address": "x.x.x.x",
  "user_agent": "krynix-cli/1.0.0",
  "details": {}
}
```

The audit log:

- Is append-only (no update or delete operations)
- Has a separate retention policy from trace data (minimum 2 years for compliance)
- Is readable only by `org_admin` and `auditor` roles
- Is included in compliance evidence bundles when requested

### 3.7 Key Management for Signed Attestations (Future)

When Ed25519 signing is implemented in trace schema v2.0:

- Each organization generates a signing keypair via the Control Plane
- The private key is stored in the KMS (HSM-backed where available)
- The public key is published at a well-known URL (`/.well-known/krynix-keys/<org_id>`)
- Compliance bundles include public keys and signatures for independent verification
- Key rotation is supported with a grace period during which both old and new keys are accepted

---

## 4. Separation: OSS Engine vs. Control Plane

| Capability | OSS Engine (Local/CI) | Control Plane | Required? |
|---|---|---|---|
| Trace capture and hash chain | Yes | No (receives results) | OSS only |
| Secret redaction | Yes | No (receives redacted data) | OSS only |
| Policy parsing and evaluation | Yes (local files) | No (stores and distributes) | OSS only |
| Policy inheritance resolution | Yes (file-based resolver) | Yes (remote resolver) | OSS only |
| Policy diff | Yes | No | OSS only |
| Deterministic replay verification | Yes (integrity + drift, locally) | Yes (v2: hosted execution) | OSS only |
| Golden trace verification | Yes (CI, local files) | Yes (org-wide registry) | OSS only |
| OTLP export | Yes (pure function) | Yes (in evidence bundles) | OSS only |
| Trace statistics | Yes (pure function) | Yes (in dashboards) | OSS only |
| Streaming hash validation | Yes (in-process) | Yes (on ingest) | OSS only |
| CLI: evaluate, replay, export, stats | Yes | N/A | OSS only |
| Centralized trace storage | No | Yes | CP only |
| Centralized policy registry | No | Yes | CP only |
| Org-wide golden trace registry | No | Yes | CP only |
| Compliance evidence bundles | No | Yes | CP only |
| RBAC and org governance | No | Yes | CP only |
| Cross-team trace search | No | Yes | CP only |
| Dashboards and analytics | No | Yes | CP only |
| Audit trail | No | Yes | CP only |

**Hard invariant:** The OSS engine MUST remain fully functional without the Control Plane. No OSS engine command or library function requires network connectivity to the Control Plane. The Control Plane is purely additive.

**Integration design:** The OSS engine provides injection points (callback types, pure functions) that a Control Plane SDK can fill in:

- `PolicyResolver` in `inheritance.ts`: currently file-based, accepts any async `(ref: string) => Promise<Policy>` including HTTP-backed implementations
- `TraceWriter`: currently file-based, could accept a tee-writer that writes locally AND uploads
- `StreamingHashValidator`: reused server-side for ingest validation
- `convertToOtlp()`: reused in compliance evidence bundles
- `computeTraceStats()`: reused for dashboard analytics

---

## 5. v1 Feature Set

The smallest feature set that provides value beyond the OSS engine and targets regulated environments deploying agents.

### v1 Features

| Feature | What It Does | Why OSS Alone Cannot Provide This |
|---|---|---|
| **Trace storage + search** | Centralized, hash-verified trace archive with search across all agent sessions. | Requires managed infrastructure with hash chain verification on ingest, search indexing, and retention management. |
| **Policy registry** | Org-wide policy definitions with version history. Security teams publish; all CI pipelines consume. | Requires centralized storage, versioning, and distribution infrastructure. OSS policies are local files. |
| **Replay report storage** | Centralized storage of locally-produced replay results. Replay reports linked to traces for complete audit picture. | Requires centralized storage linked to trace data. OSS replay results are local files. |
| **Compliance evidence bundles** | Pre-assembled evidence packages containing traces, evaluations, replay reports, and statistics for audit handoff. | Requires all artifacts stored in one system. OSS produces artifacts locally and cannot aggregate across teams. |
| **RBAC** | Org/team/role structure controlling who can publish policies, view traces, and generate compliance exports. | Table-stakes for enterprise procurement in regulated environments. |

### Explicit v1 Non-Features (Deferred)

| Feature | Reason for Deferral |
|---|---|
| Hosted replay execution | High infrastructure cost (requires sandboxed Node.js execution). v1 accepts locally-produced replay reports instead. Defer hosted execution until trace storage proves product-market fit. |
| Signed attestations | Depends on Ed25519 support in trace schema v2.0. Meaningful only after trace storage adoption. |
| SSO/OIDC integration | Enterprise feature. v1 uses email-based auth. OIDC integration planned for v2. |
| Real-time dashboards | Requires WebSocket infrastructure and frontend. v1 provides a JSON REST API for third-party tool integration (Grafana, etc.). |
| Webhook/notification integrations | Policy violation notifications can use existing CI mechanisms initially. |

### v1 Pricing Hypothesis

| Tier | Target | Features |
|---|---|---|
| Free | Individual developers | OSS engine only; no Control Plane |
| Team | Small teams (< 10 agents) | Trace storage (90-day retention), policy registry, replay report storage, 3 users, basic RBAC |
| Enterprise | Regulated organizations | Unlimited retention, compliance evidence bundles, audit log, self-hosted option |

---

## 6. Compliance Evidence Bundles

Evidence bundles are the primary compliance deliverable. They package all artifacts needed for audit handoff into a self-contained, integrity-verified archive.

### Bundle Contents

| Artifact | Source | Included When |
|---|---|---|
| `.trace.jsonl` files | Object store | Always |
| Hash chain verification result | Re-computed at bundle time | Always |
| Evaluation results (JSON) | Evaluation result store | When evaluations exist for the trace |
| Replay reports (JSON) | Replay report store | When replay reports exist for the trace |
| Trace statistics (JSON) | Computed via `computeTraceStats()` | Always |
| OTLP export (JSON) | Computed via `convertToOtlp()` | When `include_otlp: true` |
| Policy definitions (YAML) | Policy registry | All policies referenced in evaluations |
| Audit log entries (JSON) | Audit log | All entries referencing included traces |

### Bundle Structure

```
compliance-export-<date>/
  manifest.json
  traces/
    <session_id_1>.trace.jsonl
    <session_id_2>.trace.jsonl
  evaluations/
    <session_id_1>.evaluation.json
    <session_id_2>.evaluation.json
  replays/
    <session_id_1>.replay.json
  stats/
    <session_id_1>.stats.json
    <session_id_2>.stats.json
  otlp/                              (if include_otlp=true)
    <session_id_1>.otlp.json
    <session_id_2>.otlp.json
  policies/
    no-shell-exec@1.0.0.policy.yaml
    workspace-boundary@1.0.0.policy.yaml
  audit/
    audit_entries.jsonl
```

### Integrity Mechanism

The `manifest.json` contains the SHA-256 digest of every file in the bundle. Any consumer can independently verify bundle integrity by recomputing digests and comparing against the manifest.

```json
{
  "export_id": "uuid",
  "org_id": "uuid",
  "generated_at": "2026-03-15T14:22:03.847Z",
  "generated_by": "user-uuid",
  "krynix_engine_version": "1.0.0",
  "trace_count": 2,
  "artifacts": [
    {
      "path": "traces/session-1.trace.jsonl",
      "type": "trace",
      "digest": "sha256:<hex>",
      "hash_chain_valid": true,
      "event_count": 42
    },
    {
      "path": "evaluations/session-1.evaluation.json",
      "type": "evaluation",
      "digest": "sha256:<hex>"
    },
    {
      "path": "replays/session-1.replay.json",
      "type": "replay_report",
      "digest": "sha256:<hex>"
    }
  ],
  "redaction_notice": "All trace data was redacted at the source using Krynix automatic redaction. No pre-redaction data is included in this bundle.",
  "integrity_note": "Verify this bundle by computing SHA-256 of each artifact file and comparing against the digest in this manifest."
}
```

**Future (v2):** Ed25519 signature over `manifest.json` for cryptographic non-repudiation. A `signature.sig` file will be included alongside the manifest.

---

## 7. What Remains Purely OSS

The following capabilities are free and open-source, MIT licensed, permanently:

1. **TraceEvent schema** — The `1.0.0` schema definition, all 8 event types, all payload interfaces
2. **Hash chain** — SHA-256 hash chain computation and validation
3. **Streaming hash validation** — `StreamingHashValidator` for memory-efficient incremental validation
4. **Canonical JSON serialization** — `canonicalize()` (sorted keys, minimal whitespace, UTF-8)
5. **Secret redaction** — `redact()` and `redactWithPatterns()` with `[REDACTED:SHA256_PREFIX_8]` format
6. **Policy parser** — `parsePolicy()` for YAML v1 schema validation
7. **Policy evaluator** — `evaluate()` with first-match-wins rule matching, verdict computation, exit codes
8. **Policy matcher** — `matchRule()` with all 7 operators (eq, neq, in, not_in, matches, contains, exists)
9. **Policy inheritance** — `resolvePolicy()` and `mergePolicy()` with chain resolution
10. **Policy diff** — `diffPolicies()` with severity downgrade and action weakening detection
11. **Deterministic replay verification** — Integrity verification, hash chain recomputation, baseline drift comparison
12. **[PLANNED] Deterministic execution replay** — Full Determinism Envelope (seed, time freeze, network stub, filesystem snapshot, dependency pin)
13. **Golden trace verification** — Local golden trace testing in CI
14. **OTLP export** — `convertToOtlp()` producing OpenTelemetry protobuf-JSON
15. **Trace statistics** — `computeTraceStats()` for per-session analytics
16. **Session management** — `startSession()`, `recordEvent()`, `endSession()` with hash chain on-the-fly
17. **Trace writer** — `TraceWriter` for append-only JSONL output with incremental hashing
18. **Trace reader** — `readTrace()` for loading and parsing `.trace.jsonl` files
19. **Schema validation** — `validateTraceEvent()`, `validatePolicy()`, `validateReport()`
20. **Seeded random** — `SeededRandom` for deterministic UUID generation
21. **Adapter framework** — `TraceAdapter` interface and `AdapterConfig` type
22. **OpenClaw adapter** — Reference adapter implementation
23. **CLI** — All commands: `evaluate`, `replay`, `export`, `stats`, `validate`, `policy test`, `policy diff`

The OSS engine is the complete, self-contained trust verification pipeline. The Control Plane adds centralized governance around it but does not gate or restrict any OSS functionality.

---

## 8. Control Plane Logical Components

> **Implementation note:** These are logical components with well-defined interfaces. In v1, they are modules within a single application process sharing one PostgreSQL database and one S3-compatible object store. Module boundaries are internal API boundaries, not network boundaries.

### 8.1 Trace Ingest

**Responsibility:** Receive, validate, and store trace files uploaded by the CLI or CI pipelines.

**API Surface:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/traces` | Upload a trace file |
| `GET` | `/api/v1/traces/:trace_id` | Retrieve trace metadata |
| `GET` | `/api/v1/traces/:trace_id/events` | Stream trace events (JSONL) |
| `GET` | `/api/v1/traces/:trace_id/download` | Download raw .trace.jsonl file |
| `DELETE` | `/api/v1/traces/:trace_id` | Soft-delete a trace (org_admin only) |
| `GET` | `/api/v1/traces` | List/search traces with filters |

**Request: `POST /api/v1/traces`**

```
Content-Type: multipart/form-data
Authorization: Bearer <token>
X-Krynix-Digest: sha256:<hex-digest-of-file>

Part: file=<.trace.jsonl content>
```

**Response: `201 Created`**

```json
{
  "trace_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "agent_id": "agent-1",
  "event_count": 42,
  "hash_chain_valid": true,
  "uploaded_at": "2026-03-15T14:22:03.847Z",
  "stats": {
    "duration_ms": 12340,
    "tool_call_count": 8,
    "llm_request_count": 4,
    "error_count": 0,
    "total_token_usage": 2500
  }
}
```

**Response: `422 Unprocessable Entity` (broken hash chain)**

```json
{
  "error": "hash_chain_invalid",
  "broken_at": 7,
  "message": "prev_hash mismatch at event 7: expected \"a1b2c3...\", got \"d4e5f6...\""
}
```

**Data Model:**

```sql
traces_metadata (
  trace_id         UUID PRIMARY KEY,     -- same as session_id
  org_id           UUID NOT NULL,
  team_id          UUID,
  agent_id         TEXT NOT NULL,
  event_count      INTEGER NOT NULL,
  duration_ms      BIGINT,
  tool_call_count  INTEGER,
  llm_request_count INTEGER,
  error_count      INTEGER,
  total_token_usage BIGINT,
  hash_chain_valid BOOLEAN NOT NULL,
  first_event_at   TIMESTAMPTZ NOT NULL,
  last_event_at    TIMESTAMPTZ NOT NULL,
  uploaded_at      TIMESTAMPTZ NOT NULL,
  uploaded_by      UUID NOT NULL,        -- actor (user or API key)
  storage_key      TEXT NOT NULL,         -- object store key
  file_digest      TEXT NOT NULL,         -- SHA-256 of raw file
  deleted_at       TIMESTAMPTZ           -- soft delete
)
```

**Scaling notes:** Trace ingest is write-heavy and embarrassingly parallel. In v1 (modular monolith), concurrency is handled via async request processing. If scaling demands exceed a single instance, the ingest module is the first candidate for extraction into a separate service. Hash chain validation is CPU-bound (SHA-256 per event) but memory-efficient (streaming).

### 8.2 Policy Registry

**Responsibility:** Store, version, and distribute organization-wide policy definitions. Enable security teams to publish policies that all CI pipelines consume.

**API Surface:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/policies` | Publish a new policy or new version |
| `GET` | `/api/v1/policies` | List policies (with label/version filters) |
| `GET` | `/api/v1/policies/:name` | Get latest version of a policy by name |
| `GET` | `/api/v1/policies/:name/versions` | List all versions of a policy |
| `GET` | `/api/v1/policies/:name/versions/:version` | Get specific version |
| `DELETE` | `/api/v1/policies/:name` | Deprecate a policy (org_admin / maintainer) |

**Request: `POST /api/v1/policies`**

```json
{
  "yaml_content": "<full policy YAML string>",
  "changelog": "Added rate-limiting rule for shell_exec"
}
```

The server parses the YAML using `parsePolicy()` from the OSS engine to validate schema conformance before storing. Invalid policies are rejected with `400`.

**Response: `201 Created`**

```json
{
  "policy_id": "uuid",
  "name": "no-shell-exec",
  "version": "1.2.0",
  "published_at": "2026-03-15T14:22:03.847Z",
  "published_by": "user-uuid",
  "digest": "sha256:<hex>"
}
```

**Data Model:**

```sql
policies (
  policy_id        UUID PRIMARY KEY,
  org_id           UUID NOT NULL,
  name             TEXT NOT NULL,          -- metadata.name from YAML
  version          TEXT NOT NULL,          -- metadata.version from YAML
  yaml_content     TEXT NOT NULL,
  parsed_json      JSONB NOT NULL,         -- parsed Policy object
  digest           TEXT NOT NULL,          -- SHA-256 of yaml_content
  labels           JSONB,                  -- metadata.labels
  extends_ref      TEXT,                   -- metadata.extends (parent)
  published_at     TIMESTAMPTZ NOT NULL,
  published_by     UUID NOT NULL,
  deprecated_at    TIMESTAMPTZ,
  changelog        TEXT,
  UNIQUE(org_id, name, version)
)
```

**Scaling notes:** Read-heavy (many CI pipelines pulling policies) with infrequent writes. Cache published policies with `ETag` / `If-None-Match` headers for client-side caching.

**Integration with PolicyResolver:**

```typescript
// Remote PolicyResolver for inheritance resolution
const remoteResolver: PolicyResolver = async (ref: string) => {
  const response = await fetch(`${controlPlaneUrl}/api/v1/policies/${ref}`);
  const data = await response.json();
  return parsePolicy(data.yaml_content);
};
```

### 8.3 Replay Report Ingest (v1) / Replay Service (v2)

**v1 Responsibility:** Receive and store locally-produced replay reports. Validate report metadata (referenced trace exists, schema conformance). Link reports to traces for dashboard and compliance visibility.

**v2 Responsibility (Deferred):** Execute deterministic replay in a hosted, sandboxed environment.

**API Surface:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/replays` | Submit a replay report (v1) or request hosted replay (v2) |
| `GET` | `/api/v1/replays/:replay_id` | Get replay report/result |
| `GET` | `/api/v1/replays` | List replay reports (with trace/agent filters) |

**Request: `POST /api/v1/replays` (v1 — report ingestion)**

```json
{
  "trace_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "result_status": "pass",
  "events_verified": 42,
  "divergence_report": null,
  "replayed_at": "2026-03-15T14:22:08.000Z",
  "engine_version": "1.0.0"
}
```

**Response: `201 Created`**

```json
{
  "replay_id": "uuid",
  "trace_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "result_status": "pass",
  "events_verified": 42,
  "stored_at": "2026-03-15T14:22:08.500Z"
}
```

**Data Model:**

```sql
replays (
  replay_id        UUID PRIMARY KEY,
  org_id           UUID NOT NULL,
  trace_id         UUID NOT NULL REFERENCES traces_metadata(trace_id),
  source           TEXT NOT NULL DEFAULT 'local',  -- 'local' (v1) or 'hosted' (v2)
  result_status    TEXT NOT NULL,          -- pass | diverged
  events_verified  INTEGER NOT NULL,
  divergence_json  JSONB,                 -- divergence report if applicable
  engine_version   TEXT,                  -- krynix version used for replay
  replayed_at      TIMESTAMPTZ NOT NULL,  -- when replay was executed
  submitted_by     UUID NOT NULL,
  stored_at        TIMESTAMPTZ NOT NULL
)
```

**Scaling notes:** Low write volume in v1 (report ingestion only). Standard database-backed storage.

### 8.4 Golden Trace Registry

**Responsibility:** Store and manage org-wide golden traces. Unlike local golden traces committed to individual repositories, the registry provides cross-team visibility and centralized governance over baseline behaviors.

**API Surface:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/golden-traces` | Promote a trace to golden status |
| `GET` | `/api/v1/golden-traces` | List golden traces (with agent/label filters) |
| `GET` | `/api/v1/golden-traces/:golden_id` | Get golden trace metadata |
| `GET` | `/api/v1/golden-traces/:golden_id/download` | Download golden trace file |
| `DELETE` | `/api/v1/golden-traces/:golden_id` | Remove golden trace (maintainer, org_admin) |

**Request: `POST /api/v1/golden-traces`**

```json
{
  "trace_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "name": "checkout-flow-happy-path",
  "description": "Golden trace for standard checkout agent flow",
  "labels": { "team": "payments", "agent": "checkout-agent" }
}
```

The trace must already be uploaded and hash-chain-verified. The service verifies the trace exists and is valid before promoting.

**Data Model:**

```sql
golden_traces (
  golden_id        UUID PRIMARY KEY,
  org_id           UUID NOT NULL,
  trace_id         UUID NOT NULL REFERENCES traces_metadata(trace_id),
  name             TEXT NOT NULL,
  description      TEXT,
  labels           JSONB,
  promoted_at      TIMESTAMPTZ NOT NULL,
  promoted_by      UUID NOT NULL,
  deprecated_at    TIMESTAMPTZ,
  UNIQUE(org_id, name)
)
```

**Scaling notes:** Low write volume, moderate read volume. Standard database-backed CRUD with caching.

### 8.5 Compliance Engine

**Responsibility:** Generate compliance evidence bundles (see Section 6 for bundle specification).

**API Surface:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/compliance/exports` | Request an evidence bundle |
| `GET` | `/api/v1/compliance/exports/:export_id` | Get export status and download link |
| `GET` | `/api/v1/compliance/exports` | List past exports |

**Request: `POST /api/v1/compliance/exports`**

```json
{
  "filter": {
    "trace_ids": ["uuid1", "uuid2"],
    "date_range": { "from": "2026-01-01T00:00:00Z", "to": "2026-03-31T23:59:59Z" },
    "agent_ids": ["checkout-agent"],
    "include_otlp": true
  }
}
```

**Data Model:**

```sql
compliance_exports (
  export_id        UUID PRIMARY KEY,
  org_id           UUID NOT NULL,
  status           TEXT NOT NULL,         -- pending | generating | completed | failed
  filter_json      JSONB NOT NULL,
  trace_count      INTEGER,
  artifact_count   INTEGER,
  storage_key      TEXT,                  -- object store key for completed bundle
  generated_at     TIMESTAMPTZ,
  requested_at     TIMESTAMPTZ NOT NULL,
  requested_by     UUID NOT NULL,
  expires_at       TIMESTAMPTZ           -- auto-cleanup for storage management
)
```

**Scaling notes:** Bundle generation is async. In v1, a background job within the monolith processes generation requests. Large exports (thousands of traces) may take minutes.

### 8.6 Dashboard API

**Responsibility:** Provide the read API that powers organizational visibility: trace search, analytics, policy compliance status, and team-level health metrics.

**API Surface:**

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/dashboard/overview` | Org-level summary |
| `GET` | `/api/v1/dashboard/traces` | Paginated trace search with filters |
| `GET` | `/api/v1/dashboard/agents` | Agent-level summary |
| `GET` | `/api/v1/dashboard/policies` | Policy compliance overview |
| `GET` | `/api/v1/dashboard/timeline` | Time-series data for charting |

**Response: `GET /api/v1/dashboard/overview`**

```json
{
  "org_id": "uuid",
  "period": { "from": "2026-03-01T00:00:00Z", "to": "2026-03-15T23:59:59Z" },
  "total_traces": 1247,
  "verdict_distribution": { "pass": 1180, "fail": 52, "require-approval": 15 },
  "active_agents": 8,
  "active_policies": 5,
  "total_events": 52340,
  "total_token_usage": 1250000,
  "hash_chain_failures": 0
}
```

**Scaling notes:** Read-heavy. Use materialized views or pre-computed aggregates for overview and timeline queries. Cache responses with short TTLs (1-5 min).

**Frontend:** v1 is a JSON REST API only. No web frontend is provided. The API is designed for consumption by a future Krynix web dashboard, third-party tools (Grafana), or custom internal tools built by customers.

### 8.7 Auth & Access Control

**Responsibility:** Authentication, authorization, organization management, team management, and API key lifecycle.

**API Surface:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/token` | Exchange credentials for JWT |
| `POST` | `/api/v1/auth/api-keys` | Create API key or service account |
| `DELETE` | `/api/v1/auth/api-keys/:key_id` | Revoke API key |
| `GET` | `/api/v1/auth/api-keys` | List API keys for org |
| `GET` | `/api/v1/orgs/:org_id` | Get org details |
| `POST` | `/api/v1/orgs/:org_id/teams` | Create team |
| `GET` | `/api/v1/orgs/:org_id/teams` | List teams |
| `POST` | `/api/v1/orgs/:org_id/members` | Add member with role |
| `PUT` | `/api/v1/orgs/:org_id/members/:user_id` | Update member role |
| `DELETE` | `/api/v1/orgs/:org_id/members/:user_id` | Remove member |

**Data Model:**

```sql
organizations (
  org_id           UUID PRIMARY KEY,
  name             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  settings         JSONB                 -- retention policy, etc.
)

teams (
  team_id          UUID PRIMARY KEY,
  org_id           UUID NOT NULL REFERENCES organizations(org_id),
  name             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL,
  UNIQUE(org_id, name)
)

users (
  user_id          UUID PRIMARY KEY,
  email            TEXT NOT NULL UNIQUE,
  name             TEXT,
  password_hash    TEXT NOT NULL,        -- bcrypt; v2 adds OIDC identity_provider
  created_at       TIMESTAMPTZ NOT NULL
)

org_members (
  org_id           UUID NOT NULL REFERENCES organizations(org_id),
  user_id          UUID NOT NULL REFERENCES users(user_id),
  team_id          UUID REFERENCES teams(team_id),
  role             TEXT NOT NULL,         -- org_admin, maintainer, member, auditor
  assigned_at      TIMESTAMPTZ NOT NULL,
  assigned_by      UUID NOT NULL,
  PRIMARY KEY(org_id, user_id)
)

api_keys (
  key_id           UUID PRIMARY KEY,
  org_id           UUID NOT NULL REFERENCES organizations(org_id),
  key_hash         TEXT NOT NULL,         -- bcrypt hash of the key
  key_prefix       TEXT NOT NULL,         -- first 8 chars for identification
  role             TEXT NOT NULL,         -- role or 'service_account'
  is_service_account BOOLEAN NOT NULL DEFAULT FALSE,
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL,
  created_by       UUID NOT NULL,
  expires_at       TIMESTAMPTZ,          -- optional expiration
  last_used_at     TIMESTAMPTZ,
  revoked_at       TIMESTAMPTZ
)
```

**Scaling notes:** Low volume. Standard application-server scaling.

---

## 9. Deployment Model

### 9.1 SaaS (Hosted by Krynix)

The default deployment model. Krynix operates the Control Plane as a managed service.

```
Customer CI / Workstation
        |
        |  HTTPS
        v
  +-----------------+
  |  Krynix Cloud    |   (hosted by Krynix)
  |  api.krynix.dev  |
  |                   |
  |  Modular monolith|
  |  Shared data layer|
  +-----------------+
```

**Characteristics:**

- Zero infrastructure for customers to manage
- Multi-tenant: orgs are isolated at the data layer (org_id scoping on every query, row-level security)
- Data residency: initially US regions, EU region added based on customer demand
- Retention: configurable per-org (default 90 days for Team tier, unlimited for Enterprise)

### 9.2 Self-Hosted (On-Premise / Air-Gapped)

For regulated environments that cannot send data to external services.

```
Customer Internal Network
        |
        |  HTTPS (internal)
        v
  +------------------------------------+
  |  Customer Infrastructure            |
  |                                     |
  |  +-----------------------------+   |
  |  |  Krynix Control Plane       |   |   Delivered as:
  |  |  (self-hosted)              |   |   - Docker Compose (dev/small)
  |  |                             |   |   - Helm chart (Kubernetes)
  |  |  Single container           |   |
  |  |  Customer-managed DB/storage|   |
  |  +-----------------------------+   |
  |                                     |
  +------------------------------------+
```

**Characteristics:**

- All data stays within the customer's network
- Customer manages infrastructure (PostgreSQL, object storage, compute)
- Krynix provides a single container image and deployment manifests
- License key required (verified offline; no phone-home)
- Updates delivered as new container image versions

**Minimum self-hosted requirements:**

- PostgreSQL 15+
- S3-compatible object store (MinIO for on-premise, or AWS S3/GCS)
- Node.js 20+ runtime
- 2 vCPU, 4 GB RAM minimum (scales with trace volume)

### 9.3 Hybrid (Local Engine + Cloud Control Plane)

The expected default deployment: the OSS engine runs locally and in CI, while the Control Plane runs as SaaS.

```
Customer CI / Workstation                 Krynix Cloud
+------------------------+               +-----------------+
|                         |               |                  |
|  Krynix OSS Engine      |    HTTPS      |  Control Plane   |
|  (trace capture, eval,  | -----------> |  (storage,       |
|   replay, policy eval)  |               |   registry,      |
|                         | <----------- |   compliance,    |
|  krynix push            |    HTTPS      |   dashboard)     |
|  krynix policy pull     |               |                  |
|                         |               |                  |
+------------------------+               +-----------------+
```

**Characteristics:**

- All agent execution remains local (never on the Control Plane)
- Traces are captured and evaluated locally, then explicitly pushed to the Control Plane
- Policies can be managed locally (OSS mode) or pulled from the registry
- The Control Plane is optional: CI continues to work if the Control Plane is unreachable
- Graceful degradation: `krynix push` failures are logged but do not block CI (configurable)

**Configuration:**

```yaml
# ~/.krynix/config.yaml
control_plane:
  url: https://api.krynix.dev
  org_id: <org-uuid>
  # All pushes are explicit CLI commands. No automatic uploads.
  policy_sync: true         # Pull policies from registry before evaluate
  fail_on_push_error: false # Do not block CI if push fails
```

---

## Appendix A: CLI Extensions for Control Plane

The following CLI commands are added when the Control Plane is configured. They are thin HTTP clients shipped as part of the OSS CLI package but require a Control Plane URL and authentication to function.

| Command | Description | v1 |
|---|---|---|
| `krynix push --trace <path>` | Upload a trace to the Control Plane | Yes |
| `krynix push --evaluation <path>` | Report an evaluation result | Yes |
| `krynix push --replay-report <path>` | Upload a locally-produced replay report | Yes |
| `krynix policy pull [--labels ...]` | Sync policies from the registry | Yes |
| `krynix policy push --file <path>` | Publish a policy to the registry | Yes |
| `krynix auth login --email <email> --password <password>` | Interactive authentication | Yes |
| `krynix auth create-key [--name <name>]` | Create an API key | Yes |
| `krynix auth revoke-key <key_id>` | Revoke an API key | No (planned) |
| `krynix compliance export --trace <file> [--trace ...]` | Generate a compliance evidence bundle | Yes |
| `krynix replay --remote --trace-id <id>` | Request hosted replay | No (v2) |

---

## Appendix B: Threat Model Additions

The Control Plane introduces additional threat surfaces beyond the [existing threat model](threat_model.md):

| ID | Threat | Severity | Primary Mitigation |
|---|---|---|---|
| T7 | Control Plane Credential Theft | Critical | Short-lived JWTs, API key scoping, revocation, audit log monitoring |
| T8 | Unauthorized Trace Access | High | RBAC enforcement, team-scoped visibility, audit logging |
| T9 | Policy Registry Poisoning | Critical | RBAC (only maintainer/org_admin can publish), policy diff on pull (CLI warns on changes), audit trail |
| T10 | Compliance Export Forgery | High | Manifest digest verification, future Ed25519 signatures |
| T11 | Denial of Service | Medium | Rate limiting per org, request size limits |
| T12 | Data Exfiltration via API | High | RBAC, audit logging, no bulk export without auditor/org_admin role |

---

## Appendix C: Migration Path

For teams already using the OSS engine:

1. **No breaking changes.** The Control Plane is additive. Existing CLI commands, CI pipelines, and local workflows continue unchanged.
2. **Opt-in configuration.** Adding `control_plane.url` to `~/.krynix/config.yaml` enables Control Plane features. Removing it disables them.
3. **Gradual adoption path:**
   - Start: `krynix auth login` + `krynix push --trace` to begin uploading traces
   - Next: `krynix policy push` to publish existing policies to the registry
   - Next: Switch CI to `krynix policy pull` before `krynix evaluate`
   - Next: `krynix push --replay-report` to centralize replay results
   - When ready: `krynix compliance export` to generate first evidence bundle
