import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm, symlink, mkdir as fsMkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { generateComplianceBundle, writeComplianceBundleToDir } from "./compliance-bundle.js";
import type { TraceEvent } from "./types.js";
import { computeHashChain } from "./hash-chain.js";
import { canonicalize } from "./canonical-json.js";

// ---------------------------------------------------------------------------
// Helpers — minimal TraceEvent factory
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

function makeLifecycle(
  action: "session_start" | "session_end",
  timestamp: string,
  seq: number,
): TraceEvent {
  return makeEvent({
    event_id: `evt-${String(seq)}`,
    sequence_num: seq,
    event_type: "lifecycle",
    timestamp,
    payload: { action, context: {} },
  });
}

/** Create a minimal valid hash-chained trace. */
function makeHashedTrace(sessionId: string): TraceEvent[] {
  const raw = [
    makeLifecycle("session_start", "2025-01-15T14:00:00.000Z", 0),
    makeEvent({
      event_id: "evt-1",
      sequence_num: 1,
      event_type: "tool_call",
      payload: { tool_name: "read_file", arguments: { path: "/tmp" } },
    }),
    makeLifecycle("session_end", "2025-01-15T14:00:05.000Z", 2),
  ].map((e) => ({ ...e, session_id: sessionId }) as TraceEvent);

  return computeHashChain(raw);
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateComplianceBundle", () => {
  test("produces valid bundle for a single trace with all artifacts", () => {
    const trace = makeHashedTrace("sess-a");
    const evaluation = { verdict: "pass", violations: [] };
    const replayReport = { result_status: "pass", events_verified: 3 };

    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-a", events: trace, evaluation, replay_report: replayReport }],
      include_otlp: true,
      org_id: "org-1",
    });

    expect(bundle.manifest.trace_count).toBe(1);
    expect(bundle.manifest.org_id).toBe("org-1");
    expect(bundle.manifest.redaction_notice).toContain("redacted at the source");
    expect(bundle.manifest.integrity_note).toContain("SHA-256");

    // Should have: trace, hash-chain, evaluation, replay, stats, otlp = 6 artifacts
    expect(bundle.artifacts.length).toBe(6);
    expect(bundle.manifest.artifacts.length).toBe(6);

    // Verify artifact types
    const types = bundle.artifacts.map((a) => a.type);
    expect(types).toContain("trace");
    expect(types).toContain("hash_chain_verification");
    expect(types).toContain("evaluation");
    expect(types).toContain("replay_report");
    expect(types).toContain("stats");
    expect(types).toContain("otlp");
  });

  test("manifest digests match artifact content", () => {
    const trace = makeHashedTrace("sess-b");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-b", events: trace }],
    });

    for (const artifact of bundle.artifacts) {
      const expectedDigest = sha256(artifact.content);
      const manifestEntry = bundle.manifest.artifacts.find((a) => a.path === artifact.path);
      expect(manifestEntry).toBeDefined();
      expect(manifestEntry?.digest).toBe(`sha256:${expectedDigest}`);
    }
  });

  test("omits evaluation and replay when not provided", () => {
    const trace = makeHashedTrace("sess-c");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-c", events: trace }],
    });

    // trace + hash-chain + stats = 3 artifacts (no eval, no replay, no otlp)
    expect(bundle.artifacts.length).toBe(3);
    const types = bundle.artifacts.map((a) => a.type);
    expect(types).not.toContain("evaluation");
    expect(types).not.toContain("replay_report");
    expect(types).not.toContain("otlp");
  });

  test("omits OTLP when include_otlp is false (default)", () => {
    const trace = makeHashedTrace("sess-d");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-d", events: trace }],
      include_otlp: false,
    });

    const types = bundle.artifacts.map((a) => a.type);
    expect(types).not.toContain("otlp");
  });

  test("includes OTLP when include_otlp is true", () => {
    const trace = makeHashedTrace("sess-e");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-e", events: trace }],
      include_otlp: true,
    });

    const types = bundle.artifacts.map((a) => a.type);
    expect(types).toContain("otlp");
  });

  test("handles multiple traces", () => {
    const trace1 = makeHashedTrace("sess-1");
    const trace2 = makeHashedTrace("sess-2");

    const bundle = generateComplianceBundle({
      traces: [
        { session_id: "sess-1", events: trace1 },
        { session_id: "sess-2", events: trace2 },
      ],
    });

    expect(bundle.manifest.trace_count).toBe(2);
    // 2 traces × (trace + hash-chain + stats) = 6 artifacts
    expect(bundle.artifacts.length).toBe(6);

    const tracePaths = bundle.artifacts.filter((a) => a.type === "trace").map((a) => a.path);
    expect(tracePaths).toContain("traces/sess-1.trace.jsonl");
    expect(tracePaths).toContain("traces/sess-2.trace.jsonl");
  });

  test("produces valid empty bundle for zero traces", () => {
    const bundle = generateComplianceBundle({ traces: [] });

    expect(bundle.manifest.trace_count).toBe(0);
    expect(bundle.artifacts.length).toBe(0);
    expect(bundle.manifest.artifacts.length).toBe(0);
    expect(bundle.manifest.redaction_notice).toBeTruthy();
    expect(bundle.manifest.integrity_note).toBeTruthy();
  });

  test("trace artifact records hash_chain_valid and event_count", () => {
    const trace = makeHashedTrace("sess-f");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-f", events: trace }],
    });

    const traceManifestEntry = bundle.manifest.artifacts.find((a) => a.type === "trace");
    expect(traceManifestEntry?.hash_chain_valid).toBe(true);
    expect(traceManifestEntry?.event_count).toBe(3);
  });

  test("handles zero-event trace without crashing", () => {
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-empty", events: [] }],
    });

    expect(bundle.manifest.trace_count).toBe(1);
    const traceEntry = bundle.manifest.artifacts.find((a) => a.type === "trace");
    expect(traceEntry?.event_count).toBe(0);
    expect(traceEntry?.hash_chain_valid).toBe(true);
  });

  test("stats artifact contains computed trace stats", () => {
    const trace = makeHashedTrace("sess-stats");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-stats", events: trace }],
    });

    const statsArtifact = bundle.artifacts.find((a) => a.type === "stats");
    expect(statsArtifact).toBeDefined();
    const stats = JSON.parse(statsArtifact?.content ?? "{}") as Record<string, unknown>;
    expect(stats["event_count"]).toBe(3);
    expect(stats["duration_ms"]).toBe(5000);
    expect(stats["tool_call_count"]).toBe(1);
  });

  test("uses engine_version override when provided", () => {
    const bundle = generateComplianceBundle({
      traces: [],
      engine_version: "2.0.0-beta",
    });

    expect(bundle.manifest.krynix_engine_version).toBe("2.0.0-beta");
  });

  test("produces deterministic output when export_id and generated_at are supplied", () => {
    const trace = makeHashedTrace("sess-det");
    const opts = {
      traces: [{ session_id: "sess-det", events: trace }],
      export_id: "export-fixed-12345",
      generated_at: "2025-06-01T00:00:00.000Z",
      org_id: "org-det",
    };

    const bundle1 = generateComplianceBundle(opts);
    const bundle2 = generateComplianceBundle(opts);

    // Manifest fields are identical
    expect(bundle1.manifest.export_id).toBe("export-fixed-12345");
    expect(bundle1.manifest.generated_at).toBe("2025-06-01T00:00:00.000Z");
    expect(bundle2.manifest.export_id).toBe("export-fixed-12345");
    expect(bundle2.manifest.generated_at).toBe("2025-06-01T00:00:00.000Z");

    // Full manifests are bit-for-bit identical
    expect(JSON.stringify(bundle1.manifest)).toBe(JSON.stringify(bundle2.manifest));

    // Artifact contents are identical
    for (let i = 0; i < bundle1.artifacts.length; i++) {
      expect(bundle1.artifacts[i]?.content).toBe(bundle2.artifacts[i]?.content);
      expect(bundle1.artifacts[i]?.digest).toBe(bundle2.artifacts[i]?.digest);
    }
  });

  test("uses generated defaults when export_id and generated_at are omitted", () => {
    const bundle = generateComplianceBundle({ traces: [] });
    expect(bundle.manifest.export_id).toMatch(/^export-\d+-/);
    expect(bundle.manifest.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("trace artifact uses canonical JSON with sorted keys and trailing newline", () => {
    const trace = makeHashedTrace("sess-canon");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-canon", events: trace }],
    });

    const traceArtifact = bundle.artifacts.find((a) => a.type === "trace");
    expect(traceArtifact).toBeDefined();
    const content = traceArtifact?.content ?? "";

    // Each line should be canonical JSON (sorted keys, no whitespace)
    const lines = content.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i]).toBe(canonicalize(trace[i]));
    }

    // Trailing newline present
    expect(content.endsWith("\n")).toBe(true);
  });

  test("zero-event trace produces empty content", () => {
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-empty-canon", events: [] }],
    });

    const traceArtifact = bundle.artifacts.find((a) => a.type === "trace");
    expect(traceArtifact).toBeDefined();
    expect(traceArtifact?.content).toBe("");
  });
});

