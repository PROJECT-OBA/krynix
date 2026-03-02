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

### Common Runtime Enforcement Profiles
- `dev`: monitor-only (fail-open for tracing/guard errors unless explicitly configured otherwise).
- `staging`: require-approval on medium/high risk.
- `prod`: deny deterministic critical violations only; require-approval for uncertain signals.

### Blueprint A: IDE Sidecar (VSCode/Codex-style)

Where it runs:
- Local developer workstation.
- Remote dev container.

Hook points:
- Session start/end around each agent task.
- Before/after tool invocation interception.
- Model input/output taps if available from host tooling.

Capture contract:
- Context: actor, workspace path, repo slug, branch/SHA, environment.
- Input signals: intent score, prompt guard outcomes, system-context checks.
- Runtime signals: tool call envelopes, scan outcomes, approvals.
- Output signals: response mapping + provenance reference.

Artifact flow:
1. `startSession({ agentId, replaySeed?, outputPath, metadata, environment })`
2. Stream `recordEvent(...)` for lifecycle/tool/decision/observation events.
3. `endSession(...)` to finalize `.trace.jsonl`.
4. Local checks:
   - `krynix evaluate --trace <trace> --policy <policy-dir>`
   - optional `krynix replay --verify --trace <trace> --baseline <baseline>`
5. CI gate on PR with same commands.

Failure behavior:
- Tracing failure:
  - `dev`: fail-open + emit `error` trace event if possible.
  - `staging/prod`: fail-closed for required controls.
- Guard uncertainty:
  - route to `require-approval` decision.

### Blueprint B: Framework Adapter (OpenClaw/custom)

Where it runs:
- Agent runtime process.
- Worker/service process running framework callbacks.

Hook points:
- `session_start`
- `session_end`
- `before_tool_call`
- `after_tool_call`
- `llm_input`
- `llm_output`

Contract:
- Adapter emits canonical trace-event shape only.
- Core assigns sequence/event IDs and hash chain values.
- Write queue is required to preserve ordering under concurrent hooks.

Artifact flow:
1. Initialize adapter/plugin.
2. Begin session and capture hook-derived events.
3. Finalize trace artifact at session end.
4. CI evaluates:
   - policy gate (`evaluate`)
   - replay integrity (`replay --verify`)
   - optional drift gate (`--baseline`)

Multi-tenant notes:
- Namespace trace paths by org/project/agent/session.
- Enforce path-safe and collision-safe naming.
- Keep per-tenant policy directories and trace retention boundaries.

## Operational Usage
```bash
# Sidecar or runtime-produced trace
krynix evaluate --trace traces/<tenant>/<session>.trace.jsonl --policy policies/
krynix replay --verify --trace traces/<tenant>/<session>.trace.jsonl

# Optional drift gate
krynix replay --verify --trace traces/<tenant>/<session>.trace.jsonl --baseline test/golden/<scenario>.trace.jsonl
```

## Known Gaps And Roadmap
- [PARTIAL] Runtime-preventative behavior depends on host wiring quality and policy calibration.
- [PLANNED] Managed integration packages for broader IDE/runtime ecosystems.
- [PLANNED] Execution replay mode to strengthen post-run assurance.
