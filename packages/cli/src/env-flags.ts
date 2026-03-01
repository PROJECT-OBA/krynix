/**
 * Shared `--env` flag parser for CLI commands.
 *
 * Parses `--env key=value` flags from argument lists and merges them
 * with auto-detected environment context. Used by `evaluate`,
 * `compliance export`, and `push` commands.
 *
 * @module
 */

import { getAllArgs } from "./arg-parser.js";
import { detectEnvironment, mergeEnvironmentContext, type EnvironmentContext } from "@krynix/core";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse `--env key=value` pairs from CLI arguments.
 *
 * @param args - CLI argument array
 * @returns Parsed key-value pairs
 * @throws Error if any `--env` value has no `=` separator
 */
export function parseEnvFlags(args: string[]): Record<string, string> {
  const rawValues = getAllArgs(args, "--env");
  const result: Record<string, string> = {};

  for (const raw of rawValues) {
    const eqIndex = raw.indexOf("=");
    if (eqIndex === -1) {
      throw new Error('Invalid --env value (missing "=" separator). Expected format: key=value');
    }
    const key = raw.slice(0, eqIndex);
    const value = raw.slice(eqIndex + 1);
    if (key.length === 0) {
      throw new Error("Invalid --env value (empty key). Expected format: key=value");
    }
    result[key] = value;
  }

  return result;
}

/** Known EnvironmentContext field names that can be set via --env. */
const KNOWN_FIELDS = new Set([
  "ci_provider",
  "ci_run_id",
  "ci_run_url",
  "git_sha",
  "git_branch",
  "git_repository",
]);

/**
 * Build an EnvironmentContext from CLI `--env` flags.
 *
 * Auto-detects the current environment, then merges in any manual
 * overrides from `--env` flags. Known field names (e.g., `git_sha`)
 * are placed in the corresponding EnvironmentContext fields; unknown
 * keys go into `extra`.
 *
 * @param args - CLI argument array
 * @param env - Environment variable map (defaults to `process.env`); pass explicitly for testability
 * @returns Merged environment context, or undefined if no env flags and not in CI
 */
export function buildEnvironmentContext(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): EnvironmentContext | undefined {
  const envFlags = parseEnvFlags(args);
  const detected = detectEnvironment(env);

  const hasFlags = Object.keys(envFlags).length > 0;
  const isInCI = detected.ci_provider !== null;

  if (!hasFlags && !isInCI) {
    return undefined;
  }

  // Split flags into known fields vs extra
  const overrides: Partial<EnvironmentContext> = {};
  const extra: Record<string, string> = {};

  for (const [key, value] of Object.entries(envFlags)) {
    if (KNOWN_FIELDS.has(key)) {
      (overrides as Record<string, string>)[key] = value;
    } else {
      extra[key] = value;
    }
  }

  if (Object.keys(extra).length > 0) {
    overrides.extra = extra;
  }

  return mergeEnvironmentContext(detected, overrides);
}
