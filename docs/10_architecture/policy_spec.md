# Policy Specification

**API Version:** `krynix.dev/v1`

## Purpose
Define policy contract semantics and enforcement boundaries for Krynix OSS.

## Where Used
- CI trust gates (`krynix evaluate`).
- Policy authoring and validation workflows.
- Runtime integration planning (external wrappers/guards).

## Guarantees (Current)
- [CURRENT] YAML policies parse and validate against v1 schema expectations.  
  Evidence: `packages/policy/src/parser.ts`, `packages/policy/src/parser.test.ts`
- [CURRENT] Rule matching supports deterministic operators and ordered first-match-wins behavior.  
  Evidence: `packages/policy/src/matcher.ts`, `packages/policy/src/matcher.test.ts`
- [CURRENT] Verdict and severity map to stable CLI exit codes for CI gates.  
  Evidence: `packages/policy/src/evaluator.ts`, `packages/cli/src/evaluate.ts`
- [CURRENT] Primary enforced path in OSS is CI/post-run evaluation against trace artifacts.  
  Evidence: `packages/cli/src/evaluate.ts`, `packages/cli/src/router.ts`
- [PARTIAL] Runtime evaluation can be integrated externally but is not a built-in mandatory inline OSS gate.
- [CURRENT] Enforcement hierarchy: deterministic hard controls > policy-based controls > advisory intelligence. Advisory signals alone must not be sole basis for critical denial unless configured by deployment profile.
  Evidence: `docs/10_architecture/platform_architecture_spec.md` §Enforcement Hierarchy

## Planned Guarantees (Future)
- [PLANNED] First-class runtime policy execution profile integration with input/runtime/output guards.
- [PLANNED] Expanded policy metadata governance and stronger runtime-safe policy bundle workflows.

## Non-Goals
- [CURRENT] Policy engine does not execute tools or orchestrate agents.  
  Evidence: `docs/00_overview/non_goals.md`
- [CURRENT] Policy evaluation alone does not guarantee malicious-intent detection accuracy.  
  Evidence: `docs/10_architecture/platform_architecture_spec.md`

## Interfaces / Contracts

### Policy Schema (v1)
```yaml
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: string
  version: string
  description: string
  labels:            # optional
    key: value
spec:
  scope:
    agents: [string]
    event_types: [string]
  rules:
    - id: string
      description: string
      match:
        event_type: string
        payload:
          - field: string
            operator: eq|neq|in|not_in|matches|contains|exists
            value: any
      action: allow|deny|require-approval
      severity: info|warning|error|critical
      ci_failure: boolean
      message: string
      on_violation:
        notify: [string]
        create_issue: boolean
  defaults:
    unmatched_action: allow|deny
    unmatched_severity: info|warning
```

### Verdict And Exit Code Contract
- `pass` -> `0`
- `fail` with `error` -> `1`
- `fail` with `critical` -> `2`
- `require-approval` -> `3`

### Runtime + CI Semantics
- `CURRENT`: CI/post-run trace evaluation is normative in OSS.
- `PARTIAL`: runtime integration is possible via external wrappers using the same policy semantics.
- `PLANNED`: tighter runtime-native profile integration in platform layers.

## Operational Usage
```bash
# Validate policy syntax
krynix validate --policy policies/

# Evaluate one trace against policy set
krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Test policy behavior against sample trace
krynix policy test --policy policies/no-shell.policy.yaml --trace traces/session.trace.jsonl
```

## Known Gaps And Roadmap
- [PARTIAL] Runtime enforcement semantics are integration-specific today.
- [PARTIAL] Some metadata typing strictness still requires hardening across policy tooling.
- [PLANNED] Policy bundles for layered runtime enforcement profiles.
- [PLANNED] Deployment-mode-aware policy semantics (behavior varies across passive, sidecar, hybrid modes).
