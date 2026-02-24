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
  evaluate      Evaluate a trace against one or more policies
  replay        Verify or regenerate trace files
  validate      Validate policy file syntax
  stats         Compute per-session analytics from a trace
  policy test   Test a policy against a sample trace

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
  --help                Show this help

Output:
  JSON object with event_count, duration_ms, tool_call_count,
  llm_request_count, error_count, total_token_usage, and
  event_type_counts breakdown.

Exit codes:
  0   Success
  1   Runtime error`;

    case "policy":
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

    default:
      return undefined;
  }
}
