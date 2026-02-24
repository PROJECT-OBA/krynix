import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  verifyTrace,
  verifyGoldenDir,
  regenerateTrace,
  regenerateGoldenDir,
} from "./replay-runner.js";
import { computeHashChain, canonicalize, type TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-replay-runner-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = {
  event_id: "evt-000",
  session_id: "golden-session",
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

async function writeGoldenTrace(
  dir: string,
  filename: string,
  events: TraceEvent[],
): Promise<string> {
  const chained = computeHashChain(events);
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  const filePath = join(dir, filename);
  await writeFile(filePath, lines.join("\n") + "\n");
  return filePath;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyTrace", () => {
  test("valid golden trace returns pass", async () => {
    const dir = await createTempDir();
    const filePath = await writeGoldenTrace(dir, "valid.trace.jsonl", makeGoldenEvents());

    const result = await verifyTrace(filePath);

    expect(result.status).toBe("pass");
    expect(result.report?.status).toBe("pass");
    expect(result.report?.totalEvents).toBe(3);
  });

  test("broken hash chain returns error", async () => {
    const dir = await createTempDir();
    const events = makeGoldenEvents();
    const chained = computeHashChain(events);

    // Tamper with event 1's event_hash
    const tampered = [...chained];
    const e1 = tampered[1];
    if (e1 === undefined) throw new Error("expected event");
    tampered[1] = { ...e1, event_hash: "deadbeef".repeat(8) } as unknown as TraceEvent;

    const filePath = join(dir, "tampered.trace.jsonl");
    const lines = tampered.map((e) => canonicalize(e));
    await writeFile(filePath, lines.join("\n") + "\n");

    const result = await verifyTrace(filePath);

    expect(result.status).toBe("error");
    expect(result.validationErrors?.some((e) => e.includes("Hash chain broken"))).toBe(true);
  });

  test("missing session_start returns error", async () => {
    const dir = await createTempDir();
    const events: TraceEvent[] = [
      {
        ...BASE,
        sequence_num: 0,
        event_type: "tool_call",
        payload: { tool_name: "test", arguments: {} },
      } as unknown as TraceEvent,
    ];
    const filePath = await writeGoldenTrace(dir, "no-start.trace.jsonl", events);

    const result = await verifyTrace(filePath);

    expect(result.status).toBe("error");
    expect(result.validationErrors?.some((e) => e.includes("session_start"))).toBe(true);
  });

  test("missing session_end returns error", async () => {
    const dir = await createTempDir();
    const events: TraceEvent[] = [
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
        payload: { tool_name: "test", arguments: {} },
      } as unknown as TraceEvent,
    ];
    const filePath = await writeGoldenTrace(dir, "no-end.trace.jsonl", events);

    const result = await verifyTrace(filePath);

    expect(result.status).toBe("error");
    expect(result.validationErrors?.some((e) => e.includes("session_end"))).toBe(true);
  });

  test("empty trace file returns error", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "empty.trace.jsonl");
    await writeFile(filePath, "");

    const result = await verifyTrace(filePath);

    expect(result.status).toBe("error");
    expect(result.validationErrors?.some((e) => e.includes("empty"))).toBe(true);
  });

  test("nonexistent file returns error (not thrown)", async () => {
    const result = await verifyTrace("/nonexistent/path/trace.jsonl");

    expect(result.status).toBe("error");
    expect(result.validationErrors?.some((e) => e.includes("Failed to read"))).toBe(true);
  });

  test("single-event trace (only session_start, no session_end) returns error", async () => {
    const dir = await createTempDir();
    const events: TraceEvent[] = [
      {
        ...BASE,
        sequence_num: 0,
        event_type: "lifecycle",
        payload: { action: "session_start", context: { replay_seed: 42 } },
      } as unknown as TraceEvent,
    ];
    const filePath = await writeGoldenTrace(dir, "single.trace.jsonl", events);

    const result = await verifyTrace(filePath);

    expect(result.status).toBe("error");
    expect(result.validationErrors?.some((e) => e.includes("at least 2 events"))).toBe(true);
  });
});

