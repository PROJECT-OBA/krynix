# PR Review Process

This document defines the pull request review requirements for Krynix.

## Review Checklist

Every PR reviewer must verify:

### Code Quality
- [ ] Code follows [code-style.md](../../.claude/rules/code-style.md) conventions
- [ ] No circular dependencies introduced
- [ ] File size within limits (300-line soft, 500-line hard)
- [ ] Functions are pure where possible
- [ ] Public APIs have JSDoc documentation

### Tests
- [ ] New public functions have tests
- [ ] Tests are deterministic (no network, no wall-clock, no unseeded randomness)
- [ ] Test names describe behavior, not implementation
- [ ] All tests pass in CI

### Trace Tests
- [ ] PRs touching `packages/core/` include hash chain test updates if applicable
- [ ] PRs touching trace-related logic include or update golden traces in `test/golden/`
- [ ] Golden trace regenerations are documented in the PR description with justification

### Policy Gate
- [ ] All `.policy.yaml` changes are reviewed for severity downgrades
- [ ] Rule ordering changes are reviewed for semantic impact (first-match-wins)
- [ ] Scope widening (`agents`, `event_types`) is intentional
- [ ] `defaults.unmatched_action` changes from `deny` to `allow` are flagged

### CI Requirements
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes
- [ ] `krynix evaluate` passes against all policies
- [ ] `krynix replay --verify` passes against all golden traces

## Security Review

PRs require an additional security-focused review when they:

| Condition | Reason |
|---|---|
| Modify `packages/core/src/hash-chain.ts` | Hash chain integrity is security-critical |
| Modify `packages/core/src/redaction.ts` | Redaction protects sensitive data |
| Modify `packages/policy/` evaluation logic | Policy engine is a Trust Boundary |
| Add or modify Trace Adapter event mapping | Adapters are the input boundary |
| Change policy file conventions or schema | Policy format changes affect all consumers |
| Modify CI pipeline configuration | CI enforcement is the primary trust mechanism |

Security reviews must be performed by a reviewer with the `security` label or CODEOWNERS membership for the affected paths.

## Review Expectations

### Turnaround

- Initial review within one business day
- Follow-up reviews within one business day of author response

### Scope

- Reviewers are responsible for correctness, security, and style
- Reviewers should call out missing tests, not just incorrect tests
- Reviewers should verify cross-document consistency when documentation is changed

### Approval

- One approval required for standard PRs
- Two approvals required for security-sensitive PRs (see above)
- CODEOWNERS rules enforce required reviewers for protected paths

## Merge Requirements

- Squash merge to `main`
- Commit message follows [conventional commit format](commit_conventions.md)
- All CI checks pass
- Required approvals obtained
- No unresolved review comments
