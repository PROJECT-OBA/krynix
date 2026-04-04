# @krynix/cli

Command-line interface for Krynix. Evaluate traces against policies, verify integrity, compute analytics, and export to OpenTelemetry — all from the terminal.

## Commands

### Local (offline, no auth required)

| Command | Purpose |
|---------|---------|
| `krynix evaluate --trace <file> --policy <path>` | Evaluate a trace against policies |
| `krynix replay --verify --golden-dir <dir>` | Verify trace integrity |
| `krynix validate --policy <path>` | Validate policy file syntax |
| `krynix stats --trace <file>` | Compute per-session analytics |
| `krynix export --trace <file> --format otlp-json` | Export trace to OpenTelemetry |
| `krynix policy test --policy <file> --trace <file>` | Test a policy against a trace |
| `krynix policy diff --old <file> --new <file>` | Compare two policies |

### Control Plane (`PLANNED` — requires configured endpoint + auth)

| Command | Purpose |
|---------|---------|
| `krynix auth login` | Authenticate |
| `krynix push --trace <file>` | Upload artifacts |
| `krynix policy pull` / `push` | Sync policies with registry |
| `krynix golden promote` / `list` / `pull` | Manage golden traces |
| `krynix compliance export` / `verify` | Compliance evidence bundles |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success (including non-CI-failing violations) |
| `1` | CI-failing violation (error severity) or runtime error |
| `2` | CI-failing violation (critical severity) |
| `3` | Requires approval |

## Standalone Binary

A self-contained binary (no `node_modules` needed) can be built with:

```bash
./scripts/build-standalone.sh
node dist/krynix --version
```

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
