import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runDiff } from "./diff.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-diff-"));
  return tempDir;
}

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
      payload: { action: "session_start" },
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

async function writeTrace(dir: string, name: string, events?: TraceEvent[]): Promise<string> {
  const path = join(dir, name);
  const chained = computeHashChain(events ?? makeEvents());
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

describe("runDiff", () => {
  test("identical traces → exit 0, status pass", async () => {
    const dir = await createTempDir();
    const baseline = await writeTrace(dir, "baseline.jsonl");
    const candidate = await writeTrace(dir, "candidate.jsonl");

    const result = await runDiff(["--baseline", baseline, "--candidate", candidate]);
    expect(result.exitCode).toBe(0);
    expect(result.output?.status).toBe("pass");
    expect(result.error).toBeNull();
  });

  test("different payload → exit 1, status diverged with field-level diff", async () => {
    const dir = await createTempDir();
    const baseline = await writeTrace(dir, "baseline.jsonl");

    const modified = makeEvents().map((e, i) =>
      i === 1
        ? ({
            ...e,
            payload: { tool_name: "shell_exec", arguments: { cmd: "ls" } },
          } as unknown as TraceEvent)
        : e,
    );
    const candidate = await writeTrace(dir, "candidate.jsonl", modified);

    const result = await runDiff(["--baseline", baseline, "--candidate", candidate]);
    expect(result.exitCode).toBe(1);
    expect(result.output?.status).toBe("diverged");
    expect(result.output?.firstDivergence?.sequenceNum).toBe(1);
    expect(result.output?.firstDivergence?.diffs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "payload.tool_name" })]),
    );
  });

  test("different length → exit 1, status diverged", async () => {
    const dir = await createTempDir();
    const baseline = await writeTrace(dir, "baseline.jsonl");

    const shorter = makeEvents().slice(0, 2);
    const candidate = await writeTrace(dir, "candidate.jsonl", shorter);

    const result = await runDiff(["--baseline", baseline, "--candidate", candidate]);
    expect(result.exitCode).toBe(1);
    expect(result.output?.status).toBe("diverged");
    expect(result.output?.firstDivergence?.diffs).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "length" })]),
    );
  });

  test("missing --baseline → exit 1 + error", async () => {
    const result = await runDiff(["--candidate", "/tmp/any"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--baseline");
  });

  test("missing --candidate → exit 1 + error", async () => {
    const result = await runDiff(["--baseline", "/tmp/any"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--candidate");
  });

  test("nonexistent baseline file → exit 1 + error", async () => {
    const dir = await createTempDir();
    const candidate = await writeTrace(dir, "candidate.jsonl");

    const result = await runDiff([
      "--baseline",
      "/nonexistent/trace.jsonl",
      "--candidate",
      candidate,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read baseline trace");
  });

  test("nonexistent candidate file → exit 1 + error", async () => {
    const dir = await createTempDir();
    const baseline = await writeTrace(dir, "baseline.jsonl");

    const result = await runDiff([
      "--baseline",
      baseline,
      "--candidate",
      "/nonexistent/trace.jsonl",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read candidate trace");
  });
});
