---
paths:
  - "packages/*/src/**/*.test.ts"
  - "test/**/*"
---

# Testing Rules

## Framework

Vitest with colocated test files (`hash-chain.ts` → `hash-chain.test.ts`).

## Requirements

- Every public function (exported from `index.ts`) must have at least one test.
- Tests must be deterministic: no network calls, no wall-clock dependencies, no unseeded randomness.
- Test names describe behavior, not implementation.
- Use Arrange-Act-Assert structure.

## Golden Traces

Golden trace files are stored in `test/golden/` and validated via the replay engine.

## CI Gate

Before any commit, verify locally:
```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm test && pnpm build
```

This is the exact sequence CI runs. Never commit without passing this locally.

## Schema Changes

Schema-affecting changes require all three:
1. Spec updates
2. Fixture updates
3. Test updates
