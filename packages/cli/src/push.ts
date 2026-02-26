/**
 * CLI `push` command — upload artifacts to the Control Plane.
 *
 * Supports `--trace`, `--evaluation`, and `--replay-report` flags.
 * Multiple flags can be combined in a single invocation.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { getArg } from "./arg-parser.js";
import { loadConfig, type ControlPlaneConfig } from "./config.js";
import { loadCredentials, isTokenExpired, type Credentials } from "./credentials.js";
import {
  createControlPlaneClient,
  type ControlPlaneClient,
  type ApiResponse,
} from "./http-client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from the push command. */
export interface PushResult {
  exitCode: number;
  output: PushOutput | null;
  error: string | null;
}

/** Output from a successful push. */
export interface PushOutput {
  results: PushArtifactResult[];
}

/** Result for a single pushed artifact. */
export interface PushArtifactResult {
  type: "trace" | "evaluation" | "replay_report";
  path: string;
  status: "success" | "error";
  response: ApiResponse | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

/** Injectable dependencies for push command (for testing). */
export interface PushDeps {
  loadConfig: (path?: string) => ControlPlaneConfig | null;
  loadCredentials: (path?: string) => Credentials | null;
  createClient: (config: ControlPlaneConfig, creds: Credentials) => ControlPlaneClient;
}

const defaultDeps: PushDeps = {
  loadConfig,
  loadCredentials,
  createClient: createControlPlaneClient,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the `push` command.
 *
 * @param args - CLI arguments after removing the "push" command token
 * @param deps - Injectable dependencies (for testing)
 * @returns Structured result
 */
export async function runPush(args: string[], deps: Partial<PushDeps> = {}): Promise<PushResult> {
  const d = { ...defaultDeps, ...deps };

  const tracePath = getArg(args, "--trace");
  const evaluationPath = getArg(args, "--evaluation");
  const replayReportPath = getArg(args, "--replay-report");

  if (tracePath === undefined && evaluationPath === undefined && replayReportPath === undefined) {
    return {
      exitCode: 1,
      output: null,
      error:
        "At least one of --trace, --evaluation, or --replay-report is required.\nUsage: krynix push --trace <file>",
    };
  }

  // Load config
  const config = d.loadConfig();
  if (config === null) {
    return {
      exitCode: 1,
      output: null,
      error:
        "Control Plane not configured. Create ~/.krynix/config.yaml with control_plane.url and control_plane.org_id.",
    };
  }

  // Load credentials
  const creds = d.loadCredentials();
  if (creds === null || (!creds.token && !creds.api_key)) {
    return {
      exitCode: 1,
      output: null,
      error: "Not authenticated. Run 'krynix auth login' or set up an API key.",
    };
  }

  // Fail fast on expired token to avoid a confusing server-side 401
  if (creds.token && isTokenExpired(creds)) {
    return {
      exitCode: 1,
      output: null,
      error: "Token has expired. Run 'krynix auth login' to refresh.",
    };
  }

  const client = d.createClient(config, creds);
  const results: PushArtifactResult[] = [];

  // Push trace
  if (tracePath !== undefined) {
    try {
      const response = await client.pushTrace(tracePath);
      results.push({
        type: "trace",
        path: tracePath,
        status: response.ok ? "success" : "error",
        response,
        error: response.error,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        type: "trace",
        path: tracePath,
        status: "error",
        response: null,
        error: message,
      });
    }
  }

  // Push evaluation
  if (evaluationPath !== undefined) {
    try {
      const content = await readFile(evaluationPath, "utf-8");
      const data = JSON.parse(content) as unknown;
      const response = await client.pushEvaluation(data);
      results.push({
        type: "evaluation",
        path: evaluationPath,
        status: response.ok ? "success" : "error",
        response,
        error: response.error,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        type: "evaluation",
        path: evaluationPath,
        status: "error",
        response: null,
        error: message,
      });
    }
  }

  // Push replay report
  if (replayReportPath !== undefined) {
    try {
      const content = await readFile(replayReportPath, "utf-8");
      const data = JSON.parse(content) as unknown;
      const response = await client.pushReplayReport(data);
      results.push({
        type: "replay_report",
        path: replayReportPath,
        status: response.ok ? "success" : "error",
        response,
        error: response.error,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        type: "replay_report",
        path: replayReportPath,
        status: "error",
        response: null,
        error: message,
      });
    }
  }

  const hasErrors = results.some((r) => r.status === "error");
  const output: PushOutput = { results };

  return {
    exitCode: hasErrors ? 1 : 0,
    output,
    error: null,
  };
}
