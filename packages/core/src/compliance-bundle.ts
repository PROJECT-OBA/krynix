/**
 * Local compliance evidence bundle generator.
 *
 * Assembles audit-ready evidence bundles from traces, evaluations,
 * replay reports, stats, and OTLP exports. Produces a manifest with
 * SHA-256 digests for integrity verification.
 *
 * See `docs/10_architecture/control_plane_spec.md` Section 6 for the
 * bundle format specification.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile, realpath, lstat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { TraceEvent, ValidationResult } from "./types.js";
import { computeTraceStats, type TraceStats } from "./trace-stats.js";
import { convertToOtlp, type OtlpExportData } from "./otlp-export.js";
import { validateHashChain } from "./hash-chain.js";
import { SCHEMA_VERSION } from "./types.js";
import { canonicalize } from "./canonical-json.js";
import type { EnvironmentContext } from "./environment.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Input for a single trace in a compliance bundle. */
export interface TraceInput {
  /** Session ID (used as file name prefix). */
  session_id: string;
  /** The trace events. */
  events: readonly TraceEvent[];
  /** Optional evaluation result JSON (arbitrary, stored as-is). */
  evaluation?: unknown;
  /** Optional replay report JSON (arbitrary, stored as-is). */
  replay_report?: unknown;
}

/** Options for generating a compliance bundle. */
export interface ComplianceBundleOptions {
  /** Traces to include in the bundle. */
  traces: readonly TraceInput[];
  /** Whether to include OTLP exports. */
  include_otlp?: boolean;
  /**
   * Organization ID. Required for CP-conformant bundles; defaults to empty
   * string for local-only bundles. The CLI should pass `config.org_id` when
   * a Control Plane config is available.
   */
  org_id?: string;
  /** Krynix engine version override (defaults to SCHEMA_VERSION). */
  engine_version?: string;
  /** Export ID override (defaults to generated timestamp-based ID). */
  export_id?: string;
  /** Generated-at timestamp override (defaults to current ISO timestamp). */
  generated_at?: string;
  /** Optional environment context to include in the bundle manifest. */
  environment?: EnvironmentContext;
}

/** A single artifact in the bundle. */
export interface BundleArtifact {
  /** Relative path within the bundle directory. */
  path: string;
  /** Artifact type. */
  type: "trace" | "evaluation" | "replay_report" | "stats" | "otlp" | "hash_chain_verification";
  /** SHA-256 hex digest of the content. */
  digest: string;
  /** Content as a string (JSONL for traces, JSON for the rest). */
  content: string;
  /** Hash chain validity (only for trace artifacts). */
  hash_chain_valid?: boolean;
  /** Event count (only for trace artifacts). */
  event_count?: number;
}

/** The bundle manifest. */
export interface BundleManifest {
  manifest_version: string;
  export_id: string;
  org_id: string;
  generated_at: string;
  generated_by: string;
  krynix_engine_version: string;
  trace_count: number;
  artifacts: Array<{
    path: string;
    type: string;
    digest: string;
    hash_chain_valid?: boolean;
    event_count?: number;
  }>;
  redaction_notice: string;
  integrity_note: string;
  environment?: EnvironmentContext;
}

