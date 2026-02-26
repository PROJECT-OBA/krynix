/**
 * CLI `policy pull` command — fetch policies from the Control Plane registry.
 *
 * @module
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { getArg } from "./arg-parser.js";
import { loadConfig, type ControlPlaneConfig } from "./config.js";
import { loadCredentials, isTokenExpired, type Credentials } from "./credentials.js";
import { createControlPlaneClient, type ControlPlaneClient } from "./http-client.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from the policy pull command. */
export interface PolicyPullResult {
  exitCode: number;
  result: PolicyPullOutput | null;
  error: string | null;
}

/** Output from a successful policy pull. */
export interface PolicyPullOutput {
  policies_fetched: number;
  policies_written: number;
  policies_skipped: number;
  output_dir: string;
}

/** Shape of a policy from the registry API. */
interface RegistryPolicy {
  name: string;
  version: string;
  yaml_content: string;
  digest: string;
}

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

/** Injectable dependencies for policy pull command (for testing). */
export interface PolicyPullDeps {
  loadConfig: (path?: string) => ControlPlaneConfig | null;
  loadCredentials: (path?: string) => Credentials | null;
  createClient: (config: ControlPlaneConfig, creds: Credentials) => ControlPlaneClient;
}

const defaultDeps: PolicyPullDeps = {
  loadConfig,
  loadCredentials,
  createClient: createControlPlaneClient,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the `policy pull` command.
 *
 * @param args - CLI arguments after removing "policy" and "pull" tokens
 * @param deps - Injectable dependencies (for testing)
 */
export async function runPolicyPull(
  args: string[],
  deps: Partial<PolicyPullDeps> = {},
): Promise<PolicyPullResult> {
  const d = { ...defaultDeps, ...deps };

  const labels = getArg(args, "--labels");
  const outputDir = getArg(args, "--output-dir") ?? "./policies";

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

  const client = d.createClient(config, creds);

  try {
    const response = await client.pullPolicies(labels !== undefined ? { labels } : undefined);

    if (!response.ok) {
      return {
        exitCode: 1,
        result: null,
        error: `Failed to pull policies: ${response.error ?? `HTTP ${String(response.status)}`}`,
      };
    }

    const rawData = response.data ?? [];
    if (!Array.isArray(rawData)) {
      return {
        exitCode: 1,
        result: null,
        error: "Unexpected API response: expected an array of policies",
      };
    }
    const policies = rawData as RegistryPolicy[];

    // Create output directory
    await mkdir(outputDir, { recursive: true });

    let written = 0;
    let skipped = 0;
    const resolvedOutputDir = resolve(outputDir);

    for (const policy of policies) {
      // Verify digest
      const computedDigest = `sha256:${createHash("sha256").update(policy.yaml_content, "utf-8").digest("hex")}`;
      if (policy.digest !== computedDigest) {
        // Digest mismatch — skip this policy
        skipped++;
        continue;
      }

      // Sanitize policy name: replace path separators to prevent intermediate dir issues
      const safeName = policy.name.replace(/[/\\]/g, "_");
      const safeVersion = policy.version.replace(/[/\\]/g, "_");

      // Check if file already exists with same content
      const fileName = `${safeName}@${safeVersion}.policy.yaml`;
      const filePath = join(outputDir, fileName);

      // Guard against path traversal from untrusted server data
      const resolvedFilePath = resolve(filePath);
      if (
        !resolvedFilePath.startsWith(resolvedOutputDir + sep) &&
        resolvedFilePath !== resolvedOutputDir
      ) {
        skipped++;
        continue;
      }

      try {
        const existing = await readFile(filePath, "utf-8");
        if (existing === policy.yaml_content) {
          skipped++;
          continue;
        }
      } catch {
        // File doesn't exist, proceed to write
      }

      await writeFile(filePath, policy.yaml_content, "utf-8");
      written++;
    }

    return {
      exitCode: 0,
      result: {
        policies_fetched: policies.length,
        policies_written: written,
        policies_skipped: skipped,
        output_dir: outputDir,
      },
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, result: null, error: message };
  }
}
