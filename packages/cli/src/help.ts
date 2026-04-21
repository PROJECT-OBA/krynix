/**
 * Help text definitions for the Krynix CLI.
 *
 * Pure functions returning help text strings. No side effects.
 *
 * @module
 */

/* Injected by tsup `define` at build time; falls back for tests / source imports. */
declare const __CLI_VERSION__: string | undefined;
const VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0";

/**
 * Get the CLI version string.
 */
export function getVersion(): string {
  return `krynix ${VERSION}`;
}

/**
 * Get the top-level help text.
 */
export function getMainHelp(): string {
  return `krynix — Agent Runtime Trust Layer CLI

Usage: krynix <command> [options]

Local Commands (work offline, no auth required):
  evaluate           Evaluate a trace against one or more policies
  replay             Verify, regenerate, or compare trace files
  validate           Validate policy file syntax
  stats              Compute per-session analytics from a trace
  export             Export a trace to external formats (e.g., OpenTelemetry)
  diff               Compare two traces for behavioral drift
  sign               Sign a trace's hash chain with an Ed25519 private key
  keygen             Generate an Ed25519 signing keypair
  policy test        Test a policy against a sample trace
  policy diff        Compare two policies and detect regressions
  compliance export  Generate a compliance evidence bundle
  compliance verify  Verify a compliance bundle's integrity

Control Plane Commands (require configuration + auth):
  policy pull        Pull policies from the Control Plane registry
  policy push        Publish a policy to the Control Plane registry
  push               Upload artifacts to the Control Plane
  golden promote     Promote a trace to golden status in the registry
  golden list        List golden traces from the registry
  golden pull        Download a golden trace from the registry
  auth login         Authenticate with email/password
  auth logout        Clear stored credentials
  auth status        Show authentication status
  auth create-key    Create an API key

Options:
  --help      Show help
  --version   Show version

Run 'krynix <command> --help' for command-specific help.`;
}

/**
 * Get help text for a specific command.
 *
 * @returns Help text string, or undefined if the command is unknown.
 */
