# Runbook: IDE Sidecar Onboarding

> **Status:** The sidecar deployment mode described in this runbook is [PLANNED]. See [platform_architecture_spec.md](../10_architecture/platform_architecture_spec.md) for current deployment mode status.

## Purpose
Provide a step-by-step onboarding guide for IDE-centric sidecar integration.

## Prerequisites
- Node.js and pnpm installed.
- Krynix workspace checked out and built.
- Team policy directory available.
- Sidecar profile decision (`dev/staging/prod`).

## Setup Steps
1. Configure sidecar config file `.krynix/sidecar.yaml`.
2. Set `policies.path` to team policy directory.
3. Set `storage.trace_dir` per workspace/repo.
4. Enable protected command list.
5. Enable prompt/response body capture only if required by policy.

## Minimal Commands
```bash
# Build and verify docs/cli references
pnpm build

# Local trust checks
krynix evaluate --trace traces/local.trace.jsonl --policy policies/
krynix replay --verify --trace traces/local.trace.jsonl --golden-dir test/golden/
```

## Expected Artifacts
- `traces/<session>.trace.jsonl`
- evaluation output JSON
- replay output/divergence report
- approval decisions with rationale (if triggered)

## Troubleshooting
- Sidecar unavailable:
  - check profile behavior and local sidecar process status.
- Missing prompt/output events:
  - verify host integration supports those taps.
  - fallback to metadata-only mode + tool/file evidence.
- Frequent approval prompts:
  - tune noisy rules or scope constraints in policy pack.

## Rollback / Disable Switches
- Set profile to `dev` for monitor-only.
- Temporarily disable protected command interception for local debugging.
- Disable raw body capture (`prompt_body: off`, `response_body: off`).
