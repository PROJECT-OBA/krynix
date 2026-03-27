---
name: review-pr
description: Review a pull request against Krynix project standards
allowed-tools: Bash, Read, Grep, Glob, Agent
user-invocable: true
argument-hint: [PR number]
---

Review PR #$ARGUMENTS against Krynix project standards.

## Steps

1. Get PR details: `gh pr view $ARGUMENTS`
2. Get the diff: `gh pr diff $ARGUMENTS`
3. Analyze changes against the project's standards

## Review Checklist

- [ ] Tests added or updated (or N/A explained)
- [ ] Behavior claims match implementation evidence
- [ ] Capability labels (`CURRENT`/`PARTIAL`/`PLANNED`) present where required
- [ ] `CURRENT` claims in canonical docs include `Evidence:` lines
- [ ] Canonical docs remain source-of-truth
- [ ] README/wiki/agent rule docs are aligned
- [ ] CI checks pass
- [ ] Determinism constraints preserved
- [ ] No dependency bloat without justification
- [ ] Package dependency direction respected

## Output Format

### Overview
What the PR does.

### Issues
- **[severity]** `file:line` — description

### Checklist Results
Pass/fail for each checklist item.
