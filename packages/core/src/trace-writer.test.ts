import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { TraceWriter } from "./trace-writer.js";
import { readTrace } from "./trace-reader.js";
import { validateHashChain } from "./hash-chain.js";
import { makeSessionStart, makeToolCall, makeSessionEnd } from "./test-helpers.js";
import type { TraceEvent } from "./types.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-writer-"));
  return tempDir;
}

describe("TraceWriter", () => {
  test("write 3 events → read back → verify 3 valid events", async () => {
    const dir = await createTempDir();
    const path = join(dir, "trace.jsonl");

    const writer = new TraceWriter();
    await writer.open(path);
    await writer.write(makeSessionStart());
    await writer.write(makeToolCall(1));
    await writer.write(makeSessionEnd(2));
    await writer.close();

    const events = await readTrace(path);
    expect(events).toHaveLength(3);
  });

  test("hash chain valid across written events", async () => {
    const dir = await createTempDir();
    const path = join(dir, "trace.jsonl");

    const writer = new TraceWriter();
    await writer.open(path);
    await writer.write(makeSessionStart());
    await writer.write(makeToolCall(1));
    await writer.write(makeSessionEnd(2));
    await writer.close();

    const events = await readTrace(path);
    const result = validateHashChain(events);
    expect(result.valid).toBe(true);
  });

  test("first event has empty prev_hash", async () => {
    const dir = await createTempDir();
    const path = join(dir, "trace.jsonl");

    const writer = new TraceWriter();
    await writer.open(path);
    await writer.write(makeSessionStart());
    await writer.close();

    const events = await readTrace(path);
    expect(events).toHaveLength(1);

    const first = events[0];
    if (first === undefined) throw new Error("expected event");
    expect(first.prev_hash).toBe("");
    expect(first.event_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("throws if write called before open", async () => {
    const writer = new TraceWriter();
    await expect(writer.write(makeSessionStart())).rejects.toThrow("not open");
  });

  // ---------------------------------------------------------------------------
  // validateOnWrite tests
  // ---------------------------------------------------------------------------

  test("validateOnWrite: valid events pass through normally", async () => {
    const dir = await createTempDir();
    const path = join(dir, "trace.jsonl");

    const writer = new TraceWriter({ validateOnWrite: true });
    await writer.open(path);
    await writer.write(makeSessionStart());
    await writer.write(makeToolCall(1));
    await writer.write(makeSessionEnd(2));
    await writer.close();

    const events = await readTrace(path);
    expect(events).toHaveLength(3);

    const result = validateHashChain(events);
    expect(result.valid).toBe(true);
  });

  test("validateOnWrite: rejects event with invalid event_type", async () => {
    const dir = await createTempDir();
    const path = join(dir, "trace.jsonl");

    const writer = new TraceWriter({ validateOnWrite: true });
    await writer.open(path);

    const badEvent = {
      ...makeSessionStart(),
      event_type: "not_a_real_type",
    } as unknown as TraceEvent;

    await expect(writer.write(badEvent)).rejects.toThrow("Schema validation failed");
    await writer.close();
  });

  test("validateOnWrite: rejects event with missing payload fields", async () => {
    const dir = await createTempDir();
    const path = join(dir, "trace.jsonl");

    const writer = new TraceWriter({ validateOnWrite: true });
    await writer.open(path);

    // tool_call requires tool_name and arguments — omit arguments
    const badEvent = {
      ...makeToolCall(0),
      payload: { tool_name: "test" },
    } as unknown as TraceEvent;

    await expect(writer.write(badEvent)).rejects.toThrow("Schema validation failed");
    await writer.close();
  });

  test("validateOnWrite disabled by default — invalid events are persisted", async () => {
    const dir = await createTempDir();
    const path = join(dir, "trace.jsonl");

    const writer = new TraceWriter(); // no options = validateOnWrite: false
    await writer.open(path);

    // Missing required payload fields — should NOT throw without validation
    const badEvent = {
      ...makeToolCall(0),
      payload: { tool_name: "test" },
    } as unknown as TraceEvent;

    await writer.write(badEvent);
    await writer.close();

    // Event was written (even though it's invalid)
    const events = await readTrace(path);
    expect(events).toHaveLength(1);
  });
});
