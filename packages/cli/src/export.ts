/**
 * CLI export command.
 *
 * Reads a trace JSONL file and converts it to the specified output format.
 * Currently supports `otlp-json` (OpenTelemetry protobuf-JSON).
 *
 * @module
 */

import { readTrace, convertToOtlp, filterTraceEvents } from "@krynix/core";
import { getArg, getAllArgs } from "./arg-parser.js";

/** Supported export formats. */
const SUPPORTED_FORMATS = ["otlp-json"] as const;

/** Result from the export command. */
export interface ExportResult {
  exitCode: number;
  output: string | null;
  error: string | null;
}

/**
 * Run the export command.
 *
 * Does NOT call `process.exit` — returns the result for testability.
 *
 * @param args - Command arguments: `["--format", format, "--trace", path]`
 * @returns Export result with exit code, JSON output string, and any error message
 */
export async function runExport(args: string[]): Promise<ExportResult> {
  const tracePath = getArg(args, "--trace");
  const format = getArg(args, "--format");
  const filterTypes = getAllArgs(args, "--filter-type");
  const filterAgents = getAllArgs(args, "--filter-agent");
  const afterArg = getArg(args, "--after");
  const beforeArg = getArg(args, "--before");

  if (tracePath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --trace" };
  }

  if (format === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --format" };
  }

  if (!SUPPORTED_FORMATS.includes(format as (typeof SUPPORTED_FORMATS)[number])) {
    return {
      exitCode: 1,
      output: null,
      error: `Unknown format: ${format}. Supported formats: ${SUPPORTED_FORMATS.join(", ")}`,
    };
  }

  let trace;
  try {
    trace = await readTrace(tracePath);
  } catch (err) {
    return { exitCode: 1, output: null, error: `Failed to read trace: ${String(err)}` };
  }

  // Apply filters
  try {
    trace = filterTraceEvents(trace, {
      event_types: filterTypes.length > 0 ? filterTypes : undefined,
      agent_ids: filterAgents.length > 0 ? filterAgents : undefined,
      after: afterArg,
      before: beforeArg,
    });
  } catch (err) {
    return { exitCode: 1, output: null, error: `Invalid filter: ${String(err)}` };
  }

  let otlp;
  try {
    otlp = convertToOtlp(trace);
  } catch (err) {
    return { exitCode: 1, output: null, error: `Failed to convert trace: ${String(err)}` };
  }

  return { exitCode: 0, output: JSON.stringify(otlp, null, 2), error: null };
}
