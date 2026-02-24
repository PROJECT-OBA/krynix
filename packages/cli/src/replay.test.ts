import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runReplay } from "./replay.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-cli-replay-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Fixture builders
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

function makeValidEvents(): TraceEvent[] {
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
      event_type: "lifecycle",
      payload: { action: "session_end" },
    } as unknown as TraceEvent,
  ];
}

function makeBrokenEvents(): TraceEvent[] {
  return [
    {
      ...BASE,
      sequence_num: 0,
      event_type: "tool_call",
      payload: { tool_name: "test", arguments: {} },
    } as unknown as TraceEvent,
  ];
}

async function writeTrace(dir: string, filename: string, events: TraceEvent[]): Promise<string> {
  const path = join(dir, filename);
  const chained = computeHashChain(events);
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runReplay", () => {
  test("--verify --trace valid.trace.jsonl → exit 0", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl", makeValidEvents());

    const result = await runReplay(["--verify", "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("pass");
    expect(result.error).toBeNull();
  });

  test("--verify --trace broken.trace.jsonl → exit 1", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "broken.trace.jsonl", makeBrokenEvents());

    const result = await runReplay(["--verify", "--trace", tracePath]);

    expect(result.exitCode).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("error");
  });

  test("--verify --golden-dir with valid traces → exit 0", async () => {
    const dir = await createTempDir();
    await writeTrace(dir, "trace1.trace.jsonl", makeValidEvents());

    const result = await runReplay(["--verify", "--golden-dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.error).toBeNull();
  });

  test("--verify --golden-dir with mix → exit 1", async () => {
    const dir = await createTempDir();
    await writeTrace(dir, "good.trace.jsonl", makeValidEvents());
    await writeTrace(dir, "bad.trace.jsonl", makeBrokenEvents());

    const result = await runReplay(["--verify", "--golden-dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.results).toHaveLength(2);
  });

  test("missing --trace and --golden-dir → exit 1 + error", async () => {
    const result = await runReplay(["--verify"]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace or --golden-dir");
  });

  test("--verify and --regenerate together → exit 1 + error", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl", makeValidEvents());

    const result = await runReplay(["--verify", "--regenerate", "--trace", tracePath]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("mutually exclusive");
  });

  test("nonexistent trace path → exit 1", async () => {
    const result = await runReplay(["--verify", "--trace", "/nonexistent/trace.jsonl"]);

    expect(result.exitCode).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("error");
  });

  test("nonexistent golden-dir → exit 1", async () => {
    const result = await runReplay(["--verify", "--golden-dir", "/nonexistent/dir"]);

    expect(result.exitCode).toBe(1);
  });

  test("--verbose flag parsed correctly (no crash)", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl", makeValidEvents());

    const result = await runReplay(["--verify", "--verbose", "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
  });

  test("--regenerate --trace valid.trace.jsonl → exit 0", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl", makeValidEvents());

    const result = await runReplay(["--regenerate", "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe("pass");
    expect(result.error).toBeNull();
  });
});
