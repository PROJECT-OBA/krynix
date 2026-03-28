---
name: review-pr
description: Review a pull request against Krynix project standards with code-reviewer agent
allowed-tools: Bash, Read, Grep, Glob, Agent
user-invocable: true
context: fork
agent: code-reviewer
argument-hint: [PR number]
---

Review PR #$ARGUMENTS against Krynix project standards.

## Steps

1. Get PR details: `gh pr view $ARGUMENTS`
2. Get the diff: `gh pr diff $ARGUMENTS`
3. Analyze changes against the project's standards

## Review Checklist

- [ ] Tests added or updated for all behavior changes
- [ ] Behavior claims match implementation evidence
- [ ] Capability labels (`CURRENT`/`PARTIAL`/`PLANNED`) present where required
- [ ] Canonical docs remain source-of-truth
- [ ] CI checks pass
- [ ] Determinism constraints preserved
- [ ] No dependency bloat without justification
- [ ] Package dependency direction respected (`core <- policy <- cli`)

## Output Format

### Overview
What the PR does.

### Issues
- **[severity]** `file:line` — description

### Checklist Results
Pass/fail for each checklist item.
