/**
 * Full cross-package pipeline integration tests.
 *
 * Exercises: session → trace → policy evaluate → replay verify.
 */

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  validateHashChain,
} from "../../packages/core/src/index.js";
import { evaluate, parsePolicy } from "../../packages/policy/src/index.js";
import { verifyTrace, regenerateTrace } from "../../packages/replay/src/index.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-pipeline-"));
  return tempDir;
}

const ALLOW_POLICY_YAML = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: allow-all
  version: "1.0.0"
  description: Allow everything
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: allow-all
      description: Allow all events
      match:
        payload: []
      action: allow
      severity: info
      message: Allowed
`;

const DENY_POLICY_YAML = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: deny-all
  version: "1.0.0"
  description: Deny everything
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: deny-all
      description: Deny all events
      match:
        payload: []
      action: deny
      severity: error
      message: Denied
`;

describe("full pipeline", () => {
  test("session → trace → policy evaluate (allow) → replay verify passes", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "pipeline.trace.jsonl");

    // 1. Start session
    const session = await startSession({
      agentId: "integration-test",
      replaySeed: 42,
      outputPath: tracePath,
    });

    // 2. Record events
    await recordEvent(session, {
      event_type: "tool_call",
      timestamp: new Date().toISOString(),
      parent_id: null,
      agent_id: "integration-test",
      payload: { tool_name: "file_read", arguments: { path: "/tmp/test.txt" } },
      metadata: null,
    });

    // 3. End session
    await endSession(session);

    // 4. Evaluate against allow policy
    const events = await readTrace(tracePath);
    const policy = parsePolicy(ALLOW_POLICY_YAML);
    const evalResult = evaluate(events, policy);
    expect(evalResult.exitCode).toBe(0);

    // 5. Verify trace integrity
    const replayResult = await verifyTrace(tracePath);
    expect(replayResult.status).toBe("pass");
    expect(replayResult.report?.totalEvents).toBe(3);
  });

  test("deny policy produces non-zero exit code", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "denied.trace.jsonl");

    const session = await startSession({
      agentId: "integration-test",
      replaySeed: 100,
      outputPath: tracePath,
    });

    await recordEvent(session, {
      event_type: "tool_call",
      timestamp: new Date().toISOString(),
      parent_id: null,
      agent_id: "integration-test",
      payload: { tool_name: "shell_exec", arguments: { command: "ls" } },
      metadata: null,
    });

    await endSession(session);

    const events = await readTrace(tracePath);
    const policy = parsePolicy(DENY_POLICY_YAML);
    const evalResult = evaluate(events, policy);

    expect(evalResult.exitCode).toBeGreaterThan(0);
  });

  test("session trace hash chain valid after file round trip", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "hashchain.trace.jsonl");

    const session = await startSession({
      agentId: "chain-test",
      replaySeed: 77,
      outputPath: tracePath,
    });

    await recordEvent(session, {
      event_type: "tool_call",
      timestamp: "2025-01-15T14:00:01.000Z",
      parent_id: null,
      agent_id: "chain-test",
      payload: { tool_name: "read", arguments: {} },
      metadata: null,
    });

    await endSession(session);

    // Read back and validate hash chain
    const events = await readTrace(tracePath);
    const { valid } = validateHashChain(events);
    expect(valid).toBe(true);
  });

  test("regenerate + verify round trip is stable", async () => {
    const dir = await createTempDir();
    const tracePath = join(dir, "roundtrip.trace.jsonl");

    const session = await startSession({
      agentId: "roundtrip-test",
      replaySeed: 55,
      outputPath: tracePath,
    });

    await recordEvent(session, {
      event_type: "tool_call",
      timestamp: "2025-01-15T14:00:01.000Z",
      parent_id: null,
      agent_id: "roundtrip-test",
      payload: { tool_name: "read", arguments: {} },
      metadata: null,
    });

    await endSession(session);

    const originalContent = await readFile(tracePath, "utf-8");

    // Regenerate
    await regenerateTrace(tracePath);

    const regeneratedContent = await readFile(tracePath, "utf-8");
    expect(regeneratedContent).toBe(originalContent);

    // Verify still passes
    const result = await verifyTrace(tracePath);
    expect(result.status).toBe("pass");
  });
});
