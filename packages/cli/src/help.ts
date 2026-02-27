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

Commands:
  evaluate           Evaluate a trace against one or more policies
  replay             Verify or regenerate trace files
  validate           Validate policy file syntax
  stats              Compute per-session analytics from a trace
  export             Export a trace to external formats (e.g., OpenTelemetry)
  policy test        Test a policy against a sample trace
  policy diff        Compare two policies and detect regressions
  policy pull        Pull policies from the Control Plane registry
  policy push        Publish a policy to the Control Plane registry
  compliance export  Generate a compliance evidence bundle
  push               Upload artifacts to the Control Plane
  auth status        Show authentication status
  auth logout        Clear stored credentials
  auth login         Authenticate with email/password
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

Usage: krynix evaluate --trace <file> --policy <file-or-dir>

Options:
  --trace <file>        Path to a .trace.jsonl file
  --policy <path>       Path to a .policy.yaml file or directory
  --filter-type <type>  Filter events by type (repeatable)
  --filter-agent <id>   Filter events by agent_id (repeatable)
  --after <timestamp>   Include events at or after this ISO-8601 time
  --before <timestamp>  Include events at or before this ISO-8601 time
  --help                Show this help

Exit codes:
  0   All policies pass
  1   Runtime error
  2   Policy violation (deny)
  3   Requires approval`;

    case "replay":
      return `krynix replay — Verify or regenerate trace files

Usage: krynix replay [--verify|--regenerate] [--trace <file>|--golden-dir <dir>] [--verbose]

Options:
  --verify              Verify trace integrity (default)
  --regenerate          Regenerate hash chains
  --trace <file>        Single trace file
  --golden-dir <dir>    Directory of golden trace files
  --verbose             Show detailed output
  --help                Show this help

Exit codes:
  0   All traces pass
  1   Verification failure or runtime error`;

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

Usage: krynix policy pull [--labels <key:value>] [--output-dir <dir>]

Options:
  --labels <key:value>  Filter policies by label (e.g., environment:production)
  --output-dir <dir>    Directory to write policies (default: ./policies)
  --help                Show this help

Pulls policies from the configured Control Plane registry. Verifies
SHA-256 digest of each downloaded policy. Skips policies already
present locally.

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
  --help                        Show this help

Generates a self-contained evidence bundle with traces, evaluations,
replay reports, statistics, and a SHA-256 integrity manifest.

Exit codes:
  0   Bundle generated successfully
  1   Runtime error`;

    case "push":
      return `krynix push — Upload artifacts to the Control Plane

Usage: krynix push [--trace <file>] [--evaluation <file>] [--replay-report <file>]

Options:
  --trace <file>           Upload a .trace.jsonl file
  --evaluation <file>      Upload evaluation results (JSON)
  --replay-report <file>   Upload a replay report (JSON)
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

    default:
      return undefined;
  }
}
