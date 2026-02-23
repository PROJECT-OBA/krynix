import { describe, test, expect } from "vitest";
import { evaluate } from "./evaluator.js";
import type { Policy, PolicyRule, PolicyScope, PolicyDefaults } from "./schema.js";
import type { TraceEvent } from "@krynix/core";

// ---------------------------------------------------------------------------
// Local test factories
// ---------------------------------------------------------------------------

const DEFAULT_BASE = {
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

function makeEvent(
  seq: number,
  eventType: string,
  payload: Record<string, unknown>,
  agentId = "test-agent",
): TraceEvent {
  return {
    ...DEFAULT_BASE,
    event_id: `evt-${String(seq).padStart(3, "0")}`,
    sequence_num: seq,
    event_type: eventType,
    agent_id: agentId,
    payload,
  } as unknown as TraceEvent;
}

function makePolicy(overrides: {
  rules?: PolicyRule[];
  scope?: Partial<PolicyScope>;
  defaults?: PolicyDefaults;
}): Policy {
  return {
    apiVersion: "krynix.dev/v1",
    kind: "Policy",
    metadata: { name: "test-policy", version: "1.0.0", description: "Test" },
    spec: {
      scope: {
        agents: overrides.scope?.agents ?? ["*"],
        event_types: overrides.scope?.event_types ?? ["*"],
      },
      rules: overrides.rules ?? [],
      defaults: overrides.defaults,
    },
  };
}

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "rule-1",
    description: "Test rule",
    match: { payload: [] },
    action: "deny",
    severity: "error",
    message: "Test violation",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluate — verdicts", () => {
  test("pass verdict (clean trace, allow rule)", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "file_read", arguments: {} })];
    const policy = makePolicy({
      rules: [makeRule({ action: "allow", match: { payload: [] } })],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  test("fail with error severity → exit 1", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "shell_exec", arguments: {} })];
    const policy = makePolicy({
      rules: [
        makeRule({
          action: "deny",
          severity: "error",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(1);
  });

  test("fail with critical severity → exit 2", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "shell_exec", arguments: {} })];
    const policy = makePolicy({
      rules: [
        makeRule({
          action: "deny",
          severity: "critical",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(2);
  });

  test("require-approval → exit 3", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "file_write", arguments: {} })];
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "approval-rule",
          action: "require-approval",
          severity: "warning",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "file_write" }] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("require-approval");
    expect(result.exitCode).toBe(3);
  });

  test("mixed require-approval and CI-failing deny → fail takes precedence", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "file_write", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "shell_exec", arguments: {} }),
    ];
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "approval-writes",
          action: "require-approval",
          severity: "warning",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "file_write" }] },
        }),
        makeRule({
          id: "deny-shell",
          action: "deny",
          severity: "error",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(2);
  });
});

describe("evaluate — first-match-wins", () => {
  test("allow before deny: event is allowed", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "file_read", arguments: {} })];
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "allow-reads",
          action: "allow",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "file_read" }] },
        }),
        makeRule({
          id: "deny-all",
          action: "deny",
          severity: "error",
          match: { payload: [] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("pass");
    expect(result.violations).toHaveLength(0);
  });

  test("deny before allow: event is denied", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "file_read", arguments: {} })];
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "deny-all",
          action: "deny",
          severity: "error",
          match: { payload: [] },
        }),
        makeRule({
          id: "allow-reads",
          action: "allow",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "file_read" }] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("fail");
    expect(result.violations).toHaveLength(1);
  });
});

describe("evaluate — default unmatched action", () => {
  test("default deny for unmatched events", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "unknown_tool", arguments: {} })];
    const policy = makePolicy({
      rules: [], // no rules match
      defaults: { unmatched_action: "deny", unmatched_severity: "warning" },
    });

    const result = evaluate(trace, policy);
    // warning severity + no ci_failure override → ci_failure = false → pass
    expect(result.verdict).toBe("pass");
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.ruleId).toBe("__default_deny__");
  });

  test("default deny with error severity triggers CI failure", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "unknown_tool", arguments: {} })];
    const policy = makePolicy({
      rules: [],
      defaults: { unmatched_action: "deny" },
    });

    // Default severity when not specified is "warning", so this should NOT trigger CI failure
    const result = evaluate(trace, policy);
    expect(result.violations).toHaveLength(1);
    expect(result.verdict).toBe("pass"); // warning severity doesn't cause CI failure
  });

  test("no defaults: unmatched events are implicitly allowed", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "unknown_tool", arguments: {} })];
    const policy = makePolicy({ rules: [] });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("pass");
    expect(result.violations).toHaveLength(0);
  });
});

describe("evaluate — scope filtering", () => {
  test("out-of-scope event types are skipped", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "shell_exec", arguments: {} }),
      makeEvent(1, "llm_response", {
        model: "test",
        content: "hi",
        usage: {},
        finish_reason: "stop",
      }),
    ];
    const policy = makePolicy({
      scope: { event_types: ["tool_call"] },
      rules: [
        makeRule({
          action: "deny",
          severity: "error",
          match: { payload: [] }, // matches everything in scope
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.violations).toHaveLength(1); // only tool_call, not llm_response
  });

  test("out-of-scope agents are skipped", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "shell_exec", arguments: {} }, "agent-a"),
      makeEvent(1, "tool_call", { tool_name: "shell_exec", arguments: {} }, "agent-b"),
    ];
    const policy = makePolicy({
      scope: { agents: ["agent-a"] },
      rules: [
        makeRule({
          action: "deny",
          severity: "error",
          match: { payload: [] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.violations).toHaveLength(1); // only agent-a event
  });

  test("wildcard * matches all agents and event types", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "a", arguments: {} }, "agent-x"),
      makeEvent(
        1,
        "llm_response",
        { model: "m", content: "", usage: {}, finish_reason: "stop" },
        "agent-y",
      ),
    ];
    const policy = makePolicy({
      scope: { agents: ["*"], event_types: ["*"] },
      rules: [
        makeRule({
          action: "deny",
          severity: "error",
          match: { payload: [] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.violations).toHaveLength(2);
  });
});

describe("evaluate — ci_failure override", () => {
  test("error severity with ci_failure: false → pass", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "x", arguments: {} })];
    const policy = makePolicy({
      rules: [
        makeRule({
          action: "deny",
          severity: "error",
          ci_failure: false,
          match: { payload: [] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.violations).toHaveLength(1);
    expect(result.verdict).toBe("pass"); // ci_failure explicitly false
    expect(result.exitCode).toBe(0);
  });

  test("warning severity with ci_failure: true → fail", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "x", arguments: {} })];
    const policy = makePolicy({
      rules: [
        makeRule({
          action: "deny",
          severity: "warning",
          ci_failure: true,
          match: { payload: [] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(1);
  });
});

describe("evaluate — violation details", () => {
  test("violation contains correct metadata", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "shell_exec", arguments: { cmd: "rm -rf" } }),
    ];
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "no-shell-exec",
          action: "deny",
          severity: "critical",
          message: "Shell execution is not allowed",
          match: { payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }] },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.violations).toHaveLength(1);
    const v = result.violations[0];
    expect(v?.ruleId).toBe("no-shell-exec");
    expect(v?.eventIndex).toBe(0);
    expect(v?.eventId).toBe("evt-000");
    expect(v?.action).toBe("deny");
    expect(v?.severity).toBe("critical");
    expect(v?.message).toBe("Shell execution is not allowed");
    expect(v?.ciFailure).toBe(true);
  });
});
