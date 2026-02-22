# RFC-NNN: [Title]

**Status:** draft | proposed | accepted | rejected | implemented | withdrawn
**Author:** [Name]
**Created:** [YYYY-MM-DD]
**Updated:** [YYYY-MM-DD]

## Summary

One paragraph describing the proposed change.

## Motivation

Why is this change needed? What problem does it solve? Link to issues, user reports, or architectural constraints that motivate this work.

## Detailed Design

### Overview

High-level description of the proposed design.

### Data Model Changes

Describe any changes to the TraceEvent schema, Policy format, or other data structures. Include before/after schemas where applicable.

### API Changes

Describe any new or modified APIs (CLI commands, SDK methods, adapter interfaces).

### Behavioral Changes

Describe how the system's behavior changes. Include specific scenarios and expected outcomes.

### Migration Path

If this RFC changes existing behavior, describe how users and existing data migrate to the new behavior.

## Alternatives Considered

Describe at least two alternative approaches and explain why this proposal is preferred.

| Alternative | Pros | Cons | Reason Not Chosen |
|---|---|---|---|
| Alternative A | ... | ... | ... |
| Alternative B | ... | ... | ... |

## Security Implications

Describe any impact on the [threat model](../10_architecture/threat_model.md). Address:

- Does this change introduce new attack surface?
- Does this change affect Trust Boundaries?
- Does this change affect Redaction or Hash Chain integrity?

If there are no security implications, explicitly state: "No security implications identified."

## Rollout Plan

1. Implementation steps (ordered)
2. Feature flag requirements (if any)
3. Testing requirements (unit, integration, golden trace)
4. Documentation updates required

## Open Questions

List unresolved questions that need discussion before this RFC can be accepted.

---

## RFC Process

### Numbering

RFCs are numbered sequentially: `RFC-001`, `RFC-002`, etc. File naming: `RFC-NNN-short-title.md`.

### Status Lifecycle

```
draft → proposed → accepted → implemented
                 ↘ rejected
draft → withdrawn
```

- **draft** — Initial authoring, not yet ready for review.
- **proposed** — Submitted as a pull request for review and discussion.
- **accepted** — Approved by maintainers. Implementation may begin.
- **rejected** — Not accepted. The RFC documents the reasoning for rejection.
- **implemented** — The RFC has been fully implemented and verified.
- **withdrawn** — Withdrawn by the author before a decision was made.

### Submission

1. Copy this template to `docs/40_rfc/RFC-NNN-short-title.md`
2. Fill in all sections
3. Submit as a pull request with the label `rfc`
4. Address review feedback
5. Maintainers update status upon decision
