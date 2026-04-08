import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { formatReplayResults } from "./format-replay.js";
import { runReplay } from "./replay.js";
import type { ReplayCommandResult } from "./replay.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";
import type { ReplayResult } from "@krynix/replay";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-format-"));
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

function makeGoldenEvents(): TraceEvent[] {
  return [
    {
      ...BASE,
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

async function writeGoldenTrace(dir: string, filename: string): Promise<string> {
  const chained = computeHashChain(makeGoldenEvents());
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  const filePath = join(dir, filename);
  await writeFile(filePath, lines.join("\n") + "\n");
  return filePath;
}

describe("formatReplayResults", () => {
  test("pass result contains event count and hash chain valid", () => {
    const result: ReplayResult = {
      file: "test.trace.jsonl",
      status: "pass",
      report: { status: "pass", totalEvents: 3, eventsBeforeDivergence: 3 },
    };

    const lines = formatReplayResults([result]);

    expect(lines.some((l) => l.includes("3 events"))).toBe(true);
    expect(lines.some((l) => l.includes("[PASS]"))).toBe(true);
    expect(lines.some((l) => l.includes("hash chain valid"))).toBe(true);
  });

  test("diverged result contains sequence_num and expected/actual", () => {
    const result: ReplayResult = {
      file: "test.trace.jsonl",
      status: "diverged",
      report: {
        status: "diverged",
        firstDivergence: {
          sequenceNum: 5,
          expected: { eventType: "tool_call", payload: { tool_name: "read" } },
          actual: { eventType: "decision", payload: { action: "write" } },
          diffs: [{ field: "event_type", expected: "tool_call", actual: "decision" }],
        },
        totalEvents: 10,
        eventsBeforeDivergence: 5,
      },
    };

    const lines = formatReplayResults([result]);

    expect(lines.some((l) => l.includes("[DIVERGED]"))).toBe(true);
    expect(lines.some((l) => l.includes("event 5"))).toBe(true);
    expect(lines.some((l) => l.includes("tool_call"))).toBe(true);
    expect(lines.some((l) => l.includes("decision"))).toBe(true);
  });

  test("error result contains validation error messages", () => {
    const result: ReplayResult = {
      file: "bad.trace.jsonl",
      status: "error",
      validationErrors: ["Hash chain broken at event 3", "Missing session_end"],
    };

    const lines = formatReplayResults([result]);

    expect(lines.some((l) => l.includes("[ERROR]"))).toBe(true);
    expect(lines.some((l) => l.includes("Hash chain broken"))).toBe(true);
    expect(lines.some((l) => l.includes("Missing session_end"))).toBe(true);
  });

  test("empty results array returns 'No trace files found'", () => {
    const lines = formatReplayResults([]);
    expect(lines).toEqual(["No trace files found."]);
  });
});

describe("runReplay verbose integration", () => {
  test("non-verbose mode produces no verboseLines", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "valid.trace.jsonl");

    const result = await runReplay(["--verify", "--trace", join(dir, "valid.trace.jsonl")]);

    expect("report" in result).toBe(false);
    expect(result.exitCode).toBe(0);
    expect((result as ReplayCommandResult).verboseLines).toBeUndefined();
  });

  test("verbose mode populates verboseLines array", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "valid.trace.jsonl");

    const result = await runReplay([
      "--verbose",
      "--verify",
      "--trace",
      join(dir, "valid.trace.jsonl"),
    ]);

    expect("report" in result).toBe(false);
    expect(result.exitCode).toBe(0);
    const replayResult = result as ReplayCommandResult;
    expect(replayResult.verboseLines).toBeDefined();
    const lines = replayResult.verboseLines ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l: string) => l.includes("[PASS]"))).toBe(true);
  });

  test("verbose mode with golden-dir formats each file", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "a.trace.jsonl");
    await writeGoldenTrace(dir, "b.trace.jsonl");

    const result = await runReplay(["--verbose", "--verify", "--golden-dir", dir]);

    expect("report" in result).toBe(false);
    expect(result.exitCode).toBe(0);
    const replayResult = result as ReplayCommandResult;
    expect(replayResult.verboseLines).toBeDefined();
    const dirLines = replayResult.verboseLines ?? [];
    expect(dirLines.some((l: string) => l.includes("a.trace.jsonl"))).toBe(true);
    expect(dirLines.some((l: string) => l.includes("b.trace.jsonl"))).toBe(true);
  });
});
