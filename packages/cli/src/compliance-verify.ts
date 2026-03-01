/**
 * CLI `compliance verify` command — verify a compliance bundle's integrity.
 *
 * Reads the bundle directory, checks the manifest, and verifies SHA-256
 * digests for all artifacts.
 *
 * @module
 */

import type { BundleVerificationResult } from "@krynix/core";
import { getArg } from "./arg-parser.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from the compliance verify command. */
export interface ComplianceVerifyResult {
  exitCode: number;
  output: BundleVerificationResult | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

/** Injectable dependencies for compliance verify command (for testing). */
export interface ComplianceVerifyDeps {
  verifyBundle: (bundleDir: string) => Promise<BundleVerificationResult>;
}

async function defaultVerifyBundle(bundleDir: string): Promise<BundleVerificationResult> {
  const { verifyComplianceBundle } = await import("@krynix/core");
  return verifyComplianceBundle(bundleDir);
}

const defaultDeps: ComplianceVerifyDeps = {
  verifyBundle: defaultVerifyBundle,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the `compliance verify` command.
 *
 * @param args - CLI arguments after removing the "compliance verify" tokens
 * @param deps - Injectable dependencies (for testing)
 * @returns Structured result
 */
export async function runComplianceVerify(
  args: string[],
  deps: Partial<ComplianceVerifyDeps> = {},
): Promise<ComplianceVerifyResult> {
  const d = { ...defaultDeps, ...deps };

  const dir = getArg(args, "--dir");

  if (dir === undefined) {
    return {
      exitCode: 1,
      output: null,
      error: "Missing required --dir flag.\nUsage: krynix compliance verify --dir <bundle-dir>",
    };
  }

  try {
    const result = await d.verifyBundle(dir);

    return {
      exitCode: result.valid ? 0 : 1,
      output: result,
      error: null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      output: null,
      error: message,
    };
  }
}
