/**
 * CLI `compliance export` command.
 *
 * Generates a local compliance evidence bundle from trace files
 * and optional evaluation/replay attachments.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { getArg, getAllArgs, hasFlag } from "./arg-parser.js";
import {
  generateComplianceBundle,
  writeComplianceBundleToDir,
  readTrace,
  type TraceInput,
} from "@krynix/core";
import { loadConfig } from "./config.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from the compliance export command. */
export interface ComplianceExportResult {
  exitCode: number;
  output: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the `compliance export` command.
 *
 * @param args - CLI arguments after removing "compliance" and "export" tokens
 * @returns Structured result
 */
export async function runComplianceExport(args: string[]): Promise<ComplianceExportResult> {
  const tracePaths = getAllArgs(args, "--trace");
  const outputDir = getArg(args, "--output");
  const includeOtlp = hasFlag(args, "--include-otlp");
  const evaluationPaths = getAllArgs(args, "--include-evaluation");
  const replayPaths = getAllArgs(args, "--include-replay");

  if (tracePaths.length === 0) {
    return {
      exitCode: 1,
      output: null,
      error:
        "Missing required --trace flag. Usage: krynix compliance export --trace <file> --output <dir>",
    };
  }

  if (outputDir === undefined) {
    return {
      exitCode: 1,
      output: null,
      error:
        "Missing required --output flag. Usage: krynix compliance export --trace <file> --output <dir>",
    };
  }

  try {
    // Load evaluations (keyed by session_id or trace_id extracted from JSON)
    const evaluations = new Map<string, unknown>();
    for (const evalPath of evaluationPaths) {
      const content = await readFile(evalPath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      // Expect evaluation JSONs to have a trace_id or session_id field
      const rawId = parsed["trace_id"] ?? parsed["session_id"];
      if (typeof rawId === "string" && rawId !== "") {
        evaluations.set(rawId, parsed);
      }
    }

    // Load replay reports
    const replayReports = new Map<string, unknown>();
    for (const replayPath of replayPaths) {
      const content = await readFile(replayPath, "utf-8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const rawId = parsed["trace_id"] ?? parsed["session_id"];
      if (typeof rawId === "string" && rawId !== "") {
        replayReports.set(rawId, parsed);
      }
    }

    // Load traces and build trace inputs
    const traceInputs: TraceInput[] = [];
    for (const tracePath of tracePaths) {
      const events = await readTrace(tracePath);
      const sessionId =
        events.length > 0
          ? (events[0]?.session_id ?? `unknown-${String(traceInputs.length)}`)
          : `unknown-${String(traceInputs.length)}`;

      traceInputs.push({
        session_id: sessionId,
        events,
        evaluation: evaluations.get(sessionId),
        replay_report: replayReports.get(sessionId),
      });
    }

    // Load config (non-fatal) to pass org_id when available
    const config = loadConfig();

    // Generate and write bundle
    const bundle = generateComplianceBundle({
      traces: traceInputs,
      include_otlp: includeOtlp,
      org_id: config?.org_id,
    });

    await writeComplianceBundleToDir(bundle, outputDir);

    const summary = JSON.stringify(
      {
        output_dir: outputDir,
        trace_count: bundle.manifest.trace_count,
        artifact_count: bundle.manifest.artifacts.length,
      },
      null,
      2,
    );

    return { exitCode: 0, output: summary, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: message };
  }
}
