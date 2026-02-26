/**
 * CLI `policy push` command — publish a policy to the Control Plane registry.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import { getArg } from "./arg-parser.js";
import { loadConfig, type ControlPlaneConfig } from "./config.js";
import { loadCredentials, isTokenExpired, type Credentials } from "./credentials.js";
import { createControlPlaneClient, type ControlPlaneClient } from "./http-client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from the policy push command. */
export interface PolicyPushResult {
  exitCode: number;
  result: PolicyPushOutput | null;
  error: string | null;
}

/** Output from a successful policy push. */
export interface PolicyPushOutput {
  published: boolean;
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

/** Injectable dependencies for policy push command (for testing). */
export interface PolicyPushDeps {
  loadConfig: (path?: string) => ControlPlaneConfig | null;
  loadCredentials: (path?: string) => Credentials | null;
  createClient: (config: ControlPlaneConfig, creds: Credentials) => ControlPlaneClient;
  parsePolicy: (yamlContent: string) => { metadata: { name: string; version: string } };
}

// We dynamically import parsePolicy to avoid a hard dependency on @krynix/policy.
// In production, the monorepo ensures it's available. In tests, it's injected.
let parsePolicyFn:
  | ((yamlContent: string) => { metadata: { name: string; version: string } })
  | null = null;

async function getParsePolicy(): Promise<
  (yamlContent: string) => { metadata: { name: string; version: string } }
> {
  if (parsePolicyFn != null) return parsePolicyFn;
  // Dynamic import for the policy parser
  const mod = await import("@krynix/policy");
  if (typeof mod.parsePolicy !== "function") {
    throw new Error("@krynix/policy does not export parsePolicy");
  }
  parsePolicyFn = mod.parsePolicy as (yamlContent: string) => {
    metadata: { name: string; version: string };
  };
  return parsePolicyFn;
}

const defaultDeps = {
  loadConfig,
  loadCredentials,
  createClient: createControlPlaneClient,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the `policy push` command.
 *
 * @param args - CLI arguments after removing "policy" and "push" tokens
 * @param deps - Injectable dependencies (for testing)
 */
export async function runPolicyPush(
  args: string[],
  deps: Partial<PolicyPushDeps> = {},
): Promise<PolicyPushResult> {
  const d = { ...defaultDeps, ...deps };

  const filePath = getArg(args, "--file");
  const changelog = getArg(args, "--changelog");

  if (filePath === undefined) {
    return {
      exitCode: 1,
      result: null,
      error: "Missing required --file flag. Usage: krynix policy push --file <path>",
    };
  }

  // Load config
  const config = d.loadConfig();
  if (config === null) {
    return {
      exitCode: 1,
      result: null,
      error:
        "Control Plane not configured. Create ~/.krynix/config.yaml with control_plane.url and control_plane.org_id.",
    };
  }

  // Load credentials
  const creds = d.loadCredentials();
  if (creds === null || (!creds.token && !creds.api_key)) {
    return {
      exitCode: 1,
      result: null,
      error: "Not authenticated. Run 'krynix auth login' or set up an API key.",
    };
  }

  // Fail fast on expired token to avoid a confusing server-side 401
  if (creds.token && isTokenExpired(creds)) {
    return {
      exitCode: 1,
      result: null,
      error: "Token has expired. Run 'krynix auth login' to refresh.",
    };
  }

  try {
    // Read and validate policy file
    const yamlContent = await readFile(filePath, "utf-8");

    // Validate policy schema
    const parseFn = d.parsePolicy ?? (await getParsePolicy());
    let policyMeta: { name: string; version: string };
    try {
      const parsed = parseFn(yamlContent);
      policyMeta = parsed.metadata;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        exitCode: 1,
        result: null,
        error: `Invalid policy file: ${message}`,
      };
    }

    // Push to registry
    const client = d.createClient(config, creds);
    const response = await client.pushPolicy(yamlContent, changelog);

    if (!response.ok) {
      return {
        exitCode: 1,
        result: null,
        error: `Failed to push policy: ${response.error ?? `HTTP ${String(response.status)}`}`,
      };
    }

    return {
      exitCode: 0,
      result: {
        published: true,
        name: policyMeta.name,
        version: policyMeta.version,
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, result: null, error: message };
  }
}
