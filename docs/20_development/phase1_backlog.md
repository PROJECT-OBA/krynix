# Phase 1 Backlog (Canonical)

## Purpose
Track implementation work in a decision-complete Epic -> Milestone -> Task hierarchy.

## Source Of Truth
This document is canonical for Phase 1 scope and sequencing. GitHub issues mirror these tasks.

## Status Legend
- `todo`
- `in_progress`
- `blocked`
- `done`

## Epic E1: Sidecar Core (`@krynix/sidecar`)

### Milestone M1.1: sidecar local API scaffold
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E1-M1.1-T1.1 | define request/response schemas | all endpoints documented with examples and invariants | TBD | todo |
| PH1-E1-M1.1-T1.2 | session lifecycle endpoint implementation | start/end lifecycle path produces valid trace bookends | TBD | todo |

### Milestone M1.2: session/event persistence integration
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E1-M1.2-T1.3 | event ingestion validation + namespace checks | invalid events rejected; namespace rules enforced | TBD | todo |

### Milestone M1.3: profile enforcement and failure policy
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E1-M1.3-T1.4 | policy precheck decision endpoint | allow/deny/require-approval behavior profile-aware | TBD | todo |
| PH1-E1-M1.3-T1.5 | approval endpoint and evidence persistence | approval decisions recorded with rationale/evidence refs | TBD | todo |
| PH1-E1-M1.3-T1.6 | transport hardening (UDS + loopback fallback) | local transport strategy works across target environments | TBD | todo |

## Epic E2: Command Shim Layer (`@krynix/shim`)

### Milestone M2.1: protected command interception
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E2-M2.1-T2.1 | shim invocation contract + env passthrough | wrapped commands preserve expected environment semantics | TBD | todo |
| PH1-E2-M2.1-T2.2 | protected command config integration | command list loaded and enforced by profile | TBD | todo |

### Milestone M2.2: precheck integration + deny/approval flow
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E2-M2.2-T2.3 | pre-exec block/approval UX | risky actions trigger deterministic decision path | TBD | todo |

### Milestone M2.3: post-exec evidence emission
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E2-M2.3-T2.4 | tool_result capture with duration/exit code | result events consistently persisted for wrapped commands | TBD | todo |
| PH1-E2-M2.3-T2.5 | audit-safe error handling | failures produce traceable non-secret error evidence | TBD | todo |

## Epic E3: IDE Sidecar Integration (`@krynix/ide-vscode`, optional but tracked)

### Milestone M3.1: session orchestration hooks
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E3-M3.1-T3.1 | workspace/repo context emitter | sidecar session includes actor/workspace/repo context | TBD | todo |

### Milestone M3.2: prompt/output metadata forwarding
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E3-M3.2-T3.2 | prompt ingress metadata capture | observable prompt signals captured without hidden-reasoning claims | TBD | todo |
| PH1-E3-M3.2-T3.3 | output mapping event emission | output classification/provenance emitted when host supports it | TBD | todo |

### Milestone M3.3: local approval UI integration
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E3-M3.3-T3.4 | approval modal + rationale capture | approval actions include actor/time/reason in evidence | TBD | todo |
| PH1-E3-M3.3-T3.5 | fallback mode when hooks unavailable | metadata-only fallback produces usable trust artifacts | TBD | todo |

## Epic E4: CI Trust Gates + Governance

### Milestone M4.1: reusable CI templates
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E4-M4.1-T4.1 | CI templates for evaluate + replay baseline | template adopted in target repos and passes consistently | TBD | todo |

### Milestone M4.2: baseline drift gate standardization
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E4-M4.2-T4.2 | gate policy for unresolved approvals | unresolved approvals block in staging/prod by default | TBD | todo |

### Milestone M4.3: operations metrics/reporting
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E4-M4.3-T4.3 | metrics extraction script and weekly report | weekly trust KPI report generated and reviewed | TBD | todo |
| PH1-E4-M4.3-T4.4 | evidence bundle integration guidance | compliance/evidence guidance validated in runbook | TBD | todo |

## Epic E5: Runtime Adapter Expansion

### Milestone M5.1: OpenClaw hardening
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E5-M5.1-T5.1 | concurrent hook ordering guarantees | no hash/order corruption under concurrent hook load | TBD | todo |

### Milestone M5.2: custom adapter starter kit
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E5-M5.2-T5.2 | adapter test harness template | new adapter can validate contract conformance quickly | TBD | todo |

### Milestone M5.3: multi-tenant storage conventions
| Task ID | Task | Acceptance Criteria | Issue | Status |
|---|---|---|---|---|
| PH1-E5-M5.3-T5.3 | tenant-safe path strategy docs + checks | collision-safe tenant path strategy documented and linted | TBD | todo |
| PH1-E5-M5.3-T5.4 | runtime profile compliance matrix | profile matrix enforced across runtime integrations | TBD | todo |

## GitHub Issue Mirroring Rules
1. Every task uses ID format: `PH1-E{n}-M{n}.{n}-T{n}.{n}`.
2. GitHub issue title prefix must include the task ID.
3. Issue body must link back to this backlog row.
4. PR must reference the issue and include acceptance criteria checklist.
5. Weekly checkpoint entries must include completed tasks, blockers, risk changes, and scope changes.

## Ownership And Cadence
- Canonical update owner: platform/security doc owners.
- Weekly checkpoint updates required in `weekly_checkpoints.md`.
