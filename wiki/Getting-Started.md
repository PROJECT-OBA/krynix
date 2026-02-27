# Getting Started

This guide walks you through setting up Krynix, running your first commands, and understanding the core workflow.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | >= 20 LTS | Runtime |
| **pnpm** | >= 9 | Package manager (workspaces) |
| **Git** | >= 2.40 | Version control |

## Installation

Krynix is in early development. Install from source:

```bash
git clone https://github.com/artificialvirus/krynix.git
cd krynix
pnpm install
pnpm build
```

After building, you can run the CLI via:

```bash
pnpm krynix --help
```

## Your First Trust Pipeline

The core Krynix workflow has four steps:

### Step 1: Capture a Trace

Agent frameworks emit events through **Trace Adapters**. The adapter converts framework-specific events into Krynix's canonical `TraceEvent` format, applies redaction, computes hash chains, and writes to a `.trace.jsonl` file.

For the OpenClaw reference adapter:

```typescript
import { createOpenClawAdapter } from "@krynix/adapter-openclaw";

const adapter = createOpenClawAdapter();
await adapter.initialize({ agentId: "my-agent", sessionId: "sess-001", replaySeed: 42 });
// Adapter hooks into OpenClaw's event system automatically
```

### Step 2: Evaluate Against Policies

```bash
# Evaluate a trace against all policies in a directory
pnpm krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Evaluate against a single policy
pnpm krynix evaluate --trace traces/session.trace.jsonl --policy policies/no-shell-exec.policy.yaml
```

**Exit codes:**
- `0` -- all policies pass
- `1` -- runtime error
- `2` -- policy violation (deny)
- `3` -- requires approval

### Step 3: Verify Replay

```bash
# Verify a single trace replays deterministically
pnpm krynix replay --verify --trace traces/session.trace.jsonl

# Verify all golden traces in a directory
pnpm krynix replay --verify --golden-dir test/golden/

# Verbose output for debugging divergence
pnpm krynix replay --verify --verbose --trace traces/session.trace.jsonl
```

### Step 4: Integrate with CI

Add both gates to your CI pipeline:

```yaml
# .github/workflows/ci.yml
jobs:
  trust-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install && pnpm build

      - name: Policy Gate
        run: pnpm krynix evaluate --trace ${{ env.TRACE_PATH }} --policy policies/

      - name: Replay Gate
        run: pnpm krynix replay --verify --golden-dir test/golden/
```

Both gates must pass for a merge to proceed.

## Common Workflows

### Compute Trace Analytics

```bash
pnpm krynix stats --trace traces/session.trace.jsonl
```

Returns JSON with `event_count`, `duration_ms`, `tool_call_count`, `llm_request_count`, `error_count`, `total_token_usage`, and per-type breakdowns.

### Export to OpenTelemetry

```bash
pnpm krynix export --format otlp-json --trace traces/session.trace.jsonl
```

Outputs OTLP protobuf-JSON (`ExportTraceServiceRequest`), compatible with any OTel collector.

### Validate Policy Syntax

```bash
# Validate a single policy
pnpm krynix validate --policy policies/no-shell-exec.policy.yaml

# Validate all policies in a directory
pnpm krynix validate --policy policies/
```

### Test a Policy Against a Trace

```bash
# Reporting mode -- always exits 0
pnpm krynix policy test --policy policies/no-shell-exec.policy.yaml --trace traces/session.trace.jsonl

# Assertion mode -- exits 1 if verdict doesn't match
pnpm krynix policy test --policy my.policy.yaml --trace test.trace.jsonl --expect-verdict pass
```

### Compare Policy Versions

```bash
pnpm krynix policy diff --old policies/v1.policy.yaml --new policies/v2.policy.yaml
```

Detects severity downgrades, action weakenings, rule additions/removals, and scope changes.

### Generate Compliance Bundles

```bash
pnpm krynix compliance export \
  --trace traces/session.trace.jsonl \
  --output ./evidence-bundle \
  --include-otlp
```

Produces a self-contained directory with traces, statistics, OTLP exports, and a SHA-256 integrity manifest.

## Filtering Events

The `evaluate`, `stats`, and `export` commands support event filtering:

```bash
# Filter by event type
pnpm krynix stats --trace session.trace.jsonl --filter-type tool_call --filter-type tool_result

# Filter by agent
pnpm krynix evaluate --trace session.trace.jsonl --policy policies/ --filter-agent agent-1

# Filter by time range
pnpm krynix stats --trace session.trace.jsonl --after 2026-01-15T12:00:00Z --before 2026-01-15T13:00:00Z
```

Filters combine with AND logic. Multiple `--filter-type` and `--filter-agent` values are combined with OR within their category.

## Control Plane Integration

If you have a Krynix Control Plane instance configured:

```bash
# Authenticate
pnpm krynix auth login --email user@example.com --password '...'

# Push traces
pnpm krynix push --trace traces/session.trace.jsonl

# Pull policies from the registry
pnpm krynix policy pull --output-dir ./policies

# Push a policy to the registry
pnpm krynix policy push --file policies/my-policy.policy.yaml
```

See [[Control Plane]] for details on the planned governance layer.

## Next Steps

- [[CLI Reference]] -- Full command reference
- [[Writing Policies]] -- How to write policy YAML files
- [[Writing Trace Adapters]] -- How to integrate your agent framework
- [[Trust Pipeline]] -- Deep dive into how the primitives compose
