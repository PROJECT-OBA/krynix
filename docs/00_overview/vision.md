# Vision

## Problem Statement
Agentic systems need verifiable evidence of what happened, what was allowed, and where behavior changed over time.

## Vision
Krynix is the trust spine for agentic systems.

- `CURRENT`: provides trace integrity, policy CI evaluation, replay integrity checks.
- `PARTIAL`: baseline drift comparison exists as library function (`compareTraces`), not yet CLI-integrated; integration-driven runtime guard usage.
- `PLANNED`: expands toward deeper input/runtime/output trust controls and execution replay.

## Core Principles
1. Evidence-first architecture: record and verify artifacts before asserting trust.
2. CI-first enforcement: policy outcomes are enforceable via deterministic exit codes.
3. Truthful guarantees: distinguish implemented behavior from roadmap behavior.
4. Layer-compatible design: fit into input/runtime/output platform layers without replacing orchestration runtimes.

## Target Users
- Platform and security engineering teams operating AI agents in CI-governed repositories.
- Teams needing transparency, policy control, and regression visibility for agent behavior.

## Product Layers
- OSS engine (this repository): trust spine artifacts and verification workflows.
- Planned Control Plane: centralized governance around those artifacts.

## v1 Directional Success Criteria
- `CURRENT`: stable trace + policy + replay integrity workflows.
- `PARTIAL`: drift comparison library exists (`compareTraces`); CLI integration is planned.
- `PLANNED`: decision-ready contracts for layered runtime controls.
