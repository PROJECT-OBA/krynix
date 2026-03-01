import { describe, test, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyComplianceBundle } from "./bundle-verifier.js";
import { generateComplianceBundle, writeComplianceBundleToDir } from "./compliance-bundle.js";
import { computeHashChain } from "./hash-chain.js";
import type { TraceEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<TraceEvent> & { event_type: TraceEvent["event_type"]; payload: unknown },
): TraceEvent {
  return {
    event_id: "evt-1",
    session_id: "sess-1",
    sequence_num: 0,
    timestamp: "2025-01-15T14:00:00.000Z",
    parent_id: null,
    agent_id: "agent-1",
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: "1.0.0",
    ...overrides,
  } as TraceEvent;
}

function makeHashedTrace(sessionId: string): TraceEvent[] {
  const raw = [
    makeEvent({
      event_id: "evt-0",
      sequence_num: 0,
      event_type: "lifecycle",
      payload: { action: "session_start", context: {} },
    }),
    makeEvent({
      event_id: "evt-1",
      sequence_num: 1,
      event_type: "tool_call",
      payload: { tool_name: "read_file", arguments: { path: "/tmp" } },
    }),
    makeEvent({
      event_id: "evt-2",
      sequence_num: 2,
      event_type: "lifecycle",
      payload: { action: "session_end" },
    }),
  ].map((e) => ({ ...e, session_id: sessionId }) as TraceEvent);

  return computeHashChain(raw);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyComplianceBundle", () => {
  let tmpDir: string;

  async function setup(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-verify-"));
    return tmpDir;
  }

  async function cleanup(): Promise<void> {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  test("valid bundle passes verification", async () => {
    await setup();
    try {
      const trace = makeHashedTrace("sess-v");
      const bundle = generateComplianceBundle({
        traces: [{ session_id: "sess-v", events: trace }],
        export_id: "export-v",
        generated_at: "2025-01-01T00:00:00Z",
      });

      const bundleDir = join(tmpDir, "bundle");
      await writeComplianceBundleToDir(bundle, bundleDir);

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(true);
      expect(result.manifest_found).toBe(true);
      expect(result.artifact_count).toBe(3); // trace + hash-chain + stats
      expect(result.verified_count).toBe(3);
      expect(result.errors).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  test("digest mismatch detected", async () => {
    await setup();
    try {
      const trace = makeHashedTrace("sess-m");
      const bundle = generateComplianceBundle({
        traces: [{ session_id: "sess-m", events: trace }],
        export_id: "export-m",
        generated_at: "2025-01-01T00:00:00Z",
      });

      const bundleDir = join(tmpDir, "bundle");
      await writeComplianceBundleToDir(bundle, bundleDir);

      // Tamper with the trace file
      await writeFile(
        join(bundleDir, "traces", "sess-m.trace.jsonl"),
        "tampered content\n",
        "utf-8",
      );

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      const mismatchError = result.errors.find((e) => e.error_type === "digest_mismatch");
      expect(mismatchError).toBeDefined();
      expect(mismatchError?.artifact_path).toContain("sess-m.trace.jsonl");
    } finally {
      await cleanup();
    }
  });

  test("missing artifact detected", async () => {
    await setup();
    try {
      const trace = makeHashedTrace("sess-miss");
      const bundle = generateComplianceBundle({
        traces: [{ session_id: "sess-miss", events: trace }],
        export_id: "export-miss",
        generated_at: "2025-01-01T00:00:00Z",
      });

      const bundleDir = join(tmpDir, "bundle");
      await writeComplianceBundleToDir(bundle, bundleDir);

      // Delete a trace file
      await rm(join(bundleDir, "traces", "sess-miss.trace.jsonl"));

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      const missingError = result.errors.find((e) => e.error_type === "file_missing");
      expect(missingError).toBeDefined();
      expect(missingError?.artifact_path).toContain("sess-miss.trace.jsonl");
    } finally {
      await cleanup();
    }
  });

  test("missing manifest.json", async () => {
    await setup();
    try {
      const bundleDir = join(tmpDir, "empty-bundle");
      await mkdir(bundleDir, { recursive: true });

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      expect(result.manifest_found).toBe(false);
    } finally {
      await cleanup();
    }
  });

  test("corrupt manifest JSON", async () => {
    await setup();
    try {
      const bundleDir = join(tmpDir, "corrupt-bundle");
      await mkdir(bundleDir, { recursive: true });
      await writeFile(join(bundleDir, "manifest.json"), "not valid json {{{{", "utf-8");

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      expect(result.manifest_found).toBe(true);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.error_type).toBe("manifest_parse_error");
    } finally {
      await cleanup();
    }
  });

  test("unknown manifest_version rejected", async () => {
    await setup();
    try {
      const bundleDir = join(tmpDir, "bad-version");
      await mkdir(bundleDir, { recursive: true });
      await writeFile(
        join(bundleDir, "manifest.json"),
        JSON.stringify({ manifest_version: "99.0.0", artifacts: [] }),
        "utf-8",
      );

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.error_type).toBe("manifest_parse_error");
    } finally {
      await cleanup();
    }
  });

  test("non-array artifacts returns manifest_parse_error", async () => {
    await setup();
    try {
      const bundleDir = join(tmpDir, "bad-artifacts-type");
      await mkdir(bundleDir, { recursive: true });
      await writeFile(
        join(bundleDir, "manifest.json"),
        JSON.stringify({
          manifest_version: "1.0.0",
          artifacts: "not-an-array",
          export_id: "x",
          org_id: "",
          generated_at: "2025-01-01T00:00:00Z",
          generated_by: "test",
          krynix_engine_version: "1.0.0",
          trace_count: 0,
          redaction_notice: "",
          integrity_note: "",
        }),
        "utf-8",
      );

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      expect(result.manifest_found).toBe(true);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.error_type).toBe("manifest_parse_error");
    } finally {
      await cleanup();
    }
  });

  test("artifact with non-string path/digest returns manifest_parse_error", async () => {
    await setup();
    try {
      const bundleDir = join(tmpDir, "bad-artifact-entry");
      await mkdir(bundleDir, { recursive: true });
      await writeFile(
        join(bundleDir, "manifest.json"),
        JSON.stringify({
          manifest_version: "1.0.0",
          artifacts: [{ path: 123, digest: null }],
          export_id: "x",
          org_id: "",
          generated_at: "2025-01-01T00:00:00Z",
          generated_by: "test",
          krynix_engine_version: "1.0.0",
          trace_count: 0,
          redaction_notice: "",
          integrity_note: "",
        }),
        "utf-8",
      );

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      expect(result.manifest_found).toBe(true);
      expect(result.artifact_count).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.error_type).toBe("manifest_parse_error");
    } finally {
      await cleanup();
    }
  });

  test("empty bundle (no artifacts) passes", async () => {
    await setup();
    try {
      const bundle = generateComplianceBundle({
        traces: [],
        export_id: "export-empty",
        generated_at: "2025-01-01T00:00:00Z",
      });

      const bundleDir = join(tmpDir, "empty");
      await writeComplianceBundleToDir(bundle, bundleDir);

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(true);
      expect(result.artifact_count).toBe(0);
      expect(result.verified_count).toBe(0);
    } finally {
      await cleanup();
    }
  });

  test("path traversal in artifact path detected", async () => {
    await setup();
    try {
      const bundleDir = join(tmpDir, "traversal");
      await mkdir(bundleDir, { recursive: true });

      const manifest = {
        manifest_version: "1.0.0",
        export_id: "export-trav",
        org_id: "",
        generated_at: "2025-01-01T00:00:00Z",
        generated_by: "krynix-cli",
        krynix_engine_version: "1.0.0",
        trace_count: 0,
        artifacts: [
          {
            path: "../../etc/passwd",
            type: "trace",
            digest: "sha256:abc123",
          },
        ],
        redaction_notice: "",
        integrity_note: "",
      };

      await writeFile(join(bundleDir, "manifest.json"), JSON.stringify(manifest), "utf-8");

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.error_type).toBe("path_traversal");
    } finally {
      await cleanup();
    }
  });

  test("nonexistent bundle dir throws", async () => {
    await expect(verifyComplianceBundle("/nonexistent/bundle/dir")).rejects.toThrow(
      "Bundle directory does not exist",
    );
  });

  test("symlink artifact is rejected with path_traversal (POSIX only)", async () => {
    if (process.platform === "win32") return;

    await setup();
    try {
      const { symlink, writeFile: wf } = await import("node:fs/promises");
      const bundleDir = join(tmpDir, "symlink-bundle");
      await mkdir(bundleDir, { recursive: true });
      await mkdir(join(bundleDir, "traces"), { recursive: true });

      // Create a file outside the bundle directory
      const outsidePath = join(tmpDir, "outside-secret.txt");
      await wf(outsidePath, "secret content\n", "utf-8");

      // Create a symlink inside the bundle dir pointing to the outside file
      const symlinkPath = join(bundleDir, "traces", "linked.trace.jsonl");
      await symlink(outsidePath, symlinkPath);

      // Write a manifest referencing the symlink
      const manifest = {
        manifest_version: "1.0.0",
        export_id: "export-sym",
        org_id: "",
        generated_at: "2025-01-01T00:00:00Z",
        generated_by: "krynix-cli",
        krynix_engine_version: "1.0.0",
        trace_count: 0,
        artifacts: [
          {
            path: "traces/linked.trace.jsonl",
            type: "trace",
            digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
        redaction_notice: "",
        integrity_note: "",
      };

      await wf(join(bundleDir, "manifest.json"), JSON.stringify(manifest), "utf-8");

      const result = await verifyComplianceBundle(bundleDir);

      // Symlinks are now rejected before readFile can follow them
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.error_type).toBe("path_traversal");
    } finally {
      await cleanup();
    }
  });

  test("intermediate symlinked directory is rejected (POSIX only)", async () => {
    if (process.platform === "win32") return;

    await setup();
    try {
      const { symlink, writeFile: wf } = await import("node:fs/promises");
      const bundleDir = join(tmpDir, "symdir-bundle");
      await mkdir(bundleDir, { recursive: true });

      // Create a directory outside the bundle
      const outsideDir = join(tmpDir, "outside-dir");
      await mkdir(outsideDir, { recursive: true });
      await wf(join(outsideDir, "secret.txt"), "secret content\n", "utf-8");

      // Create a symlink *directory* inside the bundle pointing outside
      const symlinkDir = join(bundleDir, "traces");
      await symlink(outsideDir, symlinkDir);

      // Write a manifest referencing an artifact through the symlinked directory
      const manifest = {
        manifest_version: "1.0.0",
        export_id: "export-symdir",
        org_id: "",
        generated_at: "2025-01-01T00:00:00Z",
        generated_by: "krynix-cli",
        krynix_engine_version: "1.0.0",
        trace_count: 0,
        artifacts: [
          {
            path: "traces/secret.txt",
            type: "trace",
            digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
        redaction_notice: "",
        integrity_note: "",
      };

      await wf(join(bundleDir, "manifest.json"), JSON.stringify(manifest), "utf-8");

      const result = await verifyComplianceBundle(bundleDir);

      // The intermediate directory symlink causes the real path to escape the bundle
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.error_type).toBe("path_traversal");
    } finally {
      await cleanup();
    }
  });

  test("round-trip: generate → write → verify", async () => {
    await setup();
    try {
      const trace = makeHashedTrace("sess-rt");
      const evaluation = { verdict: "pass", violations: [] };
      const replayReport = { result_status: "pass" };

      const bundle = generateComplianceBundle({
        traces: [
          {
            session_id: "sess-rt",
            events: trace,
            evaluation,
            replay_report: replayReport,
          },
        ],
        include_otlp: true,
        export_id: "export-rt",
        generated_at: "2025-01-01T00:00:00Z",
      });

      const bundleDir = join(tmpDir, "roundtrip");
      await writeComplianceBundleToDir(bundle, bundleDir);

      const result = await verifyComplianceBundle(bundleDir);

      expect(result.valid).toBe(true);
      expect(result.manifest_found).toBe(true);
      // trace + hash-chain + evaluation + replay + stats + otlp = 6
      expect(result.artifact_count).toBe(6);
      expect(result.verified_count).toBe(6);
      expect(result.errors).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });
});
