/**
 * Compliance bundle verification.
 *
 * Reads a bundle directory's `manifest.json`, then verifies every
 * artifact's SHA-256 digest. Reports per-artifact errors for mismatches,
 * missing files, and path traversal attempts.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { BundleManifest } from "./compliance-bundle.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result of verifying a compliance bundle. */
export interface BundleVerificationResult {
  valid: boolean;
  manifest_found: boolean;
  artifact_count: number;
  verified_count: number;
  errors: BundleVerificationError[];
}

/** A single verification error. */
export interface BundleVerificationError {
  artifact_path: string;
  expected_digest: string;
  actual_digest: string;
  error_type: "digest_mismatch" | "file_missing" | "path_traversal" | "manifest_parse_error";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_MANIFEST_VERSIONS = new Set(["1.0.0"]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a compliance bundle directory.
 *
 * Reads `manifest.json`, then checks every artifact's SHA-256 digest.
 * Artifact paths are resolved and must remain under `bundleDir`.
 *
 * @param bundleDir - Path to the bundle directory
 * @returns Verification result with per-artifact errors
 * @throws Error if `bundleDir` does not exist
 */
export async function verifyComplianceBundle(bundleDir: string): Promise<BundleVerificationResult> {
  // Ensure bundle dir exists
  try {
    const s = await stat(bundleDir);
    if (!s.isDirectory()) {
      throw new Error(`Not a directory: ${bundleDir}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Bundle directory does not exist: ${bundleDir}`);
    }
    throw err;
  }

  // Read manifest
  const manifestPath = join(bundleDir, "manifest.json");
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf-8");
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        valid: false,
        manifest_found: false,
        artifact_count: 0,
        verified_count: 0,
        errors: [],
      };
    }
    throw err;
  }

  // Parse manifest
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestRaw);
  } catch {
    return {
      valid: false,
      manifest_found: true,
      artifact_count: 0,
      verified_count: 0,
      errors: [
        {
          artifact_path: "manifest.json",
          expected_digest: "",
          actual_digest: "",
          error_type: "manifest_parse_error",
        },
      ],
    };
  }

  // Validate manifest shape (must be a non-null, non-array object)
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      manifest_found: true,
      artifact_count: 0,
      verified_count: 0,
      errors: [
        {
          artifact_path: "manifest.json",
          expected_digest: "",
          actual_digest: "",
          error_type: "manifest_parse_error",
        },
      ],
    };
  }

  const manifest = parsed as BundleManifest;

  // Check manifest version
  if (!SUPPORTED_MANIFEST_VERSIONS.has(manifest.manifest_version)) {
    return {
      valid: false,
      manifest_found: true,
      artifact_count: 0,
      verified_count: 0,
      errors: [
        {
          artifact_path: "manifest.json",
          expected_digest: "",
          actual_digest: "",
          error_type: "manifest_parse_error",
        },
      ],
    };
  }

  // Validate artifacts schema
  const rawArtifacts: unknown = manifest.artifacts ?? [];
  if (!Array.isArray(rawArtifacts)) {
    return {
      valid: false,
      manifest_found: true,
      artifact_count: 0,
      verified_count: 0,
      errors: [
        {
          artifact_path: "manifest.json",
          expected_digest: "",
          actual_digest: "",
          error_type: "manifest_parse_error",
        },
      ],
    };
  }

  const artifacts: Array<{ path: string; digest: string }> = [];
  for (const entry of rawArtifacts) {
    const p =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>).path
        : undefined;
    const d =
      typeof entry === "object" && entry !== null
        ? (entry as Record<string, unknown>).digest
        : undefined;
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof p !== "string" ||
      typeof d !== "string" ||
      p === "" ||
      p === "." ||
      p === "./" ||
      p.endsWith("/")
    ) {
      return {
        valid: false,
        manifest_found: true,
        artifact_count: rawArtifacts.length,
        verified_count: 0,
        errors: [
          {
            artifact_path: "manifest.json",
            expected_digest: "",
            actual_digest: "",
            error_type: "manifest_parse_error",
          },
        ],
      };
    }
    artifacts.push({ path: p, digest: d });
  }

  const errors: BundleVerificationError[] = [];
  let verifiedCount = 0;
  const resolvedBundleDir = resolve(bundleDir);
  const realBundleDir = await realpath(bundleDir);

  for (const artifact of artifacts) {
    const artifactFullPath = resolve(join(bundleDir, artifact.path));

    // Lexical path traversal check (catches ".." components)
    if (
      !artifactFullPath.startsWith(resolvedBundleDir + sep) &&
      artifactFullPath !== resolvedBundleDir
    ) {
      errors.push({
        artifact_path: artifact.path,
        expected_digest: artifact.digest,
        actual_digest: "",
        error_type: "path_traversal",
      });
      continue;
    }

    // Resolve real path to catch symlinked intermediate directories
    let realArtifactPath: string;
    try {
      realArtifactPath = await realpath(artifactFullPath);
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        ((err as NodeJS.ErrnoException).code === "ENOENT" ||
          (err as NodeJS.ErrnoException).code === "ENOTDIR")
      ) {
        errors.push({
          artifact_path: artifact.path,
          expected_digest: artifact.digest,
          actual_digest: "",
          error_type: "file_missing",
        });
        continue;
      }
      throw err;
    }

    // Verify real path stays under the real bundle directory
    if (!realArtifactPath.startsWith(realBundleDir + sep) && realArtifactPath !== realBundleDir) {
      errors.push({
        artifact_path: artifact.path,
        expected_digest: artifact.digest,
        actual_digest: "",
        error_type: "path_traversal",
      });
      continue;
    }

    // Read artifact using the resolved real path (avoids TOCTOU)
    let content: string;
    try {
      content = await readFile(realArtifactPath, "utf-8");
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        errors.push({
          artifact_path: artifact.path,
          expected_digest: artifact.digest,
          actual_digest: "",
          error_type: "file_missing",
        });
        continue;
      }
      throw err;
    }

    // Verify digest
    const actualDigest = `sha256:${sha256(content)}`;
    if (actualDigest !== artifact.digest) {
      errors.push({
        artifact_path: artifact.path,
        expected_digest: artifact.digest,
        actual_digest: actualDigest,
        error_type: "digest_mismatch",
      });
      continue;
    }

    verifiedCount++;
  }

  return {
    valid: errors.length === 0,
    manifest_found: true,
    artifact_count: artifacts.length,
    verified_count: verifiedCount,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
