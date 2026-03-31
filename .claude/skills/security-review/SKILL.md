---
name: security-review
description: Run a security-focused review of recent changes using the security-reviewer agent
allowed-tools: Bash, Read, Grep, Glob, Agent
user-invocable: true
context: fork
agent: security-reviewer
---

# Security Review

Run a security-focused review of recent changes.

1. Get the diff: `git diff main...HEAD` or `git diff --staged`
2. Identify files with security-relevant changes (auth, input handling, crypto, file I/O, external interfaces)
3. Review each changed file against the security checklist
4. Report findings with severity levels
