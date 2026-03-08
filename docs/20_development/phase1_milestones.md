# Phase 1 Milestones

## Purpose
Define milestone-level outcomes and dependencies for Phase 1 implementation.

## Milestone Index
| Milestone | Title | Target Outcome | Depends On |
|---|---|---|---|
| M1.1 | Sidecar API Scaffold | Local sidecar endpoints defined and test harnessed | D0 docs lock |
| M1.2 | Session/Event Persistence | Deterministic trace emission through sidecar flow | M1.1 |
| M1.3 | Profile Enforcement | `dev/staging/prod` runtime behavior implemented | M1.1, M1.2 |
| M2.1 | Protected Command Interception | Shim intercepts protected commands safely | M1.1 |
| M2.2 | Precheck + Approval Flow | allow/deny/require-approval runtime loop complete | M1.3, M2.1 |
| M2.3 | Post-Execution Evidence | tool_result evidence reliably emitted | M2.1 |
| M3.1 | IDE Session Orchestration | IDE path emits consistent session boundaries | M1.2 |
| M3.2 | Prompt/Output Signal Forwarding | metadata capture from IDE integrations stabilized | M3.1 |
| M3.3 | Local Approval UX | local approval UI integrated with trace evidence | M2.2, M3.2 |
| M4.1 | CI Template Standardization | reusable CI trust gate templates adopted | D0 docs lock |
| M4.2 | Baseline Drift Gate | baseline replay gate standardized in CI | M4.1 |
| M4.3 | Ops Metrics | weekly trust metrics pipeline established | M4.1, M4.2 |
| M5.1 | OpenClaw Hardening | runtime adapter stability and ordering guarantees | M1.2 |
| M5.2 | Custom Adapter Starter Kit | reusable adapter template + tests | M5.1 |
| M5.3 | Multi-Tenant Conventions | tenant-safe naming/storage policy enforced | M5.1, M4.1 |

## Exit Criteria
- Milestones used as roadmap checkpoints in weekly reviews.
- Every milestone mapped to tasks in `phase1_backlog.md`.
