---
name: ci
description: Run the full CI check sequence locally (typecheck, lint, format, docs, test, build)
allowed-tools: Bash
user-invocable: true
---

Run the full Krynix CI check sequence locally. This mirrors what GitHub Actions runs.

Execute each step sequentially, stopping on first failure:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm docs:check && pnpm test && pnpm build
```

Report:
- Pass/fail for each step
- Total test count
- Any errors with relevant output
