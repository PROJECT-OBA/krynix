/**
 * Realistic policy evaluation tests against golden traces.
 *
 * Uses the actual golden trace files and actual example policy files
 * to verify that policy evaluation produces correct results on
 * real-world (non-synthetic) data.
 */

import { describe, test, expect } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readTrace, validateHashChain } from "../../packages/core/src/index.js";
import { evaluate, parsePolicy } from "../../packages/policy/src/index.js";

const ROOT = resolve(import.meta.dirname, "../..");
const GOLDEN_DIR = resolve(ROOT, "test/golden");
const POLICY_DIR = resolve(ROOT, "policies/examples");

function loadPolicy(filename: string) {
  const yaml = readFileSync(resolve(POLICY_DIR, filename), "utf-8");
  return parsePolicy(yaml);
}

describe("golden traces vs real example policies", () => {
  describe("realistic-coding-session.trace.jsonl (26 events)", () => {
    test("no-shell-execution policy detects shell_exec violations", async () => {
      const events = await readTrace(resolve(GOLDEN_DIR, "realistic-coding-session.trace.jsonl"));
      expect(events.length).toBe(26);

      // Verify hash chain is valid first
      expect(validateHashChain(events).valid).toBe(true);

      const policy = loadPolicy("no-shell-execution.policy.yaml");
      const result = evaluate(events, policy);

      // This trace has shell_exec at events 14 and 20 — both should be denied
      expect(result.exitCode).toBe(2); // critical severity
      expect(result.verdict).toBe("fail");

      const shellViolations = result.violations.filter(
        (v) => v.ruleId === "block-shell-tools",
      );
      expect(shellViolations.length).toBe(2);

      // Verify the violations point to the correct events
      for (const v of shellViolations) {
        const event = events[v.eventIndex];
        expect(event).toBeTruthy();
        expect(event!.event_type).toBe("tool_call");
        expect((event!.payload as { tool_name: string }).tool_name).toBe("shell_exec");
      }
    });

    test("file-operations-gate policy detects writes and allows reads", async () => {
      const events = await readTrace(resolve(GOLDEN_DIR, "realistic-coding-session.trace.jsonl"));
      const policy = loadPolicy("file-operations-gate.policy.yaml");
      const result = evaluate(events, policy);

      // Overall: require-approval due to file_write matches
      expect(result.verdict).toBe("require-approval");
      expect(result.exitCode).toBe(3);

      // file_write events (10, 12) should require approval
      // file_read events (4, 6, 17) should be allowed
      // shell_exec events (14, 20) don't match any file operation rules → unmatched → allow
      const writeViolations = result.violations.filter(
        (v) => v.ruleId === "require-approval-file-write",
      );
      expect(writeViolations.length).toBe(2);
      const expectedWriteEventIndices = new Set([10, 12]);

      for (const v of writeViolations) {
        expect(v.action).toBe("require-approval");
        expect(v.severity).toBe("warning");
        expect(expectedWriteEventIndices.has(v.eventIndex)).toBe(true);
      }

      // No deny violations — file_read and shell_exec don't match deletion patterns
      const denyViolations = result.violations.filter(
        (v) => v.ruleId === "block-file-deletion",
      );
      expect(denyViolations.length).toBe(0);
    });

    test("llm-cost-control policy records LLM usage", async () => {
      const events = await readTrace(resolve(GOLDEN_DIR, "realistic-coding-session.trace.jsonl"));
      const policy = loadPolicy("llm-cost-control.policy.yaml");
      const result = evaluate(events, policy);

      // Overall: require-approval due to unapproved model
      expect(result.verdict).toBe("require-approval");
      expect(result.exitCode).toBe(3);

      // The llm-cost-control policy has model allowlist — check if the model is approved
      // The trace uses claude-sonnet-4-6-20260315 which is NOT in the approved list
      // (approved: gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514, claude-haiku-4-5-20251001, gemini-2.0-flash)
      const modelViolations = result.violations.filter(
        (v) => v.ruleId === "block-unapproved-models",
      );
      // There are 3 llm_request events, all with claude-sonnet-4-6-20260315 (not in list)
      expect(modelViolations.length).toBe(3);
      expect(modelViolations[0]?.action).toBe("require-approval");
    });
  });

  describe("openclaw-minimal.trace.jsonl (10 events)", () => {
    test("no-shell-execution policy catches shell_exec", async () => {
      const events = await readTrace(resolve(GOLDEN_DIR, "openclaw-minimal.trace.jsonl"));
      expect(events.length).toBe(10);
      expect(validateHashChain(events).valid).toBe(true);

      const policy = loadPolicy("no-shell-execution.policy.yaml");
      const result = evaluate(events, policy);

      expect(result.exitCode).toBe(2); // critical
      expect(result.verdict).toBe("fail");

      const violations = result.violations.filter((v) => v.ruleId === "block-shell-tools");
      expect(violations.length).toBeGreaterThanOrEqual(1);

      // The shell_exec is at event index 4 (sequence_num 4)
      const shellViolation = violations[0]!;
      const event = events[shellViolation.eventIndex];
      expect((event!.payload as { tool_name: string }).tool_name).toBe("shell_exec");
    });

    test("file-operations-gate catches file_read as allowed", async () => {
      const events = await readTrace(resolve(GOLDEN_DIR, "openclaw-minimal.trace.jsonl"));
      const policy = loadPolicy("file-operations-gate.policy.yaml");
      const result = evaluate(events, policy);

      // file_read should be allowed (no violations for allow actions)
      // shell_exec doesn't match file operation patterns → unmatched → allow
      expect(result.verdict).toBe("pass");
      expect(result.exitCode).toBe(0);

      const readViolations = result.violations.filter(
        (v) => v.ruleId === "allow-file-read",
      );
      // allow rules don't produce violations
      expect(readViolations.length).toBe(0);
    });
  });

  describe("minimal.trace.jsonl (3 events)", () => {
    test("all example policies pass on minimal trace", async () => {
      const events = await readTrace(resolve(GOLDEN_DIR, "minimal.trace.jsonl"));
      expect(events.length).toBe(3);
      expect(validateHashChain(events).valid).toBe(true);

      // Minimal trace: lifecycle + file_read + lifecycle
      // No violations expected from any policy
      for (const policyFile of [
        "no-shell-execution.policy.yaml",
        "file-operations-gate.policy.yaml",
        "llm-cost-control.policy.yaml",
      ]) {
        const policy = loadPolicy(policyFile);
        const result = evaluate(events, policy);
        expect(result.verdict, `Expected pass for ${policyFile}`).toBe("pass");
        expect(result.exitCode, `Expected exit 0 for ${policyFile}`).toBe(0);
      }
    });
  });

  describe("cross-policy evaluation consistency", () => {
    test("same trace evaluated against multiple policies produces consistent event indices", async () => {
      const events = await readTrace(resolve(GOLDEN_DIR, "realistic-coding-session.trace.jsonl"));

      const shellPolicy = loadPolicy("no-shell-execution.policy.yaml");
      const filePolicy = loadPolicy("file-operations-gate.policy.yaml");

      const shellResult = evaluate(events, shellPolicy);
      const fileResult = evaluate(events, filePolicy);

      // Verify overall verdicts
      expect(shellResult.verdict).toBe("fail");
      expect(shellResult.exitCode).toBe(2);
      expect(fileResult.verdict).toBe("require-approval");
      expect(fileResult.exitCode).toBe(3);

      // Shell violations and file violations should reference different events
      const shellEventIndices = new Set(shellResult.violations.map((v) => v.eventIndex));
      const fileWriteViolations = fileResult.violations.filter(
        (v) => v.ruleId === "require-approval-file-write",
      );
      const fileEventIndices = new Set(fileWriteViolations.map((v) => v.eventIndex));

      // Shell events and file_write events should not overlap
      for (const idx of shellEventIndices) {
        expect(fileEventIndices.has(idx)).toBe(false);
      }
    });
  });
});
