import { describe, test, expect, afterEach } from "vitest";
import { join, dirname, resolve } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { runStats } from "./stats.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, "../../../test/golden");

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-stats-"));
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

describe("runStats", () => {
  test("valid trace → exit 0 with stats", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    const result = await runStats(["--trace", tracePath]);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    expect(result.stats).not.toBeNull();
    expect(result.stats?.event_count).toBe(3);
    expect(result.stats?.tool_call_count).toBe(1);
    expect(result.stats?.duration_ms).toBe(5000);
  });

  test("missing --trace → exit 1 with error", async () => {
    const result = await runStats([]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
    expect(result.stats).toBeNull();
  });

  test("nonexistent trace file → exit 1 with error", async () => {
    const result = await runStats(["--trace", "/nonexistent/trace.jsonl"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read trace");
    expect(result.stats).toBeNull();
  });

  test("minimal golden trace returns expected counts", async () => {
    const result = await runStats(["--trace", join(GOLDEN_DIR, "minimal.trace.jsonl")]);
    expect(result.exitCode).toBe(0);
    expect(result.stats).not.toBeNull();
    expect(result.stats?.event_count).toBeGreaterThanOrEqual(2); // at least start + end
    expect(result.stats?.event_type_counts["lifecycle"]).toBeGreaterThanOrEqual(2);
  });

  test("stats output is valid JSON-serializable", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    const result = await runStats(["--trace", tracePath]);
    expect(result.exitCode).toBe(0);

    // Verify JSON round-trip
    const json = JSON.stringify(result.stats, null, 2);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed["event_count"]).toBe(3);
  });

  test("--help flag returns help text (via router)", async () => {
    // The --help flag detection happens in the router, not runStats.
    // runStats will treat --help as missing --trace, which is the correct behavior
    // when invoked directly. Help is intercepted by the router.
    const result = await runStats(["--help"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
  });
});
