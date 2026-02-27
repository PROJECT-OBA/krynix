import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runEvaluate } from "./evaluate.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-cli-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

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

function makeEvents(): TraceEvent[] {
  return [
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

async function writeTrace(dir: string): Promise<string> {
  const path = join(dir, "trace.jsonl");
  const chained = computeHashChain(makeEvents());
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

async function writePolicy(dir: string, filename: string, yaml: string): Promise<string> {
  const path = join(dir, filename);
  await writeFile(path, yaml);
  return path;
}

const ALLOW_POLICY = `
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

const DENY_ERROR_POLICY = `
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

const DENY_CRITICAL_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: deny-critical
  version: "1.0.0"
  description: Deny with critical
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: deny-critical
      description: Critical deny
      match:
        payload: []
      action: deny
      severity: critical
      message: Critical violation
`;

const REQUIRE_APPROVAL_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: require-approval
  version: "1.0.0"
  description: Require approval
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: approval-needed
      description: Needs approval
      match:
        payload: []
      action: require-approval
      severity: warning
      message: Approval required
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEvaluate", () => {
  test("pass → exit 0", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "allow.policy.yaml", ALLOW_POLICY);

    const result = await runEvaluate(["--trace", tracePath, "--policy", policyPath]);
    expect(result.exitCode).toBe(0);
    expect(result.output?.verdict).toBe("pass");
    expect(result.error).toBeNull();
  });

  test("fail (error) → exit 1", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "deny.policy.yaml", DENY_ERROR_POLICY);

    const result = await runEvaluate(["--trace", tracePath, "--policy", policyPath]);
    expect(result.exitCode).toBe(1);
    expect(result.output?.verdict).toBe("fail");
  });

  test("fail (critical) → exit 2", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "deny.policy.yaml", DENY_CRITICAL_POLICY);

    const result = await runEvaluate(["--trace", tracePath, "--policy", policyPath]);
    expect(result.exitCode).toBe(2);
    expect(result.output?.verdict).toBe("fail");
  });

  test("require-approval → exit 3", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "approval.policy.yaml", REQUIRE_APPROVAL_POLICY);

    const result = await runEvaluate(["--trace", tracePath, "--policy", policyPath]);
    expect(result.exitCode).toBe(3);
    expect(result.output?.verdict).toBe("require-approval");
  });

  test("missing trace file → exit 1 + error", async () => {
    const dir = await createTempDir();
    const policyPath = await writePolicy(dir, "allow.policy.yaml", ALLOW_POLICY);

    const result = await runEvaluate([
      "--trace",
      "/nonexistent/trace.jsonl",
      "--policy",
      policyPath,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read trace");
  });

  test("missing policy dir → exit 1 + error", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);

    const result = await runEvaluate(["--trace", tracePath, "--policy", "/nonexistent/policies"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to load policies");
  });

  test("missing --trace flag → exit 1 + error", async () => {
    const result = await runEvaluate(["--policy", "something"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
  });

  test("multiple policies: most-restrictive-wins (directory)", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyDir = join(dir, "policies");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(policyDir);
    await writePolicy(policyDir, "allow.policy.yaml", ALLOW_POLICY);
    await writePolicy(policyDir, "deny.policy.yaml", DENY_ERROR_POLICY);

    const result = await runEvaluate(["--trace", tracePath, "--policy", policyDir]);
    // Most restrictive: deny (exit 1) > allow (exit 0)
    expect(result.exitCode).toBe(1);
    expect(result.output?.verdict).toBe("fail");
    expect(result.output?.policyResults).toHaveLength(2);
  });

  test("--filter-type filters events before policy evaluation", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "allow.policy.yaml", ALLOW_POLICY);

    // Filter to only lifecycle events — should still pass with allow-all policy
    const result = await runEvaluate([
      "--trace",
      tracePath,
      "--policy",
      policyPath,
      "--filter-type",
      "lifecycle",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.output?.verdict).toBe("pass");
  });
});
