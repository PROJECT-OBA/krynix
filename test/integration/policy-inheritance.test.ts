/**
 * Sprint 5 integration tests: Policy inheritance pipeline.
 *
 * Exercises: create policy hierarchy → resolve inheritance → evaluate against trace.
 */

import { describe, test, expect, beforeEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  StreamingHashValidator,
  computeHashChain,
  canonicalize,
} from "../../packages/core/src/index.js";
import type { PartialTraceEvent, TraceEvent } from "../../packages/core/src/index.js";
import {
  parsePolicy,
  mergePolicy,
  resolvePolicy,
  evaluate,
  diffPolicies,
} from "../../packages/policy/src/index.js";
import { runPolicyDiff } from "../../packages/cli/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, "../golden");

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-inherit-"));
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

const BASE_EVENT = {
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

function makeBasicEvents(): TraceEvent[] {
  return [
    {
      ...BASE_EVENT,
      event_type: "lifecycle",
      payload: { action: "session_start", context: { replay_seed: 42 } },
    } as unknown as TraceEvent,
    {
      ...BASE_EVENT,
      event_id: "evt-001",
      sequence_num: 1,
      event_type: "tool_call",
      payload: { tool_name: "file_read", arguments: { path: "/tmp/test.txt" } },
    } as unknown as TraceEvent,
    {
      ...BASE_EVENT,
      event_id: "evt-002",
      sequence_num: 2,
      timestamp: "2025-01-15T14:00:05.000Z",
      event_type: "lifecycle",
      payload: { action: "session_end" },
    } as unknown as TraceEvent,
  ];
}

async function writeTrace(dir: string, events: TraceEvent[]): Promise<string> {
  const path = join(dir, "trace.jsonl");
  const chained = computeHashChain(events);
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

const PARENT_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: base-policy
  version: "1.0.0"
  description: Base policy with deny-all default
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: deny-shell
      description: Deny shell execution
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: critical
      message: Shell execution denied
  defaults:
    unmatched_action: deny
`;

const CHILD_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: child-policy
  version: "1.0.0"
  description: Child policy extending base
  extends: base.policy.yaml
spec:
  scope:
    agents: ["test-agent"]
    event_types: ["*"]
  rules:
    - id: allow-file-read
      description: Allow file read
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: file_read
      action: allow
      severity: info
      message: File read allowed
`;

const GRANDPARENT_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: grandparent-policy
  version: "1.0.0"
  description: Grandparent policy
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: audit-all
      description: Audit all events
      match:
        payload: []
      action: allow
      severity: info
      message: Audited
  defaults:
    unmatched_action: deny
    unmatched_severity: warning
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Policy inheritance pipeline", () => {
  test("child extending parent: resolved policy has merged rules", async () => {
    const parent = parsePolicy(PARENT_POLICY);
    const child = parsePolicy(CHILD_POLICY);

    const resolved = await resolvePolicy(child, async () => parent);

    expect(resolved.metadata.name).toBe("child-policy");
    expect(resolved.spec.rules).toHaveLength(2);
    expect(resolved.spec.rules[0]!.id).toBe("allow-file-read");
    expect(resolved.spec.rules[1]!.id).toBe("deny-shell");
    expect(resolved.spec.defaults?.unmatched_action).toBe("deny");
  });

  test("three-level chain resolves correctly", async () => {
    const gp = parsePolicy(GRANDPARENT_POLICY);

    const parentYaml = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: middle-policy
  version: "1.0.0"
  description: Middle policy
  extends: gp.policy.yaml
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: deny-shell
      description: Deny shell
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: critical
      message: Shell denied
`;

    const childYaml = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: leaf-policy
  version: "1.0.0"
  description: Leaf policy
  extends: middle.policy.yaml
spec:
  scope:
    agents: ["test-agent"]
    event_types: ["*"]
  rules:
    - id: allow-file-read
      description: Allow file read
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: file_read
      action: allow
      severity: info
      message: Allowed
`;

    const parent = parsePolicy(parentYaml);
    const child = parsePolicy(childYaml);

    const resolver = async (ref: string) => {
      if (ref === "middle.policy.yaml") return parent;
      if (ref === "gp.policy.yaml") return gp;
      throw new Error(`unknown ref: ${ref}`);
    };

    const resolved = await resolvePolicy(child, resolver);

    expect(resolved.spec.rules).toHaveLength(3);
    expect(resolved.spec.rules[0]!.id).toBe("allow-file-read");
    expect(resolved.spec.rules[1]!.id).toBe("deny-shell");
    expect(resolved.spec.rules[2]!.id).toBe("audit-all");
    expect(resolved.spec.defaults?.unmatched_action).toBe("deny");
    expect(resolved.spec.defaults?.unmatched_severity).toBe("warning");
  });

  test("child rule overrides parent rule by ID", async () => {
    const parent = parsePolicy(PARENT_POLICY);
    const childYaml = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: override-policy
  version: "1.0.0"
  description: Override deny-shell to allow
  extends: base.policy.yaml
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: deny-shell
      description: Allow shell (override)
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: allow
      severity: info
      message: Shell allowed (overridden)
`;
    const child = parsePolicy(childYaml);
    const resolved = await resolvePolicy(child, async () => parent);

    expect(resolved.spec.rules).toHaveLength(1);
    expect(resolved.spec.rules[0]!.id).toBe("deny-shell");
    expect(resolved.spec.rules[0]!.action).toBe("allow");
  });
});

describe("Streaming validator pipeline", () => {
  test("write events → validate with StreamingHashValidator → all pass", async () => {
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
        output: "contents",
        duration_ms: 100,
      }),
    );

    await endSession(session);

    const events = await readTrace(outputPath);
    const validator = new StreamingHashValidator();

    for (const event of events) {
      const result = validator.validate(event);
      expect(result.valid).toBe(true);
    }

    expect(validator.eventsValidated).toBe(events.length);
  });

  test("tamper with event mid-stream → validator catches it", async () => {
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

    await endSession(session);

    const events = await readTrace(outputPath);
    const validator = new StreamingHashValidator();

    // Validate first event (should pass)
    expect(validator.validate(events[0]!).valid).toBe(true);

    // Tamper with second event's hash
    const tampered = { ...events[1]!, event_hash: "tampered-hash" };
    const result = validator.validate(tampered);
    expect(result.valid).toBe(false);
  });
});

describe("Policy diff CLI pipeline", () => {
  test("diff of identical golden policies → exit 0, no changes", async () => {
    const policyPath = resolve(
      __dirname,
      "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml",
    );

    const result = await runPolicyDiff(["--old", policyPath, "--new", policyPath]);
    expect(result.exitCode).toBe(0);
    expect(result.result).not.toBeNull();
    expect(result.result!.hasChanges).toBe(false);
  });

  test("diff with weakened rules → exit 2", async () => {
    const strongPath = join(tempDir, "strong.policy.yaml");
    const weakPath = join(tempDir, "weak.policy.yaml");

    await writeFile(
      strongPath,
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: strong
  version: "1.0.0"
  description: Strong policy
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: deny-shell
      description: Deny shell
      match:
        payload: []
      action: deny
      severity: critical
      message: Denied
`,
    );

    await writeFile(
      weakPath,
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: strong
  version: "2.0.0"
  description: Weakened policy
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: deny-shell
      description: Allow shell (weakened)
      match:
        payload: []
      action: allow
      severity: info
      message: Allowed
`,
    );

    const result = await runPolicyDiff(["--old", strongPath, "--new", weakPath]);
    expect(result.exitCode).toBe(2);
    expect(result.result!.hasActionWeakening).toBe(true);
    expect(result.result!.hasSeverityDowngrade).toBe(true);
  });
});
