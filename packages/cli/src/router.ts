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
import { runComplianceExport } from "./compliance.js";
import { runAuthStatus, runAuthLogout, runAuthLogin, runAuthCreateKey } from "./auth.js";
import { runPush } from "./push.js";
import { runPolicyPull } from "./policy-pull.js";
import { runPolicyPush } from "./policy-push.js";

/** Sensitive flags whose values must not appear in error messages. */
const SENSITIVE_FLAGS = new Set(["--password", "--email", "--token", "--api-key"]);

/**
 * Redact values that follow sensitive flags in an argv array.
 * Returns a new array with sensitive values replaced by `"[REDACTED]"`.
 */
function redactFlagValues(argv: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    result.push(token);
    if (token.startsWith("--") && SENSITIVE_FLAGS.has(token) && i + 1 < argv.length) {
      result.push("[REDACTED]");
      i++; // skip the value
    }
  }
  return result;
}

/**
 * Check whether a value appears in argv immediately after a sensitive flag.
 */
function isSensitiveFlagValue(argv: string[], value: string): boolean {
  // Scan all occurrences — indexOf only finds the first, which may not be
  // the one following a sensitive flag.
  for (let i = 1; i < argv.length; i++) {
    const prev = argv[i - 1];
    if (argv[i] === value && prev !== undefined && SENSITIVE_FLAGS.has(prev)) {
      return true;
    }
  }
  return false;
}

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
    // Only flags but no recognized command — redact flag values to avoid leaking secrets
    const safeArgv = redactFlagValues(argv);
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Unknown arguments: ${safeArgv.join(" ")}\n\n${getMainHelp()}`,
    };
  }

  // Per-command --help (namespace commands handle their own help)
  if (
    hasFlag(rest, "--help") &&
    command !== "policy" &&
    command !== "compliance" &&
    command !== "auth"
  ) {
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

      if (sub.token === "pull") {
        const policyPullArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(policyPullArgs, "--help")) {
          const help = getCommandHelp("policy pull");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = await runPolicyPull(policyPullArgs);
        const stdout = result.result !== null ? JSON.stringify(result.result, null, 2) : "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      if (sub.token === "push") {
        const policyPushArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(policyPushArgs, "--help")) {
          const help = getCommandHelp("policy push");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = await runPolicyPush(policyPushArgs);
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

    case "compliance": {
      const sub = findSubcommandToken(rest);

      if (sub === undefined) {
        const help = getCommandHelp("compliance");
        return { exitCode: 0, stdout: help ?? "", stderr: "" };
      }

      if (sub.token === "export") {
        const complianceArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(complianceArgs, "--help")) {
          const help = getCommandHelp("compliance export");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = await runComplianceExport(complianceArgs);
        const stdout = result.output ?? "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      return {
        exitCode: 1,
        stdout: "",
        stderr: `Unknown compliance subcommand: ${sub.token}\n\n${getCommandHelp("compliance") ?? ""}`,
      };
    }

    case "auth": {
      const sub = findSubcommandToken(rest);

      if (sub === undefined) {
        const help = getCommandHelp("auth");
        return { exitCode: 0, stdout: help ?? "", stderr: "" };
      }

      if (sub.token === "status") {
        const authArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(authArgs, "--help")) {
          const help = getCommandHelp("auth status");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = runAuthStatus(authArgs);
        const stdout = result.output !== null ? JSON.stringify(result.output, null, 2) : "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      if (sub.token === "logout") {
        const authArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(authArgs, "--help")) {
          const help = getCommandHelp("auth logout");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = runAuthLogout(authArgs);
        const stdout = result.output !== null ? JSON.stringify(result.output, null, 2) : "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      if (sub.token === "login") {
        const authArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(authArgs, "--help")) {
          const help = getCommandHelp("auth login");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = await runAuthLogin(authArgs);
        const stdout = result.output !== null ? JSON.stringify(result.output, null, 2) : "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      if (sub.token === "create-key") {
        const authArgs = [...rest.slice(0, sub.index), ...rest.slice(sub.index + 1)];

        if (hasFlag(authArgs, "--help")) {
          const help = getCommandHelp("auth create-key");
          return { exitCode: 0, stdout: help ?? "", stderr: "" };
        }

        const result = await runAuthCreateKey(authArgs);
        const stdout = result.output !== null ? JSON.stringify(result.output, null, 2) : "";
        const stderr = result.error ?? "";
        return { exitCode: result.exitCode, stdout, stderr };
      }

      return {
        exitCode: 1,
        stdout: "",
        stderr: `Unknown auth subcommand: ${sub.token}\n\n${getCommandHelp("auth") ?? ""}`,
      };
    }

    case "push": {
      const result = await runPush(rest);
      const stdout = result.output !== null ? JSON.stringify(result.output, null, 2) : "";
      const stderr = result.error ?? "";
      return { exitCode: result.exitCode, stdout, stderr };
    }

    default: {
      const help = getMainHelp();
      // The "command" may be a flag value (e.g., password) mis-parsed as a
      // positional argument. Redact it if it follows a sensitive flag in argv.
      const displayCommand = isSensitiveFlagValue(argv, command) ? "[REDACTED]" : command;
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Unknown command: ${displayCommand}\n\n${help}`,
      };
    }
  }
}
