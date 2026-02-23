import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTrace } from "./trace-reader.js";
import { makeSessionStart, makeToolCall, makeSessionEnd } from "./test-helpers.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function tracePath(name: string): string {
  return join(tempDir, name);
}

describe("readTrace", () => {
  test("parses a valid 3-event JSONL file", async () => {
    const events = [makeSessionStart(), makeToolCall(1), makeSessionEnd(2)];
    const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const path = tracePath("valid.trace.jsonl");
    await writeFile(path, content, "utf-8");

    const result = await readTrace(path);

    expect(result).toHaveLength(3);
    expect(result[0]?.event_type).toBe("lifecycle");
    expect(result[1]?.event_type).toBe("tool_call");
    expect(result[2]?.event_type).toBe("lifecycle");
  });

  test("reports invalid JSON on line 2 with line number", async () => {
    const events = [makeSessionStart()];
    const content = JSON.stringify(events[0]) + "\n" + "{invalid json}\n";
    const path = tracePath("bad-json.trace.jsonl");
    await writeFile(path, content, "utf-8");

    await expect(readTrace(path)).rejects.toThrow("line 2");
  });

  test("reports missing required field with field name and line number", async () => {
    const event = makeSessionStart();
    // Remove event_type from the serialized JSON
    const { event_type: _, ...incomplete } = event;
    const content = JSON.stringify(incomplete) + "\n";
    const path = tracePath("missing-field.trace.jsonl");
    await writeFile(path, content, "utf-8");

    await expect(readTrace(path)).rejects.toThrow("event_type");
    await expect(readTrace(path)).rejects.toThrow("line 1");
  });

  test("returns empty array for empty file", async () => {
    const path = tracePath("empty.trace.jsonl");
    await writeFile(path, "", "utf-8");

    const result = await readTrace(path);
    expect(result).toEqual([]);
  });

  test("handles trailing newline correctly (no phantom empty event)", async () => {
    const event = makeSessionStart();
    const withNewline = JSON.stringify(event) + "\n";
    const withoutNewline = JSON.stringify(event);
    const pathWith = tracePath("with-newline.trace.jsonl");
    const pathWithout = tracePath("without-newline.trace.jsonl");
    await writeFile(pathWith, withNewline, "utf-8");
    await writeFile(pathWithout, withoutNewline, "utf-8");

    const resultWith = await readTrace(pathWith);
    const resultWithout = await readTrace(pathWithout);
    expect(resultWith).toHaveLength(1);
    expect(resultWithout).toHaveLength(1);
    expect(resultWith[0]?.event_id).toBe(resultWithout[0]?.event_id);
  });
});
