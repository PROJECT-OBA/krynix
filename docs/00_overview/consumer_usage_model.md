# Consumer Usage Model

## Purpose
Explain how different consumer teams adopt and operate Krynix in real workflows.

## Where Used
- Onboarding playbooks.
- Rollout planning from monitor to enforced profiles.
- Incident response and trace-based triage.

## Guarantees (Current)
- [CURRENT] Consumers can produce trace artifacts and run policy/replay verification in CI today.  
  Evidence: `packages/core/src/session.ts`, `packages/cli/src/evaluate.ts`, `packages/cli/src/replay.ts`
- [PARTIAL] Runtime enforcement outcomes depend on integration profile and host capabilities.

## Planned Guarantees (Future)
- [PLANNED] Execution replay for deterministic live-path re-validation.
- [PLANNED] Expanded managed integration options and control-plane workflows.

## Non-Goals
- [CURRENT] This model does not require runtime package API changes.  
  Evidence: `docs/10_architecture/platform_architecture_spec.md`
- [CURRENT] This model does not assume full OSS runtime inline blocking by default.  
  Evidence: `docs/10_architecture/policy_spec.md`

## Interfaces / Contracts

### Persona 1: Platform/Security Team
Onboarding checklist:
- Define policy baseline and severity mappings.
- Define environment profile defaults (`dev/staging/prod`).
- Define trace storage and retention conventions.

Minimum commands:
```bash
krynix evaluate --trace <trace> --policy policies/
krynix replay --verify --trace <trace> --baseline <golden>
```

Required artifacts:
- `.trace.jsonl`
- policy files
- replay report output (from CLI result)
- optional compliance bundle

Incident/triage workflow:
1. confirm hash integrity,
2. inspect violating rule(s),
3. compare against baseline drift,
4. classify as policy regression, runtime behavior drift, or allowed change.

Rollout:
- start in monitor mode,
- enable require-approval in staging,
- enable deny for deterministic critical rules in prod.

### Persona 2: Application Agent Team
Onboarding checklist:
- Integrate adapter/plugin hooks.
- Emit context + tool + output mapping metadata.
- Add CI trust gate job.

Minimum commands:
```bash
krynix evaluate --trace traces/session.trace.jsonl --policy policies/
krynix replay --verify --trace traces/session.trace.jsonl
```

Required artifacts:
- session trace,
- policy set,
- baseline trace per scenario,
- CI logs for verdicts.

Incident/triage workflow:
1. inspect first failing event,
2. inspect linked tool call/result,
3. compare baseline and current traces,
4. decide policy update vs behavior fix.

Rollout:
- feature branches in monitor mode,
- PR gates in staging,
- production gates with agreed critical deny rules.

### Persona 3: IDE-Centric Developer Team
Onboarding checklist:
- install sidecar integration,
- configure per-workspace trace path,
- configure lightweight local policy checks.

Minimum commands:
```bash
krynix evaluate --trace traces/local.trace.jsonl --policy policies/
krynix replay --verify --trace traces/local.trace.jsonl --baseline test/golden/task-baseline.trace.jsonl
```

Required artifacts:
- local task trace,
- baseline scenario traces,
- output mapping/provenance metadata fields.

Incident/triage workflow:
1. review task session trace,
2. check guard decisions,
3. inspect output mapping classification,
4. escalate to require-approval path for uncertain tasks.

Rollout:
- local monitor-only first,
- team-level staging with require-approval,
- production repository gates for critical deterministic rules.

## Operational Usage
Common deployment progression:
1. Local evidence capture.
2. Policy/replay checks in PR CI.
3. Profiled runtime enforcement adoption by environment.

## Known Gaps And Roadmap
- [PARTIAL] Cross-platform host integration quality varies.
- [PLANNED] Unified onboarding templates for sidecar and framework paths.
- [PLANNED] Deeper provenance analytics and execution replay assurance.
