/**
 * Golden trace verification integration tests.
 *
 * Ensures the checked-in golden traces under `test/golden/` remain valid.
 * Equivalent to running `krynix replay --verify --golden-dir test/golden/`.
 */

import { describe, test, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyTrace, verifyGoldenDir } from "../../packages/replay/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, "../golden");

describe("golden trace verification", () => {
  test("all golden traces pass verifyGoldenDir", async () => {
    const results = await verifyGoldenDir(GOLDEN_DIR);

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.status, `${result.file} failed: ${JSON.stringify(result.validationErrors)}`).toBe("pass");
    }
  });

  test("minimal.trace.jsonl passes verifyTrace with 3 events", async () => {
    const result = await verifyTrace(resolve(GOLDEN_DIR, "minimal.trace.jsonl"));

    expect(result.status).toBe("pass");
    expect(result.report?.totalEvents).toBe(3);
  });

  test("openclaw-minimal.trace.jsonl passes verifyTrace", async () => {
    const result = await verifyTrace(resolve(GOLDEN_DIR, "openclaw-minimal.trace.jsonl"));

    expect(result.status).toBe("pass");
    expect(result.report?.totalEvents).toBe(10);
  });
});
