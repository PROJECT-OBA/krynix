# Testing Strategy

## Test Types

1. Unit Tests
2. Integration Tests
3. Golden Trace Tests
4. Determinism Tests

## Golden Trace Tests

Given:
- Input trace
Expect:
- Exact matching evaluation output

If trace schema changes:
- Update fixtures
- Update golden tests

## Determinism

Replay verification must produce identical outputs across runs ([CURRENT] integrity verification; [PARTIAL] baseline drift comparison via library; [PLANNED] execution replay).
No time-based or random behavior without seeding.