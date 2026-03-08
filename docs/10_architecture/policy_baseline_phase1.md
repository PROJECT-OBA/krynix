# Policy Baseline: Phase 1

## Purpose
Define an initial safe-by-default policy baseline for rollout while controlling false positives.

## Where Used
- Team/repo default policy packs.
- Runtime profile behavior setup.
- CI gate calibration during onboarding.

## Guarantees (Current)
- [CURRENT] Baseline is documentation guidance and can be represented in existing v1 policy schema.
- [PARTIAL] Rule effectiveness depends on integration signal quality and policy tuning.

## Planned Guarantees (Future)
- [PLANNED] Standardized packaged rule sets with automated drift-safe updates.

## Non-Goals
- [CURRENT] This baseline does not claim zero false positives.
- [CURRENT] This baseline does not replace repo-specific policy customization.

## Interfaces / Contracts

### Rule Pack A: Exfiltration Prevention
Intent:
- detect/block likely secret leakage or unauthorized outbound transfer.

Representative checks:
- outbound tool usage with secret-like arguments,
- writes to unapproved destinations,
- attempts to include credential-like content in egress payloads.

### Rule Pack B: Destructive File/Command Prevention
Intent:
- prevent destructive operations without explicit approval.

Representative checks:
- destructive shell commands,
- mass-delete or force-reset behavior,
- writes outside approved workspace boundaries.

### Severity/Action Mapping by Profile
| Profile | info/warning | error | critical |
|---|---|---|---|
| `dev` | allow + log | require-approval/log | require-approval/log |
| `staging` | allow + log | require-approval | deny or require-approval by policy |
| `prod` | allow + log | require-approval | deny |

### False-Positive Tuning Guidance
1. Start in monitor mode for 3-7 days.
2. Record top noisy rules by frequency.
3. Add scope constraints (agents/event_types/paths) before severity reduction.
4. Keep critical deny rules narrow and deterministic.
5. Require explicit sign-off for any critical-to-warning downgrade.

### Escalation Path
1. Rule flagged in weekly checkpoint.
2. Owner triages with trace evidence.
3. Adjust scope or matching condition.
4. Re-run baseline scenarios in CI.
5. Promote change after review approval.

### Required Evidence Fields for deny/approval
Every deny/require-approval outcome should include:
- `rule_id`
- `severity`
- `message`
- `evidence_refs[]`
- `session_id`
- `sequence_num`
- `approval_request_id` (when applicable)
- `approval_actor` and `approval_reason` (when approved)

## Operational Usage
Baseline rollout order:
1. apply exfil + destructive packs in `dev` monitor mode,
2. move to `staging` with require-approval,
3. enforce prod critical deny baseline.

## Known Gaps And Roadmap
- [PARTIAL] Some environments may lack enough signal quality for aggressive baseline enforcement.
- [PLANNED] Reference policy pack repository and compatibility matrix.
