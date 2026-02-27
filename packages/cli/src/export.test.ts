import { describe, test, expect, afterEach } from "vitest";
import { join, dirname, resolve } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runExport } from "./export.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent, OtlpExportData } from "@krynix/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, "../../../test/golden");

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-export-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const BASE = {
  event_id: "evt-000",
  session_id: "test-session",
  sequence_num: 0,
  timestamp: "2025-01-15T14:00:00.000Z",
  parent_id: null,
  agent_id: "test-agent",
  redacted: false,
  prev_hash: "",
  event_hash: "",
  metadata: null,
  schema_version: "1.0.0",
} as const;

function makeEvents(): TraceEvent[] {
  return [
    {
      ...BASE,
      event_id: "evt-000",
      sequence_num: 0,
      event_type: "lifecycle",
      payload: { action: "session_start", context: { replay_seed: 42 } },
    } as unknown as TraceEvent,
    {
      ...BASE,
      event_id: "evt-001",
      sequence_num: 1,
      event_type: "tool_call",
      payload: { tool_name: "file_read", arguments: { path: "/tmp/test.txt" } },
    } as unknown as TraceEvent,
    {
      ...BASE,
      event_id: "evt-002",
      sequence_num: 2,
      timestamp: "2025-01-15T14:00:05.000Z",
      event_type: "lifecycle",
      payload: { action: "session_end" },
    } as unknown as TraceEvent,
  ];
}

async function writeTrace(dir: string): Promise<string> {
  const path = join(dir, "trace.jsonl");
  const chained = computeHashChain(makeEvents());
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runExport", () => {
  test("valid trace + --format otlp-json → exit 0, valid JSON output", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    const result = await runExport(["--format", "otlp-json", "--trace", tracePath]);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    expect(result.output).not.toBeNull();

    const parsed = JSON.parse(result.output as string) as OtlpExportData;
    expect(parsed.resourceSpans).toHaveLength(1);
  });

  test("output parses to valid OtlpExportData structure", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    const result = await runExport(["--format", "otlp-json", "--trace", tracePath]);
    const parsed = JSON.parse(result.output as string) as OtlpExportData;

    expect(parsed.resourceSpans[0]?.scopeSpans[0]?.spans).toHaveLength(3);
    expect(parsed.resourceSpans[0]?.resource.attributes.length).toBeGreaterThan(0);
  });

  test("missing --trace → exit 1, error message", async () => {
    const result = await runExport(["--format", "otlp-json"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
    expect(result.output).toBeNull();
  });

  test("missing --format → exit 1, error message", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    const result = await runExport(["--trace", tracePath]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--format");
    expect(result.output).toBeNull();
  });

  test("unknown format → exit 1, error mentioning supported formats", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    const result = await runExport(["--format", "csv", "--trace", tracePath]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Unknown format");
    expect(result.error).toContain("otlp-json");
  });

  test("nonexistent trace file → exit 1, error message", async () => {
    const result = await runExport([
      "--format",
      "otlp-json",
      "--trace",
      "/nonexistent/trace.jsonl",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read trace");
  });

  test("empty trace → exit 0, valid structure with empty spans", async () => {
    const dir = await createTempDir();
    const emptyPath = join(dir, "empty.trace.jsonl");
    await writeFile(emptyPath, "");

    const result = await runExport(["--format", "otlp-json", "--trace", emptyPath]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output as string) as OtlpExportData;
    expect(parsed.resourceSpans[0]?.scopeSpans[0]?.spans).toHaveLength(0);
  });

  test("golden trace exports successfully", async () => {
    const result = await runExport([
      "--format",
      "otlp-json",
      "--trace",
      join(GOLDEN_DIR, "minimal.trace.jsonl"),
    ]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output as string) as OtlpExportData;
    expect(parsed.resourceSpans[0]?.scopeSpans[0]?.spans.length).toBeGreaterThan(0);
  });

  test("--filter-type reduces exported events", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    // Filter to only tool_call events
    const result = await runExport([
      "--format",
      "otlp-json",
      "--trace",
      tracePath,
      "--filter-type",
      "tool_call",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.output).not.toBeNull();

    const parsed = JSON.parse(result.output as string) as OtlpExportData;
    // Should have only 1 span (the tool_call)
    expect(parsed.resourceSpans[0]?.scopeSpans[0]?.spans).toHaveLength(1);
  });
});
