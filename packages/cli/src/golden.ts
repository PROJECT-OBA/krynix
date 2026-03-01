/**
 * CLI `golden` namespace — Golden Trace Registry commands.
 *
 * Subcommands:
 * - `golden promote` — Promote a trace to golden status in the CP registry
 * - `golden list` — List golden traces from the CP registry
 * - `golden pull` — Download a golden trace from the CP registry
 *
 * @module
 */

import { getArg, getAllArgs } from "./arg-parser.js";
import { loadConfig, type ControlPlaneConfig } from "./config.js";
import { loadCredentials, isTokenExpired, type Credentials } from "./credentials.js";
import {
  createControlPlaneClient,
  type ControlPlaneClient,
  type GoldenTraceMetadata,
  type GoldenTraceFilters,
} from "./http-client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from any golden command. */
export interface GoldenResult {
  exitCode: number;
  output: unknown;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

/** Injectable deps for golden commands. */
export interface GoldenDeps {
  loadConfig: () => ControlPlaneConfig | null;
  loadCredentials: () => Credentials | null;
  isTokenExpired: (creds: Credentials) => boolean;
  createClient: (config: ControlPlaneConfig, creds: Credentials) => ControlPlaneClient;
}

const defaultDeps: GoldenDeps = {
  loadConfig,
  loadCredentials,
  isTokenExpired,
  createClient: (config, creds) => createControlPlaneClient(config, creds),
};

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------

function resolveClient(deps: GoldenDeps): { client: ControlPlaneClient } | { error: GoldenResult } {
  const config = deps.loadConfig();
  if (config === null) {
    return {
      error: {
        exitCode: 1,
        output: null,
        error:
          "Control Plane not configured. Create ~/.krynix/config.yaml with a `control_plane` section.",
      },
    };
  }

  const creds = deps.loadCredentials();
  if (creds === null) {
    return {
      error: {
        exitCode: 1,
        output: null,
        error: "Not authenticated. Run `krynix auth login` first.",
      },
    };
  }

  if (
    (typeof creds.token !== "string" || creds.token === "") &&
    (typeof creds.api_key !== "string" || creds.api_key === "")
  ) {
    return {
      error: {
        exitCode: 1,
        output: null,
        error: "Credentials contain no token or API key.",
      },
    };
  }

  if (deps.isTokenExpired(creds)) {
    return {
      error: {
        exitCode: 1,
        output: null,
        error: "Token expired. Run `krynix auth login` to refresh.",
      },
    };
  }

  return { client: deps.createClient(config, creds) };
}

// ---------------------------------------------------------------------------
// Label parser
// ---------------------------------------------------------------------------

function parseLabels(args: string[]): Record<string, string> {
  const raw = getAllArgs(args, "--label");
  const labels: Record<string, string> = {};
  for (const entry of raw) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx === -1) {
      throw new Error('Invalid --label value (missing "=" separator). Expected format: key=value');
    }
    const key = entry.slice(0, eqIdx);
    if (key.length === 0) {
      throw new Error("Invalid --label value (empty key). Expected format: key=value");
    }
    labels[key] = entry.slice(eqIdx + 1);
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/** `golden promote --trace <file> --name <name> [--description <desc>] [--label <k>=<v>]` */
export async function runGoldenPromote(
  args: string[],
  deps: Partial<GoldenDeps> = {},
): Promise<GoldenResult> {
  const d = { ...defaultDeps, ...deps };

  const tracePath = getArg(args, "--trace");
  if (tracePath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required --trace flag." };
  }

  const name = getArg(args, "--name");
  if (name === undefined) {
    return { exitCode: 1, output: null, error: "Missing required --name flag." };
  }

  const resolved = resolveClient(d);
  if ("error" in resolved) return resolved.error;

  const description = getArg(args, "--description");
  let labels: Record<string, string>;
  try {
    labels = parseLabels(args);
  } catch (err: unknown) {
    return { exitCode: 1, output: null, error: String(err instanceof Error ? err.message : err) };
  }

  const metadata: GoldenTraceMetadata = {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
  };

  const response = await resolved.client.promoteGoldenTrace(tracePath, metadata);
  if (!response.ok) {
    return { exitCode: 1, output: response.data, error: response.error };
  }
  return { exitCode: 0, output: response.data, error: null };
}

/** `golden list [--name <filter>] [--label <filter>] [--limit <n>]` */
export async function runGoldenList(
  args: string[],
  deps: Partial<GoldenDeps> = {},
): Promise<GoldenResult> {
  const d = { ...defaultDeps, ...deps };

  const resolved = resolveClient(d);
  if ("error" in resolved) return resolved.error;

  const filters: GoldenTraceFilters = {};
  const name = getArg(args, "--name");
  if (name !== undefined) filters.name = name;
  const label = getArg(args, "--label");
  if (label !== undefined) filters.label = label;
  const limitStr = getArg(args, "--limit");
  if (limitStr !== undefined) {
    const n = Number(limitStr);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
      return {
        exitCode: 1,
        output: null,
        error: "Invalid --limit value. Must be a positive integer.",
      };
    }
    filters.limit = n;
  }

  const response = await resolved.client.listGoldenTraces(
    Object.keys(filters).length > 0 ? filters : undefined,
  );
  if (!response.ok) {
    return { exitCode: 1, output: response.data, error: response.error };
  }
  return { exitCode: 0, output: response.data, error: null };
}

/** `golden pull --id <golden-trace-id> --output <file>` */
export async function runGoldenPull(
  args: string[],
  deps: Partial<GoldenDeps> = {},
): Promise<GoldenResult> {
  const d = { ...defaultDeps, ...deps };

  const id = getArg(args, "--id");
  if (id === undefined) {
    return { exitCode: 1, output: null, error: "Missing required --id flag." };
  }

  const output = getArg(args, "--output");
  if (output === undefined) {
    return { exitCode: 1, output: null, error: "Missing required --output flag." };
  }

  const resolved = resolveClient(d);
  if ("error" in resolved) return resolved.error;

  const response = await resolved.client.pullGoldenTrace(id, output);
  if (!response.ok) {
    return { exitCode: 1, output: response.data, error: response.error };
  }
  return { exitCode: 0, output: response.data, error: null };
}
