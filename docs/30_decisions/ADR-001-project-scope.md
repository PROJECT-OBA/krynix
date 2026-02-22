# ADR-0001: Define ARTL Scope

## Status
Accepted

## Context

We need to clearly define the boundaries of ARTL
to avoid scope creep and architectural drift.

## Decision

ARTL will focus on:

- Trace standardization
- Policy enforcement
- Deterministic replay
- CI evaluation

ARTL will NOT:

- Implement agent frameworks
- Provide UI dashboards
- Replace model providers

## Consequences

+ Clear architectural boundaries
+ Easier long-term maintainability
- Some feature requests may be rejected