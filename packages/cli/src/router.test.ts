import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { routeCommand } from "./router.js";
import { computeHashChain, canonicalize } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-router-"));
  return tempDir;
}

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

function makeValidEvents(): TraceEvent[] {
  return [
    {
      ...BASE,
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

async function writeTrace(dir: string, filename: string): Promise<string> {
  const chained = computeHashChain(makeValidEvents());
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  const filePath = join(dir, filename);
  await writeFile(filePath, lines.join("\n") + "\n");
  return filePath;
}

describe("routeCommand", () => {
  test("routes 'evaluate' to runEvaluate", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl");
    const policyPath = join(dir, "test.policy.yaml");
    await writeFile(policyPath, ALLOW_POLICY);

    const result = await routeCommand(["evaluate", "--trace", tracePath, "--policy", policyPath]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.verdict).toBeDefined();
  });

  test("routes 'replay' to runReplay", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl");

    const result = await routeCommand(["replay", "--verify", "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(Array.isArray(output)).toBe(true);
  });

  test("routes 'validate' to runValidate", async () => {
    const dir = await createTempDir();
    const policyPath = join(dir, "test.policy.yaml");
    await writeFile(policyPath, ALLOW_POLICY);

    const result = await routeCommand(["validate", "--policy", policyPath]);

    expect(result.exitCode).toBe(0);
  });

  test("--help with no command returns main help on stdout, exit 0", async () => {
    const result = await routeCommand(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("evaluate");
    expect(result.stdout).toContain("replay");
    expect(result.stdout).toContain("validate");
    expect(result.stderr).toBe("");
  });

  test("--version returns version string on stdout, exit 0", async () => {
    const result = await routeCommand(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^krynix \d+\.\d+\.\d+/);
    expect(result.stderr).toBe("");
  });

  test("evaluate --help returns evaluate-specific help", async () => {
    const result = await routeCommand(["evaluate", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--trace");
    expect(result.stdout).toContain("--policy");
  });

  test("replay --help returns replay-specific help", async () => {
    const result = await routeCommand(["replay", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--verify");
    expect(result.stdout).toContain("--regenerate");
  });

  test("validate --help returns validate-specific help", async () => {
    const result = await routeCommand(["validate", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--policy");
  });

  test("unknown command returns exit 1 with stderr message", async () => {
    const result = await routeCommand(["foobar"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
    expect(result.stderr).toContain("foobar");
  });

  test("no arguments returns main help on stdout, exit 0", async () => {
    const result = await routeCommand([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("evaluate");
    expect(result.stdout).toContain("replay");
  });

  test("evaluate stdout is valid JSON", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl");
    const policyPath = join(dir, "test.policy.yaml");
    await writeFile(policyPath, ALLOW_POLICY);

    const result = await routeCommand(["evaluate", "--trace", tracePath, "--policy", policyPath]);

    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  test("replay errors go to stderr not stdout", async () => {
    const result = await routeCommand(["replay", "--verify", "--trace", "/nonexistent/file"]);

    expect(result.exitCode).toBe(1);
    // stdout still has valid JSON (the results array)
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Sprint 4: stats and policy routes
  // -------------------------------------------------------------------------

  test("routes 'stats' to runStats", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl");

    const result = await routeCommand(["stats", "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.event_count).toBeDefined();
    expect(output.tool_call_count).toBeDefined();
  });

  test("stats --help returns stats-specific help", async () => {
    const result = await routeCommand(["stats", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--trace");
    expect(result.stdout).toContain("event_count");
  });

  test("routes 'policy test' to runPolicyTest", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "valid.trace.jsonl");
    const policyPath = join(dir, "test.policy.yaml");
    await writeFile(policyPath, ALLOW_POLICY);

    const result = await routeCommand([
      "policy",
      "test",
      "--policy",
      policyPath,
      "--trace",
      tracePath,
    ]);

    expect(result.exitCode).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.verdict).toBeDefined();
  });

  test("policy --help returns policy namespace help", async () => {
    const result = await routeCommand(["policy", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--policy");
    expect(result.stdout).toContain("--expect-verdict");
  });

  test("policy with unknown subcommand returns exit 1", async () => {
    const result = await routeCommand(["policy", "unknown"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown policy subcommand");
    expect(result.stderr).toContain("unknown");
  });
});
