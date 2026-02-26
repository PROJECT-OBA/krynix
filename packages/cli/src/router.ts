/**
 * Command router for the Krynix CLI.
 *
 * Pure async function: takes argv, returns structured output.
 * No side effects (no process.exit, no stdout/stderr writes).
 * The binary entry point (`main.ts`) handles IO.
 *
 * @module
 */

import { parseCommand, hasFlag } from "./arg-parser.js";
import { getVersion, getMainHelp, getCommandHelp } from "./help.js";
import { runEvaluate } from "./evaluate.js";
import { runReplay } from "./replay.js";
import { runValidate } from "./validate.js";
import { runStats } from "./stats.js";
import { runPolicyTest } from "./policy-test.js";
import { runExport } from "./export.js";
import { runPolicyDiff } from "./policy-diff.js";

/**
 * Find the first positional token in an argument list, skipping
 * flag-value pairs (tokens immediately following a `--`-prefixed flag).
 *
 * Returns the token and its index, or `undefined` if no positional exists.
 */
function findSubcommandToken(args: string[]): { token: string; index: number } | undefined {
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === undefined) continue;
    if (token.startsWith("--")) continue;
    // Skip tokens that are values of a preceding flag
    if (i > 0 && args[i - 1]?.startsWith("--")) continue;
    return { token, index: i };
  }
  return undefined;
}

/** Structured output from the command router. */
export interface CommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Route CLI arguments to the appropriate command handler.
 *
 * @param argv - Raw arguments (after stripping node and script path)
 * @returns Structured output with exit code, stdout, and stderr
 */
export async function routeCommand(argv: string[]): Promise<CommandOutput> {
  // --version takes priority over everything
  if (hasFlag(argv, "--version")) {
    return { exitCode: 0, stdout: getVersion(), stderr: "" };
  }

  const { command, rest } = parseCommand(argv);

  // --help with no command, or no arguments at all
  if (command === undefined) {
    if (hasFlag(argv, "--help") || argv.length === 0) {
      return { exitCode: 0, stdout: getMainHelp(), stderr: "" };
    }
    // Only flags but no recognized command
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown arguments: ${argv.join(" ")}\n\n${getMainHelp()}`,
    };
  }

  // Per-command --help (namespace commands like "policy" handle their own help)
  if (hasFlag(rest, "--help") && command !== "policy") {
    const help = getCommandHelp(command);
    if (help !== undefined) {
      return { exitCode: 0, stdout: help, stderr: "" };
    }
  }

  switch (command) {
    case "evaluate": {
      const result = await runEvaluate(rest);
      const stdout = result.output !== null ? JSON.stringify(result.output, null, 2) : "";
      const stderr = result.error ?? "";
      return { exitCode: result.exitCode, stdout, stderr };
    }

    case "replay": {
      const result = await runReplay(rest);
      const stdout =
        result.error !== null && result.results.length === 0
          ? ""
          : JSON.stringify(result.results, null, 2);
      const lines: string[] = [];
      if (result.error !== null) {
        lines.push(result.error);
      }
      if (result.verboseLines !== undefined) {
        lines.push(...result.verboseLines);
      }
      return { exitCode: result.exitCode, stdout, stderr: lines.join("\n") };
    }

    case "validate": {
      const result = await runValidate(rest);
      const stdout =
        result.error !== null && result.results.length === 0
          ? ""
          : JSON.stringify(result.results, null, 2);
      const stderr = result.error ?? "";
      return { exitCode: result.exitCode, stdout, stderr };
    }

    case "stats": {
      const result = await runStats(rest);
      const stdout = result.stats !== null ? JSON.stringify(result.stats, null, 2) : "";
      const stderr = result.error ?? "";
      return { exitCode: result.exitCode, stdout, stderr };
    }

    case "export": {
      const result = await runExport(rest);
      const stdout = result.output ?? "";
      const stderr = result.error ?? "";
      return { exitCode: result.exitCode, stdout, stderr };
    }

    case "policy": {
      // Namespace command: "policy test", "policy diff", "policy --help", etc.
      const sub = findSubcommandToken(rest);

      if (sub === undefined) {
        const help = getCommandHelp("policy");
        return { exitCode: 0, stdout: help ?? "", stderr: "" };
      }

      if (sub.token === "test") {
        // Remove the "test" subcommand token from rest before passing to handler
        const policyTestArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(policyTestArgs, "--help")) {
          const help = getCommandHelp("policy test");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = await runPolicyTest(policyTestArgs);
        const stdout = result.result !== null ? JSON.stringify(result.result, null, 2) : "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      if (sub.token === "diff") {
        const policyDiffArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(policyDiffArgs, "--help")) {
          const help = getCommandHelp("policy diff");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = await runPolicyDiff(policyDiffArgs);
        const stdout = result.result !== null ? JSON.stringify(result.result, null, 2) : "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      return {
        exitCode: 1,
        stdout: "",
        stderr: `Unknown policy subcommand: ${sub.token}\n\n${getCommandHelp("policy") ?? ""}`,
      };
    }

    default: {
      const help = getMainHelp();
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Unknown command: ${command}\n\n${help}`,
      };
    }
  }
}