describe("verifyGoldenDir", () => {
  test("valid + invalid traces return correct results array", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "good.trace.jsonl", makeGoldenEvents());

    // Write an invalid trace (no session_start)
    const badEvents: TraceEvent[] = [
      {
        ...BASE,
        sequence_num: 0,
        event_type: "tool_call",
        payload: { tool_name: "test", arguments: {} },
      } as unknown as TraceEvent,
    ];
    await writeGoldenTrace(dir, "bad.trace.jsonl", badEvents);

    const results = await verifyGoldenDir(dir);

    expect(results).toHaveLength(2);
    const valid = results.find((r) => r.file.includes("good.trace.jsonl"));
    const invalid = results.find((r) => r.file.includes("bad.trace.jsonl"));
    expect(valid?.status).toBe("pass");
    expect(invalid?.status).toBe("error");
  });

  test("empty directory returns empty array", async () => {
    const dir = await createTempDir();

    const results = await verifyGoldenDir(dir);

    expect(results).toHaveLength(0);
  });

  test("ignores non-.trace.jsonl files", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "valid.trace.jsonl", makeGoldenEvents());
    await writeFile(join(dir, "notes.txt"), "not a trace file");
    await writeFile(join(dir, "data.json"), "{}");

    const results = await verifyGoldenDir(dir);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
  });
});

describe("regenerateTrace + determinism", () => {
  test("hash chain re-computation is deterministic: strip → recompute → compare → identical", async () => {
    const dir = await createTempDir();
    const filePath = await writeGoldenTrace(dir, "regen.trace.jsonl", makeGoldenEvents());

    // Read original content
    const originalContent = await readFile(filePath, "utf-8");

    // Regenerate
    await regenerateTrace(filePath);

    // Read regenerated content
    const regeneratedContent = await readFile(filePath, "utf-8");

    // Should be byte-identical
    expect(regeneratedContent).toBe(originalContent);

    // Should still pass verification
    const result = await verifyTrace(filePath);
    expect(result.status).toBe("pass");
  });
});

describe("regenerateGoldenDir", () => {
  test("regenerates all traces in directory", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "a.trace.jsonl", makeGoldenEvents());
    await writeGoldenTrace(dir, "b.trace.jsonl", makeGoldenEvents());

    const results = await regenerateGoldenDir(dir);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });

  test("regeneration is idempotent — file content byte-identical before/after", async () => {
    const dir = await createTempDir();
    const filePath = await writeGoldenTrace(dir, "regen.trace.jsonl", makeGoldenEvents());

    const originalContent = await readFile(filePath, "utf-8");

    await regenerateGoldenDir(dir);

    const regeneratedContent = await readFile(filePath, "utf-8");
    expect(regeneratedContent).toBe(originalContent);

    // Should still pass verification
    const verifyResults = await verifyGoldenDir(dir);
    expect(verifyResults.every((r) => r.status === "pass")).toBe(true);
  });

  test("skips non-.trace.jsonl files", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "valid.trace.jsonl", makeGoldenEvents());
    await writeFile(join(dir, "notes.txt"), "not a trace file");
    await writeFile(join(dir, "data.json"), "{}");

    const results = await regenerateGoldenDir(dir);

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
  });

  test("empty directory returns empty array", async () => {
    const dir = await createTempDir();

    const results = await regenerateGoldenDir(dir);

    expect(results).toHaveLength(0);
  });

  test("reports error for corrupted file while continuing others", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "a-good.trace.jsonl", makeGoldenEvents());
    await writeFile(join(dir, "b-bad.trace.jsonl"), "not valid json\n");
    await writeGoldenTrace(dir, "c-good.trace.jsonl", makeGoldenEvents());

    const results = await regenerateGoldenDir(dir);

    expect(results).toHaveLength(3);
    const good1 = results.find((r) => r.file.includes("a-good"));
    const bad = results.find((r) => r.file.includes("b-bad"));
    const good2 = results.find((r) => r.file.includes("c-good"));
    expect(good1?.status).toBe("pass");
    expect(bad?.status).toBe("error");
    expect(good2?.status).toBe("pass");
  });
});
