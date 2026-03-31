---
paths:
  - "packages/*/src/**/*.ts"
---

# Security Rules

Krynix is a trust infrastructure tool. Security integrity is foundational.

## Cryptographic Integrity
- Hash chain uses ONLY `@krynix/core` canonical JSON + SHA-256 — never reimplemented
- `SeededRandom` algorithm is LOCKED — changing it breaks all golden traces
- No use of `Math.random()` where determinism is required

## Input Validation
- All external inputs (CLI args, trace events, policy YAML) validated against schemas
- No unchecked type assertions (`as unknown as X`) on external data
- JSON parsing wrapped in try/catch with typed error handling
- Regex patterns anchored to prevent partial matches

## Secret Handling
- No hardcoded secrets, API keys, or tokens in source
- Redaction patterns catch common secret field names
- Test fixtures contain no real credentials
- `.env` files never committed (protected by hook)

## Dependency Hygiene
- `@krynix/core` has minimal deps (ajv only) — keep it that way
- No `eval()`, `Function()`, or dynamic code execution
- No `child_process.exec()` with user-controlled strings
- Every new dependency requires justification

## File System Safety
- File paths validated and sanitized before use
- No path traversal (`../` rejected in user input)
- Trace output paths restricted to expected directories

## Error Information
- CLI errors show actionable messages, not raw stack traces
- Policy evaluation errors don't leak trace content
- No system paths or internal state in user-facing errors
