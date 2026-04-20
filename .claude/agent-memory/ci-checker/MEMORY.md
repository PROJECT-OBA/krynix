# CI Checker Memory

## Last Known Passing State
- Branch: feat/production-readiness
- All 6 CI steps passed cleanly on 2026-04-08
- Test count: 1163 tests across 78 test files
- Test duration: ~3.60s

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
- 4 sub-checks: links, terminology, claim-tags, readme-consistency
- All pass on current branch (69 markdown files checked)

### test
- Vitest v3.2.4; 78 test files, 1163 tests
- Includes type checking via `tsc` and `vue-tsc` (experimental)
- Integration tests in `test/integration/` cover CLI binary, full pipeline, e2e scenarios
- cli-binary.test.ts is slowest (~1.85s)
- stderr warning from schema-validator.test.ts about strict mode missing type "array" for keyword maxItems — expected, does not cause failure

### build
- Uses tsup for all 6 packages (core, policy, replay, adapter-langchain, adapter-openclaw, cli)
- Builds ESM + CJS + DTS for each
- cli also builds a standalone bundle at `dist/standalone/main.cjs`
- Build order: core first (no deps), then policy/replay/adapters in parallel, then cli last

## Failure Patterns
No failures observed yet. Will update as patterns emerge.

## Detailed Notes
- See [patterns.md](patterns.md) for extended notes (created when failures occur)
