/**
 * Custom redaction integration tests.
 *
 * End-to-end: redactWithPatterns on real trace events from sessions.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  redactWithPatterns,
} from "../../packages/core/src/index.js";
import type { PartialTraceEvent, TraceEvent } from "../../packages/core/src/index.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-redact-int-"));
  return async () => {
    await rm(tempDir, { recursive: true, force: true });
  };
});

function expectedToken(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `[REDACTED:${hash.slice(0, 8)}]`;
}

describe("Custom redaction integration", () => {
  test("session events can be post-processed with custom patterns", async () => {
    const outputPath = join(tempDir, "trace.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    await recordEvent(session, {
      event_type: "tool_call",
      timestamp: "2025-01-15T14:00:01.000Z",
      parent_id: null,
      agent_id: "test-agent",
      payload: {
        tool_name: "api_call",
        arguments: { ssn: "123-45-6789", name: "Alice", api_key: "sk-secret" },
      },
      metadata: null,
    } as PartialTraceEvent);

    await endSession(session);

    // Read and apply custom redaction on top of built-in
    const events = await readTrace(outputPath);
    const toolEvent = events[1]!; // tool_call event

    // Built-in redaction already applied api_key during recordEvent
    const args = (toolEvent.payload as { arguments: Record<string, unknown> }).arguments;
    expect(args["api_key"]).toMatch(/^\[REDACTED:[0-9a-f]{8}\]$/);
    expect(args["ssn"]).toBe("123-45-6789"); // Not redacted by built-in

    // Now apply custom patterns
    const customRedacted = redactWithPatterns(toolEvent, [{ pattern: "^ssn$" }]);
    const customArgs = (customRedacted.payload as { arguments: Record<string, unknown> }).arguments;
    expect(customArgs["ssn"]).toBe(expectedToken("123-45-6789"));
    expect(customArgs["name"]).toBe("Alice");
    expect(customRedacted.redacted).toBe(true);
  });

  test("built-in + custom patterns applied together in a single call", async () => {
    const outputPath = join(tempDir, "trace-both.jsonl");
    const session = await startSession({
      agentId: "test-agent",
      replaySeed: 42,
      outputPath,
    });

    // Record an event WITHOUT the session's automatic redaction path
    // (we'll test redactWithPatterns directly on a fresh event)
    await endSession(session);

    const events = await readTrace(outputPath);
    const startEvent = events[0]!; // lifecycle event

    // Create a synthetic tool_call event for testing
    const syntheticEvent = {
      ...startEvent,
      event_type: "tool_call" as const,
      payload: {
        tool_name: "multi",
        arguments: {
          api_key: "sk-secret",
          ssn: "123-45-6789",
          dob: "1990-01-01",
          name: "Alice",
        },
      },
    };

    const redacted = redactWithPatterns(
      syntheticEvent as unknown as TraceEvent,
      [{ pattern: "^ssn$" }, { pattern: "^dob$" }],
    );

    const args = (redacted.payload as { arguments: Record<string, unknown> }).arguments;
    expect(args["api_key"]).toBe(expectedToken("sk-secret")); // Built-in
    expect(args["ssn"]).toBe(expectedToken("123-45-6789")); // Custom
    expect(args["dob"]).toBe(expectedToken("1990-01-01")); // Custom
    expect(args["name"]).toBe("Alice"); // Untouched
    expect(redacted.redacted).toBe(true);
  });
});
