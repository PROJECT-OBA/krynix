# CLI Reference

Canonical semantics source: `packages/cli/src/help.ts`.

## Replay
```text
Usage: krynix replay [--verify|--regenerate] [--trace <file>|--golden-dir <dir>] [--verbose]
```

- `CURRENT` `--verify`: validates trace integrity and structure.
- `PARTIAL` `--golden-dir`: compares `--trace` against golden traces to detect drift.
- `CURRENT` `--regenerate`: recomputes hashes for traces.

Examples:
```bash
krynix replay --verify --trace traces/session.trace.jsonl
krynix replay --verify --trace traces/current.trace.jsonl --golden-dir test/golden/
krynix replay --regenerate --trace traces/session.trace.jsonl
```

## Evaluate
```bash
krynix evaluate --trace traces/session.trace.jsonl --policy policies/
```

Exit codes:
- `0` pass (including non-CI-failing violations)
- `1` CI-failing error-severity violation or runtime error
- `2` CI-failing critical-severity violation
- `3` requires approval (no CI-failing violations)
