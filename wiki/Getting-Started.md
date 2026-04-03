# Getting Started

Canonical source: `docs/10_architecture/platform_architecture_spec.md`.

## Install
```bash
git clone https://github.com/PROJECT-OBA/krynix.git
cd krynix
pnpm install
pnpm build
```

## Run Current Trust Checks
```bash
pnpm krynix evaluate --trace traces/session.trace.jsonl --policy policies/
pnpm krynix replay --verify --trace traces/session.trace.jsonl
pnpm krynix replay --verify --golden-dir test/golden/
```

## What These Commands Mean
- `CURRENT`: `evaluate` enforces policy semantics via exit codes.
- `CURRENT`: replay `--verify` checks trace integrity.
- `CURRENT`: `--golden-dir` verifies integrity of all golden traces in a directory.
- `PLANNED`: deterministic execution replay.
