# CI Checker Memory

## Last Known Passing State
- Branch: chore/production-readiness
- All 6 CI steps passed cleanly on 2026-04-04
- Test count: 1058 tests across 75 test files
- Test duration: ~3.3s

## Step Behavior Notes

### typecheck
- Uses `tsc -b` with project references across all 6 packages
- Passes cleanly on current branch; no known recurring issues

### lint
- Runs `eslint 'packages/*/src/**/*.ts'`
- No output = pass; has not failed in observed runs

### format:check
- Runs Prettier on `packages/*/src/**/*.ts`
- Clean on current branch

### docs:check
- 5 sub-checks: links, terminology, claim-tags, readme-consistency, phase1-backlog
- All pass on current branch (69 markdown files checked)

### test
- Vitest v3.2.4; 75 test files, 1058 tests
- Includes type checking via `tsc` and `vue-tsc` (experimental)
- Integration tests in `test/integration/` cover CLI binary, full pipeline, e2e scenarios
- cli-binary.test.ts is slowest (~1.6s)

### build
- Uses tsup for all 6 packages (core, policy, replay, adapter-langchain, adapter-openclaw, cli)
- Builds ESM + CJS + DTS for each
- cli also builds a standalone bundle at `dist/standalone/main.cjs`
- Build order: core first (no deps), then policy/replay/adapters in parallel, then cli last

## Failure Patterns
No failures observed yet. Will update as patterns emerge.

## Detailed Notes
- See [patterns.md](patterns.md) for extended notes (created when failures occur)
