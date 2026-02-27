# CLI Reference

Complete reference for all `krynix` CLI commands.

All commands return structured JSON to stdout and errors to stderr. Exit codes follow a consistent convention: `0` for success, `1` for runtime errors, and higher codes for domain-specific results.

---

## Global Options

```
--help      Show help (top-level or per-command)
--version   Show version
```

`--version` takes priority over all other flags. `--help` takes priority over command execution.

---

## `krynix evaluate`

Evaluate a trace against one or more policies.

```
Usage: krynix evaluate --trace <file> --policy <file-or-dir>

Options:
  --trace <file>        Path to a .trace.jsonl file
  --policy <path>       Path to a .policy.yaml file or directory
  --filter-type <type>  Filter events by type (repeatable)
  --filter-agent <id>   Filter events by agent_id (repeatable)
  --after <timestamp>   Include events at or after this ISO-8601 time
  --before <timestamp>  Include events at or before this ISO-8601 time

Exit codes:
  0   All policies pass
  1   Runtime error
  2   Policy violation (deny)
  3   Requires approval
```

**Examples:**

```bash
# Evaluate against all policies in a directory
krynix evaluate --trace session.trace.jsonl --policy policies/

# Evaluate against a single policy, filtering to tool_call events only
krynix evaluate --trace session.trace.jsonl --policy no-shell.policy.yaml --filter-type tool_call
```

---

## `krynix replay`

Verify or regenerate trace files.

```
Usage: krynix replay [--verify|--regenerate] [--trace <file>|--golden-dir <dir>] [--verbose]

Options:
  --verify              Verify trace integrity (default)
  --regenerate          Regenerate hash chains
  --trace <file>        Single trace file
  --golden-dir <dir>    Directory of golden trace files
  --verbose             Show detailed output

Exit codes:
  0   All traces pass
  1   Verification failure or runtime error
```

**Examples:**

```bash
# Verify a single trace
krynix replay --verify --trace session.trace.jsonl

# Verify all golden traces
krynix replay --verify --golden-dir test/golden/

# Verbose output for debugging divergence
krynix replay --verify --verbose --trace session.trace.jsonl

# Regenerate hash chains (useful after manual trace edits)
krynix replay --regenerate --trace session.trace.jsonl
```

---

## `krynix validate`

Validate policy file syntax.

```
Usage: krynix validate --policy <file-or-dir>

Options:
  --policy <path>       Path to a .policy.yaml file or directory

Exit codes:
  0   All policies are valid
  1   Validation error or runtime error
```

---

## `krynix stats`

Compute per-session analytics from a trace.

```
Usage: krynix stats --trace <file>

Options:
  --trace <file>        Path to a .trace.jsonl file
  --filter-type <type>  Filter events by type (repeatable)
  --filter-agent <id>   Filter events by agent_id (repeatable)
  --after <timestamp>   Include events at or after this ISO-8601 time
  --before <timestamp>  Include events at or before this ISO-8601 time

Exit codes:
  0   Success
  1   Runtime error
```

**Output fields:** `event_count`, `duration_ms`, `tool_call_count`, `llm_request_count`, `error_count`, `total_token_usage`, `event_type_counts`.

---

## `krynix export`

Export a trace to external formats.

```
Usage: krynix export --format <format> --trace <file>

Options:
  --format <format>     Output format (supported: otlp-json)
  --trace <file>        Path to a .trace.jsonl file
  --filter-type <type>  Filter events by type (repeatable)
  --filter-agent <id>   Filter events by agent_id (repeatable)
  --after <timestamp>   Include events at or after this ISO-8601 time
  --before <timestamp>  Include events at or before this ISO-8601 time

Formats:
  otlp-json   OpenTelemetry protobuf-JSON (ExportTraceServiceRequest)

Exit codes:
  0   Success
  1   Runtime error
```

---

## `krynix policy test`

Test a policy against a sample trace.

```
Usage: krynix policy test --policy <file> --trace <file> [--expect-verdict <verdict>]

Options:
  --policy <file>              Path to a .policy.yaml file
  --trace <file>               Path to a .trace.jsonl file
  --expect-verdict <verdict>   Expected verdict: pass, fail, or require-approval

Exit codes:
  0   Success (or verdict matches expectation)
  1   Runtime error or verdict mismatch
```

