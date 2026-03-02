# CLI Reference

Canonical semantics source: `packages/cli/src/help.ts`.

## Replay
```text
Usage: krynix replay [--verify|--regenerate] [--trace <file>|--golden-dir <dir>] [--baseline <file>] [--verbose]
```

- `CURRENT` `--verify`: validates trace integrity and structure.
- `PARTIAL` `--baseline`: compares `--trace` against baseline to detect drift.
- `CURRENT` `--regenerate`: recomputes hashes for traces.

Examples:
```bash
krynix replay --verify --trace traces/session.trace.jsonl
krynix replay --verify --trace traces/current.trace.jsonl --baseline traces/golden.trace.jsonl
krynix replay --verify --golden-dir test/golden/
krynix replay --regenerate --trace traces/session.trace.jsonl
```

## Evaluate
```bash
krynix evaluate --trace traces/session.trace.jsonl --policy policies/
```

Exit codes:
- `0` pass
- `1` runtime error
- `2` policy violation
- `3` requires approval
