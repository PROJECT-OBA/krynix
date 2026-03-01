/**
 * CLI policy validate command.
 *
 * Validates one or more policy YAML files without requiring a trace file.
 * Reports per-file validation results with structured error messages.
 *
 * @module
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { parsePolicy } from "@krynix/policy";
import { getArg } from "./arg-parser.js";

/** Per-file validation result. */
export interface PolicyFileResult {
  file: string;
  valid: boolean;
  errors: string[];
}

/** Result from the validate command. */
export interface ValidateResult {
  exitCode: number;
  results: PolicyFileResult[];
  error: string | null;
}

/**
 * Run the policy validate command.
 *
 * Does NOT call `process.exit` — returns the result for testability.
 *
 * @param args - Command arguments: `["--policy", path]`
 * @returns Validate result with exit code, per-file results, and any error message
 */
export async function runValidate(args: string[]): Promise<ValidateResult> {
  const policyPath = getArg(args, "--policy");

  if (policyPath === undefined) {
    return { exitCode: 1, results: [], error: "Missing required argument: --policy" };
  }

  let info;
  try {
    info = await stat(policyPath);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exitCode: 1, results: [], error: `Path not found: ${policyPath}` };
    }
    throw err;
  }

  const files: Array<{ name: string; fullPath: string }> = [];

  if (info.isDirectory()) {
    let entries: string[];
    try {
      entries = await readdir(policyPath);
    } catch (err) {
      return { exitCode: 1, results: [], error: `Failed to read directory: ${String(err)}` };
    }
    const yamlFiles = entries.filter((f) => f.endsWith(".policy.yaml")).sort();
    for (const file of yamlFiles) {
      files.push({ name: file, fullPath: join(policyPath, file) });
    }
  } else {
    files.push({ name: basename(policyPath), fullPath: policyPath });
  }

  const results: PolicyFileResult[] = [];

  for (const { name, fullPath } of files) {
    try {
      const content = await readFile(fullPath, "utf-8");
      parsePolicy(content);
      results.push({ file: name, valid: true, errors: [] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        file: name,
        valid: false,
        errors: [message],
      });
    }
  }

  const hasInvalid = results.some((r) => !r.valid);

  return {
    exitCode: hasInvalid ? 1 : 0,
    results,
    error: null,
  };
}
