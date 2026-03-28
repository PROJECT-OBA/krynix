---
name: test-package
description: Run tests for a specific package by name or detect from current working directory
allowed-tools: Bash, Read, Glob
user-invocable: true
argument-hint: [package-name]
---

Run tests for a single package.

## Arguments

- `$ARGUMENTS`: optional package name (e.g., `core`, `policy`, `adapter-langchain`)
- If no argument provided, detect the package from the current working directory

## Steps

1. Determine the target package:
   - If `$ARGUMENTS` is provided, use it as the package name (prefix with `@krynix/` if not already prefixed)
   - If no argument, check if cwd is inside a `packages/*/` directory and use that package name
   - If neither works, list available packages and ask which to test
2. Run `pnpm --filter @krynix/<package> test`
3. Report test results: pass count, fail count, and any failure details

## Available Packages

- `@krynix/core`
- `@krynix/policy`
- `@krynix/replay`
- `@krynix/adapter-openclaw`
- `@krynix/adapter-langchain`
- `@krynix/cli`
