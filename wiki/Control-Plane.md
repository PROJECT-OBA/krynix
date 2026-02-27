# Control Plane

The **Krynix Control Plane** is a planned centralized governance layer that operates around the same artifacts the OSS engine produces. It provides organizational-scale trace storage, policy management, and compliance tooling.

> **Status:** Design phase. The Control Plane is not yet implemented. The full specification is at [control_plane_spec.md](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/control_plane_spec.md).

## Relationship to the OSS Engine

| | OSS Engine | Control Plane |
|---|---|---|
| **Focus** | Local verification | Centralized governance |
| **Deployment** | Developer workstation, CI | Hosted service or self-hosted |
| **License** | MIT | Commercial |
| **Network** | None required | REST API |
| **Artifacts** | Same `.trace.jsonl`, `.policy.yaml` files | Same artifacts, stored centrally |

The OSS engine is fully standalone. Every OSS command works offline without any Control Plane integration. The Control Plane is purely additive.

## Planned Capabilities

### Trace Management
- Centralized trace storage and search
- Hash chain verification on ingest (rejects tampered traces)
- Trace retention policies

### Policy Management
- Policy registry with versioning
- Policy distribution to teams (pull)
- Policy inheritance resolution (remote `extends` references)
- Policy change audit trail

### Compliance
- Compliance evidence bundle storage
- Replay report ingestion (v1: CLI pushes locally-produced reports)
- Compliance export bundles with SHA-256 manifest

### Access Control
- 4-role RBAC: `org_admin`, `maintainer`, `member`, `auditor`
- Service accounts for CI agents (separate from user roles)
- API key management with expiration and staleness detection
- Audit logging of all actions

## Architecture

The Control Plane is designed as a **modular monolith** (v1), not microservices:

### Logical Components

| Component | Purpose |
|-----------|---------|
| **Trace Ingest API** | Receive and verify traces from CLI |
| **Policy Registry** | Store, version, and distribute policies |
| **Replay Report Ingest** | Store locally-produced replay results |
| **Golden Trace Registry** | Org-wide golden trace management |
| **Compliance Engine** | Bundle generation and attestation |
| **Dashboard API** | Read-only views for visibility |
| **Auth & Access Control** | JWT tokens, API keys, RBAC |

All components run in a single process for v1. Logical boundaries enable future extraction.

### Control Plane Boundaries

The Control Plane is an artifact aggregation and governance layer. It:

**Does:**
- Store traces, policies, and evaluation results
- Distribute policies to teams
- Verify hash chain integrity on ingest
- Generate compliance evidence bundles
- Provide visibility into trace and policy history

**Does NOT:**
- Execute agents or influence agent runtime behavior
- Perform LLM inference
- Run deterministic replay (v1 -- deferred to v2)
- Modify traces or policy evaluation results
- Require the OSS engine to function
- Auto-push any data (all uploads are explicit CLI commands)

## CLI Integration

The OSS CLI includes commands for Control Plane interaction:

```bash
# Authentication
krynix auth login --email user@example.com --password '...'
krynix auth create-key --name ci-agent
krynix auth status
krynix auth logout

# Pushing artifacts
krynix push --trace session.trace.jsonl
krynix push --evaluation eval-results.json
krynix push --replay-report replay.json

# Policy management
krynix policy pull --output-dir ./policies
krynix policy push --file my-policy.policy.yaml --changelog "Added deny rule"
```

### Configuration

Control Plane settings are stored in `~/.krynix/config.yaml`:

```yaml
control_plane:
  url: "https://cp.krynix.dev"
  org_id: "org-abc123"
```

Credentials are stored in `~/.krynix/credentials` with `0600` permissions.

## Deployment Models

| Model | Description |
|-------|-------------|
| **SaaS** | Hosted by Krynix (planned) |
| **Self-hosted** | Run on your own infrastructure (single container, 2 vCPU / 4 GB RAM minimum) |
| **Hybrid** | OSS engine local, Control Plane hosted |

## Offline-First Guarantee

All OSS engine commands work without a Control Plane. The engine never requires network connectivity. Control Plane integration is opt-in and additive.

## See Also

- [Control Plane Specification](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/control_plane_spec.md) -- Full architecture document
- [Product Model](https://github.com/artificialvirus/krynix/blob/main/docs/00_overview/product_model.md) -- Two-layer product overview
- [[Architecture Overview]] -- System-level design