describe("writeComplianceBundleToDir", () => {
  let tmpDir: string;

  test("writes bundle to directory with correct structure", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-bundle-"));
    try {
      const trace = makeHashedTrace("sess-write");
      const evaluation = { verdict: "pass" };
      const bundle = generateComplianceBundle({
        traces: [{ session_id: "sess-write", events: trace, evaluation }],
        include_otlp: true,
      });

      const outputDir = join(tmpDir, "bundle");
      await writeComplianceBundleToDir(bundle, outputDir);

      // Check manifest exists
      const manifestContent = await readFile(join(outputDir, "manifest.json"), "utf-8");
      const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
      expect(manifest["trace_count"]).toBe(1);

      // Check subdirectories created
      const dirs = await readdir(outputDir);
      expect(dirs).toContain("traces");
      expect(dirs).toContain("evaluations");
      expect(dirs).toContain("stats");
      expect(dirs).toContain("otlp");
      expect(dirs).toContain("manifest.json");

      // Check trace file exists and content matches (3 events + trailing newline = 4 parts when split)
      const traceContent = await readFile(
        join(outputDir, "traces", "sess-write.trace.jsonl"),
        "utf-8",
      );
      const nonEmptyLines = traceContent.split("\n").filter((l) => l.length > 0);
      expect(nonEmptyLines.length).toBe(3);

      // Verify artifact digest matches file on disk
      const fileDigest = sha256(traceContent);
      const traceManifest = (manifest["artifacts"] as Array<Record<string, unknown>>).find(
        (a) => a["type"] === "trace",
      );
      expect(traceManifest?.["digest"]).toBe(`sha256:${fileDigest}`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("creates output directory recursively if it does not exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-bundle-"));
    try {
      const bundle = generateComplianceBundle({ traces: [] });
      const deepDir = join(tmpDir, "a", "b", "c", "bundle");
      await writeComplianceBundleToDir(bundle, deepDir);

      const s = await stat(join(deepDir, "manifest.json"));
      expect(s.isFile()).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejects path traversal in session_id at generation time", () => {
    expect(() =>
      generateComplianceBundle({
        traces: [{ session_id: "../../etc/evil", events: [] }],
      }),
    ).toThrow("Invalid session_id");
  });

  test("rejects session_id with forward slash", () => {
    expect(() =>
      generateComplianceBundle({
        traces: [{ session_id: "foo/bar", events: [] }],
      }),
    ).toThrow("Invalid session_id");
  });

  test("rejects session_id with backslash", () => {
    expect(() =>
      generateComplianceBundle({
        traces: [{ session_id: "foo\\bar", events: [] }],
      }),
    ).toThrow("Invalid session_id");
  });

  test("includes environment in manifest when provided", () => {
    const environment = {
      ci_provider: "github-actions" as const,
      ci_run_id: "456",
      ci_run_url: "https://github.com/org/repo/actions/runs/456",
      git_sha: "abc123",
      git_branch: "main",
      git_repository: "org/repo",
      extra: {},
    };

    const trace = makeHashedTrace("sess-env");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-env", events: trace }],
      export_id: "export-env",
      generated_at: "2025-01-01T00:00:00Z",
      environment,
    });

    expect(bundle.manifest.environment).toBeDefined();
    expect(bundle.manifest.environment?.ci_provider).toBe("github-actions");
    expect(bundle.manifest.environment?.git_sha).toBe("abc123");
    expect(bundle.manifest.environment?.ci_run_id).toBe("456");
  });

  test("omits environment from manifest when not provided", () => {
    const trace = makeHashedTrace("sess-noenv");
    const bundle = generateComplianceBundle({
      traces: [{ session_id: "sess-noenv", events: trace }],
      export_id: "export-noenv",
      generated_at: "2025-01-01T00:00:00Z",
    });

    expect(bundle.manifest.environment).toBeUndefined();
  });

  test("rejects symlinked subdirectory escaping output dir (POSIX only)", async () => {
    if (process.platform === "win32") return;

    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-symlink-"));
    try {
      // Create a symlink: outputDir/traces -> /tmp/outside-target
      const outsideDir = join(tmpDir, "outside-target");
      await fsMkdir(outsideDir, { recursive: true });
      const outputDir = join(tmpDir, "bundle");
      await fsMkdir(outputDir, { recursive: true });
      await symlink(outsideDir, join(outputDir, "traces"));

      const trace = makeHashedTrace("sess-sym");
      const bundle = generateComplianceBundle({
        traces: [{ session_id: "sess-sym", events: trace }],
        export_id: "export-sym",
        generated_at: "2025-01-01T00:00:00Z",
      });

      await expect(writeComplianceBundleToDir(bundle, outputDir)).rejects.toThrow(
        "Symbolic link escape detected",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejects symlinked file target in output dir (POSIX only)", async () => {
    if (process.platform === "win32") return;

    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-symfile-"));
    try {
      const outsideFile = join(tmpDir, "outside-evil.txt");
      const { writeFile: wf, symlink: sym } = await import("node:fs/promises");
      await wf(outsideFile, "should not be overwritten\n", "utf-8");

      const outputDir = join(tmpDir, "bundle");
      await fsMkdir(outputDir, { recursive: true });
      await fsMkdir(join(outputDir, "traces"), { recursive: true });

      // Place a symlink FILE at the expected artifact location
      await sym(outsideFile, join(outputDir, "traces", "sess-sym.trace.jsonl"));

      const trace = makeHashedTrace("sess-sym");
      const bundle = generateComplianceBundle({
        traces: [{ session_id: "sess-sym", events: trace }],
        export_id: "export-symfile",
        generated_at: "2025-01-01T00:00:00Z",
      });

      await expect(writeComplianceBundleToDir(bundle, outputDir)).rejects.toThrow(
        "Symbolic link detected at file path",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("rejects degenerate artifact paths in hand-constructed bundle", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-degen-"));
    try {
      const outputDir = join(tmpDir, "bundle");

      const degeneratePaths = ["", ".", "./", "traces/"];
      for (const badPath of degeneratePaths) {
        const bundle = {
          manifest: {
            manifest_version: "1.0.0",
            export_id: "x",
            org_id: "",
            generated_at: "2025-01-01T00:00:00Z",
            generated_by: "test",
            krynix_engine_version: "1.0.0",
            trace_count: 0,
            artifacts: [{ path: badPath, type: "trace", digest: "sha256:abc" }],
            redaction_notice: "",
            integrity_note: "",
          },
          artifacts: [{ path: badPath, type: "trace" as const, digest: "abc", content: "test" }],
        };

        await expect(writeComplianceBundleToDir(bundle, outputDir)).rejects.toThrow(
          "Invalid artifact path",
        );
      }
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
