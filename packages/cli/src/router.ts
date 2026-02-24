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

  // Per-command --help
  if (hasFlag(rest, "--help")) {
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
