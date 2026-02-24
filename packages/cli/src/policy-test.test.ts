import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runPolicyTest } from "./policy-test.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-policy-test-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Fixture helpers
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
      timestamp: "2025-01-15T14:00:05.000Z",
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

const DENY_POLICY = `
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

const REQUIRE_APPROVAL_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: require-approval
  version: "1.0.0"
  description: Require approval for everything
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

describe("runPolicyTest", () => {
  test("policy test with passing trace → exit 0, verdict reported", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "allow.policy.yaml", ALLOW_POLICY);

    const result = await runPolicyTest(["--policy", policyPath, "--trace", tracePath]);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
    expect(result.result).not.toBeNull();
    expect(result.result?.verdict).toBe("pass");
    expect(result.result?.expectation).toBeNull();
  });

  test("policy with deny rule → exit 0, violations listed", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "deny.policy.yaml", DENY_POLICY);

    const result = await runPolicyTest(["--policy", policyPath, "--trace", tracePath]);
    expect(result.exitCode).toBe(0); // reporting mode — always exit 0 without --expect-verdict
    expect(result.result).not.toBeNull();
    expect(result.result?.verdict).toBe("fail");
    expect(result.result?.violations.length).toBeGreaterThan(0);
    expect(result.result?.violations[0]?.ruleId).toBe("deny-all");
  });

  test("--expect-verdict pass with pass result → exit 0, match true", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "allow.policy.yaml", ALLOW_POLICY);

    const result = await runPolicyTest([
      "--policy",
      policyPath,
      "--trace",
      tracePath,
      "--expect-verdict",
      "pass",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.result?.expectation).not.toBeNull();
    expect(result.result?.expectation?.match).toBe(true);
    expect(result.result?.expectation?.expected).toBe("pass");
    expect(result.result?.expectation?.actual).toBe("pass");
  });

  test("--expect-verdict fail with pass result → exit 1, match false", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "allow.policy.yaml", ALLOW_POLICY);

    const result = await runPolicyTest([
      "--policy",
      policyPath,
      "--trace",
      tracePath,
      "--expect-verdict",
      "fail",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.result?.expectation).not.toBeNull();
    expect(result.result?.expectation?.match).toBe(false);
    expect(result.result?.expectation?.expected).toBe("fail");
    expect(result.result?.expectation?.actual).toBe("pass");
  });

  test("--expect-verdict require-approval with matching result → exit 0", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir, "approval.policy.yaml", REQUIRE_APPROVAL_POLICY);

    const result = await runPolicyTest([
      "--policy",
      policyPath,
      "--trace",
      tracePath,
      "--expect-verdict",
      "require-approval",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.result?.verdict).toBe("require-approval");
    expect(result.result?.expectation?.match).toBe(true);
  });

  test("missing --policy → exit 1 with error", async () => {
    const result = await runPolicyTest(["--trace", "something.jsonl"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--policy");
    expect(result.result).toBeNull();
  });

  test("missing --trace → exit 1 with error", async () => {
    const result = await runPolicyTest(["--policy", "something.yaml"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
    expect(result.result).toBeNull();
  });

  test("policy parse error → exit 1 with structured error", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const badPolicyPath = await writePolicy(dir, "bad.policy.yaml", "not: valid: yaml: policy");

    const result = await runPolicyTest(["--policy", badPolicyPath, "--trace", tracePath]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to parse policy");
    expect(result.result).toBeNull();
  });

  test("nonexistent trace file → exit 1 with error", async () => {
    const dir = await createTempDir();
    const policyPath = await writePolicy(dir, "allow.policy.yaml", ALLOW_POLICY);

    const result = await runPolicyTest([
      "--policy",
      policyPath,
      "--trace",
      "/nonexistent/trace.jsonl",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read trace");
  });

  test("invalid --expect-verdict value → exit 1 with error", async () => {
    const result = await runPolicyTest([
      "--policy",
      "p.yaml",
      "--trace",
      "t.jsonl",
      "--expect-verdict",
      "invalid",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Invalid --expect-verdict");
  });
});
