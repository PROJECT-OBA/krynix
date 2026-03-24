/**
 * Full end-to-end pipeline integration test with realistic data.
 *
 * Exercises: adapter → session → trace →
 *            schema validate → policy evaluate → replay verify.
 *
 * Phase D1 of the implementation reality audit plan.
 */

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  validateHashChain,
  validateTraceEvent,
  TraceWriter,
} from "../../packages/core/src/index.js";
import { evaluate, parsePolicy } from "../../packages/policy/src/index.js";
import { verifyTrace } from "../../packages/replay/src/index.js";
import { OpenClawAdapter } from "../../packages/adapter-openclaw/src/adapter.js";
import type { OpenClawHookEvent } from "../../packages/adapter-openclaw/src/openclaw-types.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-fullpipe-"));
  return tempDir;
}

const SHELL_DENY_POLICY_YAML = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: deny-shell
  version: "1.0.0"
  description: Deny shell commands, allow file reads
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: deny-shell-exec
      description: Block shell execution
      match:
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: error
      message: "Shell execution is not allowed"
    - id: allow-file-ops
      description: Allow file operations
      match:
        payload:
          - field: tool_name
            operator: in
            value: ["file_read", "file_write"]
      action: allow
      severity: info
      message: "File operation allowed"
`;

describe("full pipeline integration with realistic data", () => {
  test("adapter → session → validate → evaluate → replay verify", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "full-pipeline.trace.jsonl");

    // 1. Initialize adapter
    const adapter = new OpenClawAdapter();
    const skippedEvents: Array<{ reason: string }> = [];
    adapter.onSkippedEvent = (reason) => skippedEvents.push({ reason });

    await adapter.initialize({
      agentId: "pipeline-agent",
      sessionId: "pipe-session-001",
      replaySeed: 12345,
    });

    // 2. Start session
    const session = await startSession({
      agentId: "pipeline-agent",
      replaySeed: 12345,
      outputPath: tracePath,
    });

    // 3. Feed realistic OpenClaw events through adapter → session
    const hookEvents: OpenClawHookEvent[] = [
      {
        _hook: "before_tool_call",
        event: {
          toolName: "file_read",
          params: { path: "src/routes/auth.ts" },
        },
        context: { toolName: "file_read", agentId: "pipeline-agent" },
      },
      {
        _hook: "after_tool_call",
        event: {
          toolName: "file_read",
          params: { path: "src/routes/auth.ts" },
          result: "import express from 'express';\nconst router = express.Router();\n// ...",
          durationMs: 12,
        },
        context: { toolName: "file_read", agentId: "pipeline-agent" },
      },
      {
        _hook: "llm_input",
        event: {
          runId: "run-001",
          sessionId: "pipe-session-001",
          provider: "anthropic",
          model: "claude-sonnet-4-6-20260315",
          prompt: "Add input validation to this route handler",
          systemPrompt: "You are a coding assistant.",
          historyMessages: [
            { role: "user", content: "Add validation to auth.ts" },
          ],
          imagesCount: 0,
        },
        context: { agentId: "pipeline-agent" },
      },
      {
        _hook: "llm_output",
        event: {
          runId: "run-001",
          sessionId: "pipe-session-001",
          provider: "anthropic",
          model: "claude-sonnet-4-6-20260315",
          assistantTexts: [
            "I'll add email and password validation.",
            "Here's the updated code with Zod schema validation.",
          ],
          usage: { input: 450, output: 200 },
        },
        context: { agentId: "pipeline-agent" },
      },
      {
        _hook: "before_tool_call",
        event: {
          toolName: "file_write",
          params: {
            path: "src/routes/auth.ts",
            content: "// updated file content with validation",
          },
        },
        context: { toolName: "file_write", agentId: "pipeline-agent" },
      },
      {
        _hook: "after_tool_call",
        event: {
          toolName: "file_write",
          params: { path: "src/routes/auth.ts" },
          result: "File written: 1.2KB",
          durationMs: 8,
        },
        context: { toolName: "file_write", agentId: "pipeline-agent" },
      },
    ];

    // Also send an unknown event to test skip reporting
    adapter.onEvent({ _hook: "custom_framework_event", data: {} });

    for (const hook of hookEvents) {
      const traceEvent = adapter.onEvent(hook);
      expect(traceEvent).not.toBeNull();
      if (traceEvent === null) continue;

      await recordEvent(session, {
        event_type: traceEvent.event_type,
        timestamp: traceEvent.timestamp,
        parent_id: traceEvent.parent_id,
        agent_id: traceEvent.agent_id,
        payload: traceEvent.payload,
        metadata: traceEvent.metadata,
      });
    }

    // 4. End session
    await endSession(session, { totalToolCalls: 4, totalLlmRequests: 1 });

    // 5. Verify skip reporting worked
    expect(skippedEvents).toHaveLength(1);
    expect(skippedEvents[0]?.reason).toContain("unknown hook type");

    // 6. Read trace and validate schema per-event
    const events = await readTrace(tracePath);
    expect(events.length).toBe(8); // 1 session_start + 6 recorded + 1 session_end

    for (const event of events) {
      const result = validateTraceEvent(event);
      expect(result.valid, `Event seq=${event.sequence_num} type=${event.event_type}: ${result.error}`).toBe(true);
    }

    // 7. Validate hash chain
    const hashResult = validateHashChain(events);
    expect(hashResult.valid).toBe(true);

    // 8. Policy evaluation
    const policy = parsePolicy(SHELL_DENY_POLICY_YAML);
    const evalResult = evaluate(events, policy);
    // No shell_exec in this session, so all events should pass
    expect(evalResult.exitCode).toBe(0);
    expect(evalResult.violations).toHaveLength(0);

    // 9. Replay verify
    const replayResult = await verifyTrace(tracePath);
    expect(replayResult.status).toBe("pass");
    expect(replayResult.report?.totalEvents).toBe(8);
  });

  test("policy catches shell_exec violations in adapter-ingested trace", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "policy-violation.trace.jsonl");

    const adapter = new OpenClawAdapter();
    await adapter.initialize({
      agentId: "violation-agent",
      sessionId: "violation-session",
      replaySeed: 99999,
    });

    const session = await startSession({
      agentId: "violation-agent",
      replaySeed: 99999,
      outputPath: tracePath,
    });

    // Record a shell_exec via adapter (should be denied by policy)
    const shellCallHook: OpenClawHookEvent = {
      _hook: "before_tool_call",
      event: {
        toolName: "shell_exec",
        params: { command: "rm -rf /tmp/data" },
      },
      context: { toolName: "shell_exec", agentId: "violation-agent" },
    };

    const shellEvent = adapter.onEvent(shellCallHook);
    expect(shellEvent).not.toBeNull();
    if (shellEvent === null) throw new Error("expected event");

    await recordEvent(session, {
      event_type: shellEvent.event_type,
      timestamp: shellEvent.timestamp,
      parent_id: shellEvent.parent_id,
      agent_id: shellEvent.agent_id,
      payload: shellEvent.payload,
      metadata: shellEvent.metadata,
    });

    await endSession(session);

    // Evaluate against shell deny policy
    const events = await readTrace(tracePath);
    const policy = parsePolicy(SHELL_DENY_POLICY_YAML);
    const evalResult = evaluate(events, policy);

    expect(evalResult.exitCode).toBeGreaterThan(0);
    expect(evalResult.violations.length).toBeGreaterThan(0);
    expect(evalResult.violations[0]?.ruleId).toBe("deny-shell-exec");

    // Replay still passes (hash chain is valid regardless of policy violations)
    const replayResult = await verifyTrace(tracePath);
    expect(replayResult.status).toBe("pass");
  });

  test("validateOnWrite catches malformed events before they reach the trace file", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "validate-on-write.trace.jsonl");

    const writer = new TraceWriter({ validateOnWrite: true });
    await writer.open(tracePath);

    // Good event — should succeed
    const goodEvent = {
      event_id: "evt-001",
      session_id: "sess-001",
      sequence_num: 0,
      timestamp: new Date().toISOString(),
      event_type: "lifecycle" as const,
      parent_id: null,
      agent_id: "test-agent",
      payload: { action: "session_start" as const, context: { replay_seed: 1 } },
      redacted: false,
      prev_hash: "",
      event_hash: "",
      metadata: null,
      schema_version: "1.0.0",
    };

    await writer.write(goodEvent);

    // Bad event — should be rejected
    const badEvent = {
      ...goodEvent,
      sequence_num: 1,
      event_type: "tool_call" as const,
      payload: { missing_required_fields: true },
    };

    await expect(writer.write(badEvent as any)).rejects.toThrow("Schema validation failed");
    await writer.close();

    // Only the good event should be in the file
    const events = await readTrace(tracePath);
    expect(events).toHaveLength(1);
    expect(events[0]?.event_type).toBe("lifecycle");
  });
});
