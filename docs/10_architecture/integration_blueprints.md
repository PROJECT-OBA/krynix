# Integration Blueprints

## Purpose
Provide decision-complete integration blueprints for consumers using Krynix in IDE-centric and framework-runtime agent environments.

## Where Used
- Platform onboarding.
- Runtime integration implementation planning.
- CI and operations runbook setup.

## Guarantees (Current)
- [CURRENT] Krynix can be integrated as an evidence spine via session + event capture APIs.  
  Evidence: `packages/core/src/session.ts`, `packages/core/src/adapter-types.ts`
- [CURRENT] CI gates are available with `evaluate` and replay integrity verification.  
  Evidence: `packages/cli/src/evaluate.ts`, `packages/cli/src/replay.ts`
- [PARTIAL] Runtime enforcement behavior depends on host integration and profile selection.

## Planned Guarantees (Future)
- [PLANNED] Execution replay mode for deterministic re-run validation.
- [PLANNED] First-class runtime policy profiles baked into managed integrations.

## Non-Goals
- [CURRENT] This blueprint does not introduce new runtime package APIs.  
  Evidence: `docs/10_architecture/platform_architecture_spec.md`
- [CURRENT] This blueprint does not claim OSS runtime blocking as universal default.  
  Evidence: `docs/10_architecture/policy_spec.md`

## Interfaces / Contracts

### Observable-Only Contract For Closed Assistants
Applicable to Copilot/Claude/Codex-style integrations:
- capture observable host signals only,
- no claim on private hidden reasoning internals,
- classify uncertainty as risk/approval signal rather than inferred internal thought.

### Common Runtime Enforcement Profiles
| Profile | Default posture | Sidecar unavailable | Approval timeout |
|---|---|---|---|
| `dev` | Monitor-only | Fail-open + warning evidence | Continue by policy with warning evidence |
| `staging` | Require approval on medium/high risk | Fail-closed for protected controls | Block |
| `prod` | Deny deterministic critical violations | Fail-closed for protected controls | Block |

### Default Critical Deny Baseline (Profile: prod)
Categories:
- exfiltration prevention
- destructive file/command prevention

Examples:
- outbound transmission of secret-like values to unapproved endpoints,
- destructive workspace commands without explicit approval,
- unauthorized writes outside approved workspace boundary.

### Approval Path (Local + CI)
1. Pre-check emits `require-approval` decision with `rule_id` and `evidence_refs`.
2. Local user interaction records approval outcome and rationale.
3. Approval event appended to trace.
4. CI trust gate evaluates completed trace.
5. Unresolved or denied approvals remain blocking in staging/prod.

### Blueprint A: IDE Sidecar (VSCode/Codex-style)

Where it runs:
- local developer workstation,
- remote dev container.

Control boundaries:
- prompt ingress (note: ingress ownership is deployment-specific, not universal),
- tool pre-check,
- tool post-check,
- output egress (when host allows output tap).

Capture contract:
- context: actor, workspace path, repo slug, branch/SHA, environment,
- input signals: intent score, prompt guard outcomes, system-context checks,
- runtime signals: tool call envelopes, scan outcomes, approvals,
- output signals: response mapping + provenance reference.

Artifact flow:
1. `startSession({ agentId, replaySeed?, outputPath, metadata, environment })`
2. Stream `recordEvent(...)` for lifecycle/tool/decision/observation events.
3. `endSession(...)` to finalize `.trace.jsonl`.
4. Local checks:
   - `krynix evaluate --trace <trace> --policy <policy-dir>`
   - optional `krynix replay --verify --golden-dir test/golden/`
5. CI gate on PR with same commands.

Failure behavior:
- tracing failure:
  - `dev`: fail-open + emit `error` trace event when possible,
  - `staging/prod`: fail-closed for required controls.
- guard uncertainty:
  - route to `require-approval` with evidence references.

### Blueprint B: Framework Adapter (OpenClaw/custom)

Where it runs:
- agent runtime process,
- worker/service process running framework callbacks.

Hook points:
- `session_start`
- `session_end`
- `before_tool_call`
- `after_tool_call`
- `llm_input`
- `llm_output`

Contract:
- adapter emits canonical trace-event shape only,
- core assigns sequence/event IDs and hash chain values,
- write queue preserves ordering under concurrent hooks.

Artifact flow:
1. Initialize adapter/plugin.
2. Begin session and capture hook-derived events.
3. Finalize trace artifact at session end.
4. CI evaluates:
   - policy gate (`evaluate`)
   - replay integrity (`replay --verify`)
   - optional golden trace integrity verification (`--golden-dir`)

Multi-tenant notes:
- Namespace trace paths by org/project/agent/session.
- Enforce path-safe and collision-safe naming.
- Keep per-tenant policy directories and trace retention boundaries.

## Operational Usage
```bash
# Sidecar or runtime-produced trace
krynix evaluate --trace traces/<tenant>/<session>.trace.jsonl --policy policies/
krynix replay --verify --trace traces/<tenant>/<session>.trace.jsonl

# Optional golden trace integrity verification
krynix replay --verify --golden-dir test/golden/
```

## Known Gaps And Roadmap
- [PARTIAL] Runtime-preventative behavior depends on host wiring quality and policy calibration.
- [PLANNED] Managed integration packages for broader IDE/runtime ecosystems.
- [PLANNED] Execution replay mode to strengthen post-run assurance.
