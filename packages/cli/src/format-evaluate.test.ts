import { describe, test, expect } from "vitest";
import { formatEvaluateText } from "./format-evaluate.js";
import type { AggregateOutput } from "./evaluate.js";
import type { EvaluationResult } from "@krynix/policy";

function makeResult(overrides: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    verdict: "pass",
    exitCode: 0,
    violations: [],
    warnings: [],
    ...overrides,
  };
}

describe("formatEvaluateText", () => {
  test("pass verdict with no violations", () => {
    const output: AggregateOutput = {
      verdict: "pass",
      exitCode: 0,
      policyResults: [{ policyName: "test.policy.yaml", result: makeResult() }],
    };

    const text = formatEvaluateText(output);

    expect(text).toContain("Policy: test.policy.yaml");
    expect(text).toContain("Verdict: PASS (exit code 0)");
    expect(text).toContain("Result: PASS");
    expect(text).toContain("0 violations");
    expect(text).not.toContain("Violations (");
  });

  test("fail verdict with violations", () => {
    const output: AggregateOutput = {
      verdict: "fail",
      exitCode: 1,
      policyResults: [
        {
          policyName: "no-shell-exec.policy.yaml",
          result: makeResult({
            verdict: "fail",
            exitCode: 1,
            violations: [
              {
                ruleId: "block-shell",
                eventIndex: 7,
                eventId: "evt-007",
                action: "deny",
                severity: "error",
                message: "Shell execution denied",
                ciFailure: true,
              },
              {
                ruleId: "block-exec",
                eventIndex: 12,
                eventId: "evt-012",
                action: "deny",
                severity: "critical",
                message: "Code execution denied",
                ciFailure: true,
              },
            ],
          }),
        },
      ],
    };

    const text = formatEvaluateText(output);

    expect(text).toContain("Verdict: FAIL (exit code 1)");
    expect(text).toContain("Violations (2):");
    expect(text).toContain("[error]  block-shell: Shell execution denied");
    expect(text).toContain("[critical]  block-exec: Code execution denied");
    expect(text).toContain("Result: FAIL");
    expect(text).toContain("2 violations");
  });

  test("includes warnings when present", () => {
    const output: AggregateOutput = {
      verdict: "pass",
      exitCode: 0,
      policyResults: [
        {
          policyName: "test.policy.yaml",
          result: makeResult({
            warnings: [
              {
                code: "ON_VIOLATION_NOTIFY_NOT_IMPLEMENTED",
                ruleId: "r1",
                message:
                  "Rule 'r1' defines on_violation.notify but notification delivery is not yet implemented (PLANNED). If this rule triggers a violation, the violation will still be recorded.",
              },
            ],
          }),
        },
      ],
    };

    const text = formatEvaluateText(output);

    expect(text).toContain("Warnings:");
    expect(text).toContain("on_violation.notify");
  });

  test("multiple policies", () => {
    const output: AggregateOutput = {
      verdict: "pass",
      exitCode: 0,
      policyResults: [
        { policyName: "policy-a.policy.yaml", result: makeResult() },
        { policyName: "policy-b.policy.yaml", result: makeResult() },
      ],
    };

    const text = formatEvaluateText(output);

    expect(text).toContain("Policy: policy-a.policy.yaml");
    expect(text).toContain("Policy: policy-b.policy.yaml");
    expect(text).toContain("2 policies");
  });
});