export function getCommandHelp(command: string): string | undefined {
  switch (command) {
    case "evaluate":
      return `krynix evaluate — Evaluate a trace against policies

Usage: krynix evaluate --trace <file> --policy <file-or-dir> [--format json|text]

Options:
  --trace <file>        Path to a .trace.jsonl file
  --policy <path>       Path to a .policy.yaml file or directory
  --format <fmt>        Output format: json (default) or text
  --filter-type <type>  Filter events by type (repeatable)
  --filter-agent <id>   Filter events by agent_id (repeatable)
  --after <timestamp>   Include events at or after this ISO-8601 time
  --before <timestamp>  Include events at or before this ISO-8601 time
  --env <key>=<value>   Set environment context (repeatable)
  --skip-verify         Skip hash-chain structural validation (bypasses tamper detection)
  --public-key <file>   Verify Ed25519 signature against this public key (PEM)
  --signature <file>    Override signature path (default: <trace>.sig sidecar)
  --help                Show this help

Integrity:
  By default, evaluate verifies the trace's SHA-256 hash chain structural
  integrity before evaluating policy. For cryptographic tamper-evidence
  against intentional modification (chain regeneration, event deletion/
  insertion, reorder, truncation), also pass --public-key. Sign traces
  with 'krynix sign --trace <file> --private-key <key>' first.

Exit codes:
  0   All policies pass (including non-CI-failing violations)
  1   CI-failing error-severity violation, integrity failure, or runtime error
  2   CI-failing critical-severity violation
  3   Requires approval (no CI-failing violations)`;

    case "replay":
      return `krynix replay — Verify, regenerate, or compare trace files

Usage: krynix replay [--verify|--regenerate] [--trace <file>|--golden-dir <dir>] [--verbose]
       krynix replay --compare --baseline <file> --candidate <file>

Options:
  --verify              Verify trace integrity (default)
  --regenerate          Regenerate hash chains
  --compare             Compare two traces for behavioral drift
  --trace <file>        Single trace file
  --golden-dir <dir>    Directory of golden trace files
  --baseline <file>     Baseline trace for comparison (used with --compare)
  --candidate <file>    Candidate trace for comparison (used with --compare)
  --verbose             Show detailed output
  --help                Show this help

Exit codes:
  0   All traces pass / traces match
  1   Verification failure, divergence detected, or runtime error`;

    case "validate":
      return `krynix validate — Validate policy file syntax

Usage: krynix validate --policy <file-or-dir>

Options:
  --policy <path>       Path to a .policy.yaml file or directory
  --help                Show this help

Exit codes:
  0   All policies are valid
  1   Validation error or runtime error`;

    case "stats":
      return `krynix stats — Compute per-session analytics from a trace

Usage: krynix stats --trace <file>

Options:
  --trace <file>        Path to a .trace.jsonl file
  --filter-type <type>  Filter events by type (repeatable)
  --filter-agent <id>   Filter events by agent_id (repeatable)
  --after <timestamp>   Include events at or after this ISO-8601 time
  --before <timestamp>  Include events at or before this ISO-8601 time
  --help                Show this help

Output:
  JSON object with event_count, duration_ms, tool_call_count,
  llm_request_count, error_count, total_token_usage, and
  event_type_counts breakdown.

Exit codes:
  0   Success
  1   Runtime error`;

    case "export":
      return `krynix export — Export a trace to external formats

Usage: krynix export --format <format> --trace <file>

Options:
  --format <format>     Output format (supported: otlp-json)
  --trace <file>        Path to a .trace.jsonl file
  --filter-type <type>  Filter events by type (repeatable)
  --filter-agent <id>   Filter events by agent_id (repeatable)
  --after <timestamp>   Include events at or after this ISO-8601 time
  --before <timestamp>  Include events at or before this ISO-8601 time
  --help                Show this help

Formats:
  otlp-json   OpenTelemetry protobuf-JSON (ExportTraceServiceRequest)

Exit codes:
  0   Success
  1   Runtime error`;

    case "policy":
      return `krynix policy — Policy management commands

Usage: krynix policy <subcommand> [options]

Subcommands:
  test    Test a policy against a sample trace
  diff    Compare two policies and detect regressions
  pull    Pull policies from the Control Plane registry
  push    Publish a policy to the Control Plane registry

Run 'krynix policy <subcommand> --help' for subcommand-specific help.`;

    case "policy test":
      return `krynix policy test — Test a policy against a sample trace

Usage: krynix policy test --policy <file> --trace <file> [--expect-verdict <verdict>]

Options:
  --policy <file>              Path to a .policy.yaml file
  --trace <file>               Path to a .trace.jsonl file
  --expect-verdict <verdict>   Expected verdict: pass, fail, or require-approval
  --help                       Show this help

When --expect-verdict is provided, exits 1 on mismatch. Without it,
always exits 0 (reporting mode).

Exit codes:
  0   Success (or verdict matches expectation)
  1   Runtime error or verdict mismatch`;

    case "policy diff":
      return `krynix policy diff — Compare two policies and detect regressions

Usage: krynix policy diff --old <file> --new <file>

Options:
  --old <file>          Path to the baseline .policy.yaml file
  --new <file>          Path to the updated .policy.yaml file
  --help                Show this help

Detects severity downgrades, action weakenings, rule additions/removals,
and scope changes. Designed for CI integration.

Exit codes:
  0   No security-relevant regressions detected
  1   Runtime error
  2   Severity downgrade or action weakening detected`;

    case "policy pull":
      return `krynix policy pull — Pull policies from the Control Plane registry

Usage: krynix policy pull [--labels <key:value>] [--output-dir <dir>] [--since <timestamp>] [--incremental]

Options:
  --labels <key:value>  Filter policies by label (e.g., environment:production)
  --output-dir <dir>    Directory to write policies (default: ./policies)
  --since <timestamp>   Only fetch policies changed after this ISO-8601 timestamp
  --incremental         Auto-read last sync time from state file; update after success
  --help                Show this help

Pulls policies from the configured Control Plane registry. Verifies
SHA-256 digest of each downloaded policy. Skips policies already
present locally.

When --since is provided, only policies modified after the given
timestamp are fetched. --incremental reads the last sync time
from ~/.krynix/sync-state.json and passes it as --since.
If both --since and --incremental are specified, --since wins.

Exit codes:
  0   Success
  1   Runtime error or auth failure`;

    case "policy push":
      return `krynix policy push — Publish a policy to the Control Plane registry

Usage: krynix policy push --file <path> [--changelog <text>]

Options:
  --file <path>         Path to a .policy.yaml file
  --changelog <text>    Description of changes (optional)
  --help                Show this help

Validates the policy file locally before uploading. Requires
maintainer or org_admin role.

Exit codes:
  0   Policy published successfully
  1   Runtime error, auth failure, or invalid policy`;

    case "compliance":
      return `krynix compliance — Compliance management commands

Usage: krynix compliance <subcommand> [options]

Subcommands:
  export  Generate a compliance evidence bundle
  verify  Verify a compliance bundle's integrity

Run 'krynix compliance <subcommand> --help' for subcommand-specific help.`;

    case "compliance export":
      return `krynix compliance export — Generate a compliance evidence bundle

Usage: krynix compliance export --trace <file> [--trace <file>...] --output <dir>

Options:
  --trace <file>                Path to a .trace.jsonl file (repeatable)
  --output <dir>                Output directory for the bundle
  --include-otlp                Include OTLP exports in the bundle
  --include-evaluation <file>   Attach evaluation JSON (repeatable)
  --include-replay <file>       Attach replay report JSON (repeatable)
  --env <key>=<value>           Set environment context (repeatable)
  --help                        Show this help

Generates a self-contained evidence bundle with traces, evaluations,
replay reports, statistics, and a SHA-256 integrity manifest.

Exit codes:
  0   Bundle generated successfully
  1   Runtime error`;

    case "compliance verify":
      return `krynix compliance verify — Verify a compliance bundle's integrity

Usage: krynix compliance verify --dir <bundle-dir>

Options:
  --dir <dir>   Path to the compliance bundle directory
  --help        Show this help

Reads the bundle manifest and verifies SHA-256 digests
for all artifacts. Reports per-artifact errors.

Exit codes:
  0   Bundle is valid
  1   Verification failed or runtime error`;

    case "push":
      return `krynix push — Upload artifacts to the Control Plane

Usage: krynix push [--trace <file>] [--evaluation <file>] [--replay-report <file>] [--bundle <dir>]

Options:
  --trace <file>           Upload a .trace.jsonl file
  --evaluation <file>      Upload evaluation results (JSON)
  --replay-report <file>   Upload a replay report (JSON)
  --bundle <dir>           Upload a compliance bundle directory
  --env <key>=<value>      Set environment context (repeatable)
  --help                   Show this help

At least one artifact flag is required. Multiple flags can be combined.
Requires Control Plane configuration and authentication.

Exit codes:
  0   All artifacts uploaded successfully
  1   Upload failure or auth error`;

    case "auth":
      return `krynix auth — Authentication management

Usage: krynix auth <subcommand>

Subcommands:
  status      Show current authentication status
  logout      Clear stored credentials
  login       Authenticate with email and password
  create-key  Create an API key

Run 'krynix auth <subcommand> --help' for subcommand-specific help.`;

    case "auth status":
      return `krynix auth status — Show current authentication status

Usage: krynix auth status

Checks for Control Plane configuration and stored credentials.
Reports token expiry and authentication method.

Exit codes:
  0   Success
  1   Runtime error`;

    case "auth logout":
      return `krynix auth logout — Clear stored credentials

Usage: krynix auth logout

Removes the credentials file (~/.krynix/credentials).

Exit codes:
  0   Credentials cleared
  1   Runtime error`;

    case "auth login":
      return `krynix auth login — Authenticate with email and password

Usage: krynix auth login --email <email> --password <password>

Options:
  --email <email>       Email address (or set KRYNIX_EMAIL env var)
  --password <password> Password (or set KRYNIX_PASSWORD env var)
  --help                Show this help

Flags take priority over environment variables. Stores a token
on success, preserving any existing API key.

Exit codes:
  0   Authenticated successfully
  1   Runtime error or auth failure`;

    case "auth create-key":
      return `krynix auth create-key — Create an API key

Usage: krynix auth create-key [--name <name>]

Options:
  --name <name>   Optional name for the API key
  --help          Show this help

Requires existing authentication (token or API key).
Stores the new API key on success, preserving any existing token.

Exit codes:
  0   API key created successfully
  1   Runtime error or auth failure`;

    case "golden":
      return `krynix golden — Golden Trace Registry commands

Usage: krynix golden <subcommand> [options]

Subcommands:
  promote  Promote a trace to golden status in the CP registry
  list     List golden traces from the CP registry
  pull     Download a golden trace from the CP registry

Run 'krynix golden <subcommand> --help' for subcommand-specific help.`;

    case "golden promote":
      return `krynix golden promote — Promote a trace to golden status

Usage: krynix golden promote --trace <file> --name <name> [--description <desc>] [--label <key>=<value>]

Options:
  --trace <file>           Path to a .trace.jsonl file
  --name <name>            Name for the golden trace
  --description <desc>     Description (optional)
  --label <key>=<value>    Label (repeatable)
  --help                   Show this help

Uploads a trace file to the CP Golden Trace Registry.
Includes SHA-256 digest header for integrity verification.

Exit codes:
  0   Trace promoted successfully
  1   Runtime error or auth failure`;

    case "golden list":
      return `krynix golden list — List golden traces from the CP registry

Usage: krynix golden list [--name <filter>] [--label <filter>] [--limit <n>]

Options:
  --name <filter>    Filter by name
  --label <filter>   Filter by label
  --limit <n>        Max entries to return
  --help             Show this help

Exit codes:
  0   Success
  1   Runtime error or auth failure`;

    case "golden pull":
      return `krynix golden pull — Download a golden trace from the CP registry

Usage: krynix golden pull --id <golden-trace-id> --output <file>

Options:
  --id <id>          Golden trace ID
  --output <file>    Output file path
  --help             Show this help

Exit codes:
  0   Trace downloaded successfully
  1   Runtime error or auth failure`;

    case "diff":
      return `krynix diff — Compare two traces for behavioral drift

Usage: krynix diff --baseline <file> --candidate <file>

Options:
  --baseline <file>    Path to the reference/golden trace file
  --candidate <file>   Path to the new/candidate trace file
  --help               Show this help

Compares event_type, payload, and agent_id at each position. Ignores
non-deterministic fields (event_hash, prev_hash, timestamp, event_id,
metadata). Reports the first divergence point with field-level diffs.

Exit codes:
  0   Traces match
  1   Behavioral drift detected or runtime error`;

    case "sign":
      return `krynix sign — Sign a trace's hash chain with an Ed25519 private key

Usage: krynix sign --trace <file> --private-key <key> [--output <file>]

Options:
  --trace <file>         Path to a .trace.jsonl file
  --private-key <file>   Path to an Ed25519 private key (PEM)
  --output <file>        Signature output path (default: <trace>.sig sidecar)
  --help                 Show this help

Verifies the hash chain structurally before signing. Refuses to sign a
broken chain. The signature binds the chain tip under the private key.
Attach the matching public key to 'krynix evaluate --public-key' to
detect chain regeneration, event deletion/insertion, and reorder.

Exit codes:
  0   Signature written successfully
  1   Invalid chain, missing key, or runtime error`;

    case "keygen":
      return `krynix keygen — Generate an Ed25519 signing keypair

Usage: krynix keygen --out-private <file> --out-public <file>

Options:
  --out-private <file>   Destination path for the private key (PEM, mode 0600)
  --out-public <file>    Destination path for the public key (PEM)
  --help                 Show this help

Produces a fresh Ed25519 keypair encoded as PKCS#8 (private) and SPKI
(public) PEM files. The private key is written with mode 0600. Distribute
only the public key to verifiers.

Exit codes:
  0   Keypair written successfully
  1   Runtime error (e.g., unwritable output path)`;

    default:
      return undefined;
  }
}
