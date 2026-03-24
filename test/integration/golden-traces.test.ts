/**
 * Golden trace verification integration tests.
 *
 * Ensures the checked-in golden traces under `test/golden/` remain valid.
 * Equivalent to running `krynix replay --verify --golden-dir test/golden/`.
 */

import { describe, test, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { verifyTrace, verifyGoldenDir } from "../../packages/replay/src/index.js";
import { readTrace } from "../../packages/core/src/index.js";
import { evaluate, parsePolicy } from "../../packages/policy/src/index.js";

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

  // ---------------------------------------------------------------------------
  // Sprint 8: new golden trace tests
  // ---------------------------------------------------------------------------

  test("multi-agent.trace.jsonl passes verifyTrace with 20+ events", async () => {
    const result = await verifyTrace(resolve(GOLDEN_DIR, "multi-agent.trace.jsonl"));

    expect(result.status).toBe("pass");
    expect(result.report!.totalEvents).toBeGreaterThanOrEqual(20);
  });

  test("multi-agent.trace.jsonl has events from two distinct agents", async () => {
    const events = await readTrace(resolve(GOLDEN_DIR, "multi-agent.trace.jsonl"));
    const agentIds = new Set(events.map((e) => e.agent_id));

    // Should have at least 2 agent IDs (agent-alpha and agent-beta)
    expect(agentIds.size).toBeGreaterThanOrEqual(2);
    expect(agentIds.has("agent-alpha")).toBe(true);
    expect(agentIds.has("agent-beta")).toBe(true);
  });

  test("policy-violation.trace.jsonl passes verifyTrace", async () => {
    const result = await verifyTrace(resolve(GOLDEN_DIR, "policy-violation.trace.jsonl"));

    expect(result.status).toBe("pass");
    expect(result.report!.totalEvents).toBeGreaterThanOrEqual(15);
  });

  test("policy-violation.trace.jsonl triggers deny + require-approval violations", async () => {
    const events = await readTrace(resolve(GOLDEN_DIR, "policy-violation.trace.jsonl"));

    const policyYaml = await readFile(
      resolve(__dirname, "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml"),
      "utf-8",
    );
    const policy = parsePolicy(policyYaml);
    const result = evaluate(events, policy);

    // Should have denials (shell_exec) and require-approval (file_write)
    expect(result.exitCode).toBeGreaterThan(0);

    const denyViolations = result.violations.filter((v) => v.ruleId === "deny-shell-exec");
    expect(denyViolations.length).toBeGreaterThan(0);

    const approvalViolations = result.violations.filter((v) => v.ruleId === "require-approval-file-write");
    expect(approvalViolations.length).toBeGreaterThan(0);
  });

  test("complex-workflow.trace.jsonl passes verifyTrace with 30+ events", async () => {
    const result = await verifyTrace(resolve(GOLDEN_DIR, "complex-workflow.trace.jsonl"));

    expect(result.status).toBe("pass");
    expect(result.report!.totalEvents).toBeGreaterThanOrEqual(30);
  });

  // ---------------------------------------------------------------------------
  // Realistic golden trace (Phase A2 — real-world-scale validation)
  // ---------------------------------------------------------------------------

  test("realistic-coding-session.trace.jsonl passes verifyTrace with 26 events", async () => {
    const result = await verifyTrace(resolve(GOLDEN_DIR, "realistic-coding-session.trace.jsonl"));

    expect(result.status).toBe("pass");
    expect(result.report!.totalEvents).toBe(26);
  });

  test("realistic-coding-session.trace.jsonl covers all major event types", async () => {
    const events = await readTrace(resolve(GOLDEN_DIR, "realistic-coding-session.trace.jsonl"));
    const eventTypes = new Set(events.map((e) => e.event_type));

    // Must have all 7 commonly-used event types (error is not present in a successful session)
    expect(eventTypes.has("lifecycle")).toBe(true);
    expect(eventTypes.has("observation")).toBe(true);
    expect(eventTypes.has("llm_request")).toBe(true);
    expect(eventTypes.has("llm_response")).toBe(true);
    expect(eventTypes.has("tool_call")).toBe(true);
    expect(eventTypes.has("tool_result")).toBe(true);
    expect(eventTypes.has("decision")).toBe(true);
  });

  test("realistic-coding-session.trace.jsonl has redacted events and metadata namespaces", async () => {
    const events = await readTrace(resolve(GOLDEN_DIR, "realistic-coding-session.trace.jsonl"));

    // At least one event should be redacted (the .env read)
    const redacted = events.filter((e) => e.redacted);
    expect(redacted.length).toBeGreaterThanOrEqual(1);

    // Metadata should use platform-standard namespaces
    const namespaces = new Set<string>();
    for (const e of events) {
      if (e.metadata) {
        for (const k of Object.keys(e.metadata)) {
          namespaces.add(k.split(".")[0]);
        }
      }
    }
    expect(namespaces.has("guard")).toBe(true);
    expect(namespaces.has("intent")).toBe(true);
    expect(namespaces.has("runtime")).toBe(true);
    expect(namespaces.has("output")).toBe(true);
  });
});
