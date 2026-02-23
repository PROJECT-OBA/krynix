import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { validateGoldenTraces } from "./golden-validator.js";
import { computeHashChain, canonicalize, type TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-golden-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Helpers to build minimal golden traces
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
): Promise<void> {
  const chained = computeHashChain(events);
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(join(dir, filename), lines.join("\n") + "\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateGoldenTraces", () => {
  test("valid minimal trace passes", async () => {
    const dir = await createTempDir();
    await writeGoldenTrace(dir, "minimal.trace.jsonl", makeGoldenEvents());

    const results = await validateGoldenTraces(dir);
    expect(results).toHaveLength(1);

    const r = results[0];
    if (r === undefined) throw new Error("expected result");
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  test("corrupted hash in middle → fail with correct info", async () => {
    const dir = await createTempDir();
    const events = makeGoldenEvents();
    const chained = computeHashChain(events);

    // Tamper with event 1's event_hash
    const tampered = [...chained];
    const e1 = tampered[1];
    if (e1 === undefined) throw new Error("expected event");
    tampered[1] = { ...e1, event_hash: "deadbeef".repeat(8) } as unknown as TraceEvent;

    const lines = tampered.map((e) => canonicalize(e));
    await writeFile(join(dir, "tampered.trace.jsonl"), lines.join("\n") + "\n");

    const results = await validateGoldenTraces(dir);
    expect(results).toHaveLength(1);

    const r = results[0];
    if (r === undefined) throw new Error("expected result");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("Hash chain broken"))).toBe(true);
  });

  test("missing session_start → fail with descriptive error", async () => {
    const dir = await createTempDir();
    const events: TraceEvent[] = [
      {
        ...BASE,
        event_id: "evt-000",
        sequence_num: 0,
        event_type: "tool_call",
        payload: { tool_name: "test", arguments: {} },
      } as unknown as TraceEvent,
    ];
    const chained = computeHashChain(events);
    const lines = chained.map((e: TraceEvent) => canonicalize(e));
    await writeFile(join(dir, "no-start.trace.jsonl"), lines.join("\n") + "\n");

    const results = await validateGoldenTraces(dir);
    expect(results).toHaveLength(1);

    const r = results[0];
    if (r === undefined) throw new Error("expected result");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("session_start"))).toBe(true);
  });

  test("missing session_end → fail with descriptive error", async () => {
    const dir = await createTempDir();
    const events: TraceEvent[] = [
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
        payload: { tool_name: "test", arguments: {} },
      } as unknown as TraceEvent,
    ];
    const chained = computeHashChain(events);
    const lines = chained.map((e: TraceEvent) => canonicalize(e));
    await writeFile(join(dir, "no-end.trace.jsonl"), lines.join("\n") + "\n");

    const results = await validateGoldenTraces(dir);
    expect(results).toHaveLength(1);

    const r = results[0];
    if (r === undefined) throw new Error("expected result");
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("session_end"))).toBe(true);
  });

  test("empty directory → empty results", async () => {
    const dir = await createTempDir();

    const results = await validateGoldenTraces(dir);
    expect(results).toHaveLength(0);
  });
});
