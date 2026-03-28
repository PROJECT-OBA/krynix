# @krynix/cli

Command-line interface. Depends on `@krynix/core`, `@krynix/policy`, `@krynix/replay`.

## Local Commands (work offline, no auth required)

| Command | Purpose |
|---------|---------|
| `krynix evaluate --trace <file> --policy <path>` | Evaluate a trace against policies (CI gate) |
| `krynix replay --trace <file>` | Verify trace integrity / regenerate hash chains |
| `krynix validate --policy <path>` | Validate policy file syntax |
| `krynix stats --trace <file>` | Compute per-session analytics from a trace |
| `krynix export --trace <file> --format <fmt>` | Export trace to OpenTelemetry format |
| `krynix policy test --policy <file> --trace <file>` | Test a policy against a sample trace |
| `krynix policy diff --old <file> --new <file>` | Compare two policies for security regressions |

## Control Plane Commands (require configured endpoint + auth)

| Command | Purpose |
|---------|---------|
| `krynix policy pull` | Download policies from registry |
| `krynix policy push --file <path>` | Publish policy to registry |
| `krynix push --trace <file>` | Upload artifacts to Control Plane |
| `krynix compliance export --trace <file> --output <dir>` | Generate compliance evidence bundle |
| `krynix compliance verify --dir <path>` | Verify bundle integrity |
| `krynix golden promote --trace <file> --name <name>` | Register trace as golden in registry |
| `krynix golden list` | List golden traces from registry |
| `krynix golden pull --id <id> --output <file>` | Download a golden trace |
| `krynix auth login --email <email> --password <password>` | Authenticate with email/password |
| `krynix auth logout` | Clear stored credentials |
| `krynix auth status` | Show authentication status |
| `krynix auth create-key` | Create an API key |

Note: These commands perform configuration/credential checks and contact the configured Control Plane endpoint. If no endpoint is configured, they fail with a clear error.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success / all policies pass |
| `1` | Policy violation (error severity) or runtime error |
| `2` | Policy violation (critical severity) |
| `3` | Requires approval |

## Key Behavior

- Exit codes from policy evaluation map directly to process exit codes.
- Typed errors from core modules are caught and mapped to user-friendly messages.
- This is the only package that may have side effects (stdout, stderr, process.exit).
