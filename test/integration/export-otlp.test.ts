/**
 * Sprint 5 integration tests: OTLP export pipeline.
 *
 * Exercises: session → record events → export to OTLP-JSON → verify structure.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  convertToOtlp,
} from "../../packages/core/src/index.js";
import type {
  PartialTraceEvent,
  OtlpExportData,
} from "../../packages/core/src/index.js";
import { runExport } from "../../packages/cli/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, "../golden");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-otlp-"));
  return async () => {
    await rm(tempDir, { recursive: true, force: true });
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePartial(
  eventType: string,
  payload: unknown,
  timestamp = "2025-01-15T14:00:01.000Z",
): PartialTraceEvent {
  return {
    event_type: eventType as PartialTraceEvent["event_type"],
    timestamp,
    parent_id: null,
    agent_id: "test-agent",
    payload,
    metadata: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OTLP export pipeline", () => {
  test("full pipeline: startSession → record events → export → verify spans", async () => {
    const outputPath = join(tempDir, "trace.jsonl");

    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(
      session,
      makePartial("tool_call", {
        tool_name: "file_read",
        arguments: { path: "/tmp/test.txt" },
      }),
    );

    await recordEvent(
      session,
      makePartial("tool_result", {
        tool_name: "file_read",
        result: "file contents",
        success: true,
        duration_ms: 150,
      }),
    );

    await recordEvent(
      session,
      makePartial("llm_response", {
        model: "gpt-4",
        content: "The file contains test data.",
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        finish_reason: "stop",
      }),
    );

    await endSession(session);

    // Export the trace
    const events = await readTrace(outputPath);
    const otlp = convertToOtlp(events);

    // Verify structure
    expect(otlp.resourceSpans).toHaveLength(1);

    const resource = otlp.resourceSpans[0]!;
    expect(resource.resource.attributes.length).toBeGreaterThan(0);

    const serviceAttr = resource.resource.attributes.find((a) => a.key === "service.name");
    expect(serviceAttr?.value.stringValue).toBe("krynix");

    const scopeSpans = resource.scopeSpans[0]!;
    expect(scopeSpans.scope.name).toBe("krynix");

    // At least session_start, tool_call, tool_result, llm_response, session_end
    expect(scopeSpans.spans.length).toBeGreaterThanOrEqual(5);

    // Check traceId consistency
    const traceIds = new Set(scopeSpans.spans.map((s) => s.traceId));
    expect(traceIds.size).toBe(1);
    expect([...traceIds][0]).toHaveLength(32);
  });

  test("OTLP export: token counts preserved in span attributes", async () => {
    const outputPath = join(tempDir, "trace.jsonl");

    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(
      session,
      makePartial("llm_response", {
        model: "gpt-4",
        content: "Hello",
        usage: { prompt_tokens: 200, completion_tokens: 75 },
        finish_reason: "stop",
      }),
    );

    await endSession(session);

    const events = await readTrace(outputPath);
    const otlp = convertToOtlp(events);

    const llmSpan = otlp.resourceSpans[0]!.scopeSpans[0]!.spans.find(
      (s) => s.name === "llm_response",
    );
    expect(llmSpan).toBeDefined();

    // Check nested objects are preserved as JSON string attributes
    const usageAttr = llmSpan!.attributes.find((a) => a.key === "krynix.usage");
    expect(usageAttr).toBeDefined();
    expect(usageAttr!.value.stringValue).toBeDefined();

    const usage = JSON.parse(usageAttr!.value.stringValue!) as {
      prompt_tokens: number;
      completion_tokens: number;
    };
    expect(usage.prompt_tokens).toBe(200);
    expect(usage.completion_tokens).toBe(75);
  });

  test("CLI export on golden minimal trace succeeds", async () => {
    const result = await runExport([
      "--format",
      "otlp-json",
      "--trace",
      join(GOLDEN_DIR, "minimal.trace.jsonl"),
    ]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output!) as OtlpExportData;
    expect(parsed.resourceSpans[0]!.scopeSpans[0]!.spans.length).toBeGreaterThan(0);
  });

  test("CLI export on golden openclaw trace succeeds", async () => {
    const result = await runExport([
      "--format",
      "otlp-json",
      "--trace",
      join(GOLDEN_DIR, "openclaw-minimal.trace.jsonl"),
    ]);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.output!) as OtlpExportData;
    const spans = parsed.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(spans.length).toBeGreaterThan(0);
  });
});