When `--expect-verdict` is provided, exits 1 on mismatch. Without it, always exits 0 (reporting mode).

---

## `krynix policy diff`

Compare two policies and detect regressions.

```
Usage: krynix policy diff --old <file> --new <file>

Options:
  --old <file>          Path to the baseline .policy.yaml file
  --new <file>          Path to the updated .policy.yaml file

Exit codes:
  0   No security-relevant regressions detected
  1   Runtime error
  2   Severity downgrade or action weakening detected
```

Detects: severity downgrades, action weakenings, rule additions/removals, scope changes, `ci_failure` changes, `on_violation` changes.

---

## `krynix policy pull`

Pull policies from the Control Plane registry.

```
Usage: krynix policy pull [--labels <key:value>] [--output-dir <dir>]

Options:
  --labels <key:value>  Filter policies by label (e.g., environment:production)
  --output-dir <dir>    Directory to write policies (default: ./policies)

Exit codes:
  0   Success
  1   Runtime error or auth failure
```

Requires Control Plane configuration and authentication.

---

## `krynix policy push`

Publish a policy to the Control Plane registry.

```
Usage: krynix policy push --file <path> [--changelog <text>]

Options:
  --file <path>         Path to a .policy.yaml file
  --changelog <text>    Description of changes (optional)

Exit codes:
  0   Policy published successfully
  1   Runtime error, auth failure, or invalid policy
```

Validates the policy locally before uploading. Requires `maintainer` or `org_admin` role.

---

## `krynix compliance export`

Generate a compliance evidence bundle.

```
Usage: krynix compliance export --trace <file> [--trace <file>...] --output <dir>

Options:
  --trace <file>                Path to a .trace.jsonl file (repeatable)
  --output <dir>                Output directory for the bundle
  --include-otlp                Include OTLP exports in the bundle
  --include-evaluation <file>   Attach evaluation JSON (repeatable)
  --include-replay <file>       Attach replay report JSON (repeatable)

Exit codes:
  0   Bundle generated successfully
  1   Runtime error
```

Generates a self-contained evidence bundle with traces, evaluations, replay reports, statistics, and a SHA-256 integrity manifest.

---

## `krynix push`

Upload artifacts to the Control Plane.

```
Usage: krynix push [--trace <file>] [--evaluation <file>] [--replay-report <file>]

Options:
  --trace <file>           Upload a .trace.jsonl file
  --evaluation <file>      Upload evaluation results (JSON)
  --replay-report <file>   Upload a replay report (JSON)

Exit codes:
  0   All artifacts uploaded successfully
  1   Upload failure or auth error
```

At least one artifact flag is required. Requires Control Plane configuration and authentication.

---

## `krynix auth login`

Authenticate with the Control Plane via email/password.

```
Usage: krynix auth login --email <email> --password <password>

Options:
  --email <email>       Email address (or set KRYNIX_EMAIL env var)
  --password <password> Password (or set KRYNIX_PASSWORD env var)

Exit codes:
  0   Authenticated successfully
  1   Runtime error or auth failure
```

Flags take priority over environment variables. Stores a token on success, preserving any existing API key.

---

## `krynix auth create-key`

Create an API key.

```
Usage: krynix auth create-key [--name <name>]

Options:
  --name <name>   Optional name for the API key

Exit codes:
  0   API key created successfully
  1   Runtime error or auth failure
```

Requires existing authentication (token or API key).

---

## `krynix auth status`

Show current authentication status.

```
Usage: krynix auth status

Exit codes:
  0   Success
  1   Runtime error
```

Reports: `configured`, `authenticated`, `config_url`, `has_token`, `has_api_key`, `token_expired`, `expires_at`.

---

## `krynix auth logout`

Clear stored credentials.

```
Usage: krynix auth logout

Exit codes:
  0   Credentials cleared
  1   Runtime error
```

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `KRYNIX_EMAIL` | Default email for `auth login` |
| `KRYNIX_PASSWORD` | Default password for `auth login` |
| `KRYNIX_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` (default: `info`) |
| `KRYNIX_TRACE_DIR` | Output directory for traces (default: `traces/`) |

No secrets are required for local development. All environment variables are optional.