/** A complete compliance evidence bundle (in-memory). */
export interface ComplianceBundle {
  /** The bundle manifest. */
  manifest: BundleManifest;
  /** All artifacts in the bundle. */
  artifacts: readonly BundleArtifact[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REDACTION_NOTICE =
  "All trace data was redacted at the source using Krynix automatic redaction. No pre-redaction data is included in this bundle.";
const INTEGRITY_NOTE =
  "Verify this bundle by computing SHA-256 of each artifact file and comparing against the digest in this manifest.";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a compliance evidence bundle in memory.
 *
 * Does not perform I/O. When `export_id` and `generated_at` are supplied
 * via options, the output is fully deterministic (same inputs → same output).
 *
 * @param options - Bundle configuration and trace inputs
 * @returns A complete bundle with manifest and artifacts
 */
export function generateComplianceBundle(options: ComplianceBundleOptions): ComplianceBundle {
  const {
    traces,
    include_otlp = false,
    org_id = "",
    engine_version,
    export_id,
    generated_at,
    environment,
  } = options;

  const artifacts: BundleArtifact[] = [];

  for (const traceInput of traces) {
    // Sanitize session_id: reject path separators, traversal sequences,
    // empty strings, and control characters so the in-memory bundle is
    // safe regardless of how consumers write it.
    const sid = traceInput.session_id;
    const hasControlChar = Array.from(sid).some((ch) => {
      const code = ch.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    });
    if (sid.length === 0 || /[/\\]/.test(sid) || sid.includes("..") || hasControlChar) {
      throw new Error("Invalid session_id for bundle artifact");
    }

    // 1. Trace file (.trace.jsonl) — canonical JSON lines, matching TraceWriter format
    const traceContent =
      traceInput.events.length > 0
        ? traceInput.events.map((e) => canonicalize(e)).join("\n") + "\n"
        : "";
    const hashChainResult: ValidationResult = validateHashChain(traceInput.events);
    artifacts.push({
      path: `traces/${sid}.trace.jsonl`,
      type: "trace",
      digest: sha256(traceContent),
      content: traceContent,
      hash_chain_valid: hashChainResult.valid,
      event_count: traceInput.events.length,
    });

    // 2. Hash chain verification result
    const verificationContent = JSON.stringify(hashChainResult, null, 2);
    artifacts.push({
      path: `traces/${sid}.hash-chain.json`,
      type: "hash_chain_verification",
      digest: sha256(verificationContent),
      content: verificationContent,
    });

    // 3. Evaluation result (if present)
    if (traceInput.evaluation !== undefined) {
      const evalContent = JSON.stringify(traceInput.evaluation, null, 2);
      artifacts.push({
        path: `evaluations/${sid}.evaluation.json`,
        type: "evaluation",
        digest: sha256(evalContent),
        content: evalContent,
      });
    }

    // 4. Replay report (if present)
    if (traceInput.replay_report !== undefined) {
      const replayContent = JSON.stringify(traceInput.replay_report, null, 2);
      artifacts.push({
        path: `replays/${sid}.replay.json`,
        type: "replay_report",
        digest: sha256(replayContent),
        content: replayContent,
      });
    }

    // 5. Trace statistics
    const stats: TraceStats = computeTraceStats(traceInput.events);
    const statsContent = JSON.stringify(stats, null, 2);
    artifacts.push({
      path: `stats/${sid}.stats.json`,
      type: "stats",
      digest: sha256(statsContent),
      content: statsContent,
    });

    // 6. OTLP export (if requested)
    if (include_otlp) {
      const otlp: OtlpExportData = convertToOtlp(traceInput.events);
      const otlpContent = JSON.stringify(otlp, null, 2);
      artifacts.push({
        path: `otlp/${sid}.otlp.json`,
        type: "otlp",
        digest: sha256(otlpContent),
        content: otlpContent,
      });
    }
  }

  // Build manifest
  const manifest: BundleManifest = {
    manifest_version: "1.0.0",
    export_id: export_id ?? generateExportId(),
    org_id,
    generated_at: generated_at ?? new Date().toISOString(),
    generated_by: "krynix-cli",
    krynix_engine_version: engine_version ?? SCHEMA_VERSION,
    trace_count: traces.length,
    artifacts: artifacts.map((a) => {
      const entry: {
        path: string;
        type: string;
        digest: string;
        hash_chain_valid?: boolean;
        event_count?: number;
      } = {
        path: a.path,
        type: a.type,
        digest: `sha256:${a.digest}`,
      };
      if (a.hash_chain_valid !== undefined) {
        entry.hash_chain_valid = a.hash_chain_valid;
      }
      if (a.event_count !== undefined) {
        entry.event_count = a.event_count;
      }
      return entry;
    }),
    redaction_notice: REDACTION_NOTICE,
    integrity_note: INTEGRITY_NOTE,
    ...(environment ? { environment } : {}),
  };

  return { manifest, artifacts };
}

/**
 * Write a compliance bundle to a directory on disk.
 *
 * Creates the output directory and all subdirectories as needed.
 * The manifest is written as `manifest.json` at the root.
 *
 * @param bundle - The bundle to write
 * @param outputDir - Absolute or relative path to the output directory
 */
export async function writeComplianceBundleToDir(
  bundle: ComplianceBundle,
  outputDir: string,
): Promise<void> {
  // Create output dir
  await mkdir(outputDir, { recursive: true });

  const resolvedOutputDir = resolve(outputDir);
  const realOutputDir = await realpath(resolvedOutputDir);

  // Collect subdirs needed, with lexical path traversal check before creating anything
  const subdirs = new Set<string>();
  for (const artifact of bundle.artifacts) {
    // Reject degenerate artifact paths that resolve to the output directory itself
    const p = artifact.path;
    if (p === "" || p === "." || p === "./" || p.endsWith("/")) {
      throw new Error(`Invalid artifact path: ${JSON.stringify(p)}`);
    }

    // Lexical guard against path traversal (catches ".." components)
    const target = join(outputDir, artifact.path);
    const resolvedTarget = resolve(target);
    if (
      !resolvedTarget.startsWith(resolvedOutputDir + sep) &&
      resolvedTarget !== resolvedOutputDir
    ) {
      throw new Error(`Path traversal detected in artifact path: ${artifact.path}`);
    }

    const dir = artifact.path.split("/").slice(0, -1).join("/");
    if (dir) {
      subdirs.add(dir);
    }
  }

  // Create subdirs and verify real paths to catch symlinked directories
  for (const subdir of subdirs) {
    const subdirPath = join(outputDir, subdir);
    await mkdir(subdirPath, { recursive: true });
    const realSubdir = await realpath(subdirPath);
    if (!realSubdir.startsWith(realOutputDir + sep) && realSubdir !== realOutputDir) {
      throw new Error(`Symbolic link escape detected in directory: ${subdir}`);
    }
  }

  // Write artifacts (reject symlinked file targets)
  for (const artifact of bundle.artifacts) {
    const target = join(outputDir, artifact.path);
    await rejectSymlinkTarget(target, artifact.path);
    await writeFile(target, artifact.content, "utf-8");
  }

  // Write manifest (reject symlinked target)
  const manifestPath = join(outputDir, "manifest.json");
  await rejectSymlinkTarget(manifestPath, "manifest.json");
  const manifestContent = JSON.stringify(bundle.manifest, null, 2);
  await writeFile(manifestPath, manifestContent, "utf-8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reject a write target if it already exists as a symbolic link. */
async function rejectSymlinkTarget(filePath: string, label: string): Promise<void> {
  try {
    const s = await lstat(filePath);
    if (s.isSymbolicLink()) {
      throw new Error(`Symbolic link detected at file path: ${label}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return; // File doesn't exist yet — safe to write
    }
    throw err;
  }
}

/** Compute SHA-256 hex digest of a string. */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Generate a simple export ID (timestamp-based, not a full UUID). */
function generateExportId(): string {
  const now = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `export-${String(now)}-${random}`;
}
