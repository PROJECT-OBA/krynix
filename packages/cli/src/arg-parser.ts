/**
 * Shared CLI argument parsing utilities.
 *
 * Pure functions — no access to `process.argv`. Each function takes a
 * `string[]` parameter and returns a result. This keeps all CLI commands
 * testable without mocking the process.
 *
 * @module
 */

/**
 * Get the value of a named flag argument (e.g., `--trace file.jsonl`).
 *
 * @returns The string value immediately following the flag, or `undefined`
 *          if the flag is absent or has no value.
 */
export function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

/**
 * Get all values for a repeatable flag argument (e.g., `--trace a.jsonl --trace b.jsonl`).
 *
 * @returns Array of string values following each occurrence of the flag.
 *          Empty array if the flag is not present.
 */
export function getAllArgs(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      const val = args[i + 1];
      if (val !== undefined) {
        values.push(val);
      }
    }
  }
  return values;
}

/**
 * Check whether a boolean flag is present in the argument list.
 */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** Result of parsing a command from an argv-style array. */
export interface ParsedCommand {
  /** The first positional (non-flag) token, or `undefined` if only flags were provided. */
  command: string | undefined;
  /** All tokens except the command itself. */
  rest: string[];
}

/**
 * Extract the subcommand (first positional argument) from an argv-style array.
 *
 * Positional arguments are tokens that do not start with `--`.
 * The first positional is treated as the command name; the remaining tokens
 * (flags and their values) are returned as `rest`.
 */
export function parseCommand(args: string[]): ParsedCommand {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token !== undefined && !token.startsWith("--")) {
      return {
        command: token,
        rest: [...args.slice(0, i), ...args.slice(i + 1)],
      };
    }
  }
  return { command: undefined, rest: [...args] };
}
