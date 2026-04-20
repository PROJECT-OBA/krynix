# @krynix/cli

Command-line interface for [Krynix](https://github.com/PROJECT-OBA/krynix) — policy evaluation, trace verification, behavioral diff, and compliance reporting.

## Install

```bash
npm install -g @krynix/cli
```

## Commands

```bash
# Evaluate a trace against policies (CI gate)
krynix evaluate --trace run.jsonl --policy security.policy.yaml

# Compare two traces for behavioral drift
krynix diff --baseline golden.jsonl --candidate new.jsonl

# Verify trace integrity
krynix replay --trace run.jsonl --verify

# Sign a trace with Ed25519
krynix sign --trace run.jsonl --private-key key.pem

# Generate a signing keypair
krynix keygen --output ./keys

# Validate policy file syntax
krynix validate --policy security.policy.yaml

# Compute trace analytics
krynix stats --trace run.jsonl

# Export to OpenTelemetry format
krynix export --trace run.jsonl --format otlp
```

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success / all policies pass |
| `1` | Policy violation (error) or runtime error |
| `2` | Policy violation (critical) |
| `3` | Requires approval |

## License

MIT
