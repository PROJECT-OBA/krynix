import { describe, test, expect } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runComplianceExport } from "./compliance.js";
import type { TraceEvent } from "@krynix/core";
import { computeHashChain } from "@krynix/core";

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

/** Create a minimal valid hash-chained trace and write to a file. */
async function writeTrace(dir: string, sessionId: string): Promise<string> {
  const raw = [
    makeEvent({
      event_id: "evt-0",
      session_id: sessionId,
      sequence_num: 0,
      event_type: "lifecycle",
      payload: { action: "session_start", context: {} },
    }),
    makeEvent({
      event_id: "evt-1",
      session_id: sessionId,
      sequence_num: 1,
      event_type: "lifecycle",
      timestamp: "2025-01-15T14:00:05.000Z",
      payload: { action: "session_end", context: {} },
    }),
  ];
  const hashed = computeHashChain(raw);
  const content = hashed.map((e: TraceEvent) => JSON.stringify(e)).join("\n");
  const filePath = join(dir, `${sessionId}.trace.jsonl`);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runComplianceExport", () => {
  let tmpDir: string;

  test("generates bundle for a single trace", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-compliance-"));
    try {
      const tracePath = await writeTrace(tmpDir, "sess-a");
      const outputDir = join(tmpDir, "bundle");

      const result = await runComplianceExport(["--trace", tracePath, "--output", outputDir]);

      expect(result.exitCode).toBe(0);
      expect(result.error).toBeNull();
      expect(result.output).toContain("trace_count");

      // Check manifest exists
      const manifest = JSON.parse(
        await readFile(join(outputDir, "manifest.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(manifest["trace_count"]).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("generates bundle with multiple traces", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-compliance-"));
    try {
      const trace1 = await writeTrace(tmpDir, "sess-1");
      const trace2 = await writeTrace(tmpDir, "sess-2");
      const outputDir = join(tmpDir, "bundle");

      const result = await runComplianceExport([
        "--trace",
        trace1,
        "--trace",
        trace2,
        "--output",
        outputDir,
      ]);

      expect(result.exitCode).toBe(0);
      const manifest = JSON.parse(
        await readFile(join(outputDir, "manifest.json"), "utf-8"),
      ) as Record<string, unknown>;
      expect(manifest["trace_count"]).toBe(2);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("includes OTLP exports when --include-otlp is set", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-compliance-"));
    try {
      const tracePath = await writeTrace(tmpDir, "sess-otlp");
      const outputDir = join(tmpDir, "bundle");

      const result = await runComplianceExport([
        "--trace",
        tracePath,
        "--output",
        outputDir,
        "--include-otlp",
      ]);

      expect(result.exitCode).toBe(0);
      const dirs = await readdir(outputDir);
      expect(dirs).toContain("otlp");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("errors on missing --trace flag", async () => {
    const result = await runComplianceExport(["--output", "/tmp/bundle"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
  });

  test("errors on missing --output flag", async () => {
    const result = await runComplianceExport(["--trace", "/tmp/trace.jsonl"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--output");
  });

  test("errors on non-existent trace file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-compliance-"));
    try {
      const result = await runComplianceExport([
        "--trace",
        join(tmpDir, "nonexistent.jsonl"),
        "--output",
        join(tmpDir, "bundle"),
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.error).toBeTruthy();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("attaches evaluation when session_id matches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-compliance-"));
    try {
      const tracePath = await writeTrace(tmpDir, "sess-eval");
      const evalPath = join(tmpDir, "eval.json");
      await writeFile(
        evalPath,
        JSON.stringify({ session_id: "sess-eval", verdict: "pass", violations: [] }),
        "utf-8",
      );
      const outputDir = join(tmpDir, "bundle");

      const result = await runComplianceExport([
        "--trace",
        tracePath,
        "--output",
        outputDir,
        "--include-evaluation",
        evalPath,
      ]);

      expect(result.exitCode).toBe(0);
      const dirs = await readdir(outputDir);
      expect(dirs).toContain("evaluations");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
