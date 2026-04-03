# ADR-001: Define Krynix Scope

## Status
Accepted

## Context

We need to clearly define the boundaries of Krynix
to avoid scope creep and architectural drift.

## Decision

Krynix will focus on:

- Trace standardization
- Policy enforcement
- Deterministic replay ([CURRENT] integrity verification; [PARTIAL] baseline drift comparison via library; [PLANNED] execution replay)
- CI evaluation

Krynix will NOT:

- Implement agent frameworks
- Provide UI dashboards
- Replace model providers

## Consequences

+ Clear architectural boundaries
+ Easier long-term maintainability
- Some feature requests may be rejected
