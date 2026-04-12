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

// ---------------------------------------------------------------------------
// on_violation warnings
// ---------------------------------------------------------------------------

describe("evaluate — on_violation warnings", () => {
  test("no warnings when on_violation is absent", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "test", arguments: {} })];
    const policy = makePolicy({ rules: [makeRule()] });

    const result = evaluate(trace, policy);
    // makeRule matches the single event, so no RULE_NEVER_MATCHED either.
    expect(result.warnings).toEqual([]);
  });

  test("warns when on_violation.notify is defined", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "test", arguments: {} })];
    const rule = makeRule({
      on_violation: { notify: ["#security-channel"] },
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    expect(result.warnings).toHaveLength(1);
    const w = result.warnings[0];
    expect(w).toBeDefined();
    if (!w) return;
    expect(w.code).toBe("ON_VIOLATION_NOTIFY_NOT_IMPLEMENTED");
    expect(w.ruleId).toBe("rule-1");
    expect(w.message).toContain("on_violation.notify");
    expect(w.message).toContain("not yet implemented");
  });

  test("warns when on_violation.create_issue is true", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "test", arguments: {} })];
    const rule = makeRule({
      on_violation: { create_issue: true },
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    expect(result.warnings).toHaveLength(1);
    const w = result.warnings[0];
    expect(w).toBeDefined();
    if (!w) return;
    expect(w.code).toBe("ON_VIOLATION_ISSUE_NOT_IMPLEMENTED");
    expect(w.message).toContain("on_violation.create_issue");
    expect(w.message).toContain("not yet implemented");
  });

  test("warns for both notify and create_issue on same rule", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "test", arguments: {} })];
    const rule = makeRule({
      on_violation: { notify: ["#alerts"], create_issue: true },
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.map((w) => w.code)).toEqual([
      "ON_VIOLATION_NOTIFY_NOT_IMPLEMENTED",
      "ON_VIOLATION_ISSUE_NOT_IMPLEMENTED",
    ]);
  });

  test("no warning when on_violation.notify is empty array", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "test", arguments: {} })];
    const rule = makeRule({
      on_violation: { notify: [] },
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    expect(result.warnings).toEqual([]);
  });

  test("no warning when on_violation.create_issue is false", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "test", arguments: {} })];
    const rule = makeRule({
      on_violation: { create_issue: false },
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    expect(result.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RULE_NEVER_MATCHED diagnostic
// ---------------------------------------------------------------------------

describe("evaluate — RULE_NEVER_MATCHED diagnostic", () => {
  test("emits warning when a rule matches zero in-scope events", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "web_search", arguments: {} })];
    const rule = makeRule({
      id: "deny-shell",
      match: {
        payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }],
      },
      action: "deny",
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    // Verdict unchanged — warnings are additive.
    expect(result.verdict).toBe("pass");
    expect(result.violations).toHaveLength(0);

    const neverMatched = result.warnings.filter((w) => w.code === "RULE_NEVER_MATCHED");
    expect(neverMatched).toHaveLength(1);
    const nm = neverMatched[0];
    expect(nm).toBeDefined();
    if (!nm) return;
    expect(nm.ruleId).toBe("deny-shell");
    expect(nm.message).toContain("deny-shell");
    expect(nm.message).toContain("zero");
  });

  test("does NOT emit warning for a rule that matched at least one event", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "web_search", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "web_search", arguments: {} }),
    ];
    const rule = makeRule({
      id: "allow-search",
      match: {
        payload: [{ field: "tool_name", operator: "eq", value: "web_search" }],
      },
      action: "allow",
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    expect(result.warnings).toEqual([]);
  });

  test("distinguishes never-matched rules from rules whose scope excludes all events", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "web_search", arguments: {} })];
    const rule = makeRule({
      id: "only-llm",
      match: { payload: [] },
      action: "allow",
    });
    const policy = makePolicy({
      rules: [rule],
      // Scope excludes tool_call so the rule cannot fire.
      scope: { agents: ["*"], event_types: ["llm_request"] },
    });

    const result = evaluate(trace, policy);
    const neverMatched = result.warnings.filter((w) => w.code === "RULE_NEVER_MATCHED");
    expect(neverMatched).toHaveLength(1);
    const nm = neverMatched[0];
    expect(nm).toBeDefined();
    if (!nm) return;
    expect(nm.ruleId).toBe("only-llm");
  });

  test("never-matched diagnostic is purely additive — does not change verdict or exit code", () => {
    const trace = [makeEvent(0, "tool_call", { tool_name: "web_search", arguments: {} })];
    const rule = makeRule({
      id: "deny-nonexistent",
      match: {
        payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }],
      },
      action: "deny",
      severity: "critical",
    });
    const policy = makePolicy({ rules: [rule] });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "RULE_NEVER_MATCHED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sequence rules (cross-event patterns)
// ---------------------------------------------------------------------------

describe("evaluate — sequence rules", () => {
  test("sequence rule produces violation when pattern matches", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: { path: "/etc/passwd" } }),
      makeEvent(1, "tool_result", { tool_name: "read_file", duration_ms: 10 }),
      makeEvent(2, "tool_call", { tool_name: "curl", arguments: { url: "https://evil.com" } }),
    ];

    const policy = makePolicy({
      rules: [
        makeRule({
          id: "credential-exfiltration",
          action: "deny",
          severity: "critical",
          message: "Agent read sensitive file then made external request",
          match: {
            payload: [],
            sequence: {
              steps: [
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "matches", value: "read" }],
                },
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "matches", value: "curl|fetch" }],
                },
              ],
            },
          },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("fail");
    expect(result.exitCode).toBe(2); // critical
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.ruleId).toBe("credential-exfiltration");
    expect(result.violations[0]?.eventIndex).toBe(0); // first matched event
  });

  test("sequence rule does not fire when pattern is absent", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} }),
      makeEvent(1, "tool_result", { tool_name: "read_file", duration_ms: 10 }),
    ];

    const policy = makePolicy({
      rules: [
        makeRule({
          id: "exfil-check",
          action: "deny",
          severity: "critical",
          message: "Exfiltration detected",
          match: {
            payload: [],
            sequence: {
              steps: [
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
                },
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
                },
              ],
            },
          },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("pass");
    expect(result.violations).toHaveLength(0);
  });

  test("sequence rule with allow action does not produce violation", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "curl", arguments: {} }),
    ];

    const policy = makePolicy({
      rules: [
        makeRule({
          id: "allowed-pattern",
          action: "allow",
          severity: "info",
          message: "Pattern is allowed",
          match: {
            payload: [],
            sequence: {
              steps: [
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
                },
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
                },
              ],
            },
          },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("pass");
    expect(result.violations).toHaveLength(0);
  });

  test("mixed per-event and sequence rules both fire", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "shell_exec", arguments: { cmd: "rm -rf /" } }),
      makeEvent(1, "tool_call", { tool_name: "read_file", arguments: { path: ".env" } }),
      makeEvent(2, "tool_call", { tool_name: "curl", arguments: {} }),
    ];

    const policy = makePolicy({
      rules: [
        // Per-event rule: deny shell_exec
        makeRule({
          id: "no-shell",
          action: "deny",
          severity: "error",
          message: "No shell",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }],
          },
        }),
        // Sequence rule: read then curl
        makeRule({
          id: "exfil",
          action: "deny",
          severity: "critical",
          message: "Exfiltration",
          match: {
            payload: [],
            sequence: {
              steps: [
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
                },
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
                },
              ],
            },
          },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("fail");
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map((v) => v.ruleId)).toContain("no-shell");
    expect(result.violations.map((v) => v.ruleId)).toContain("exfil");
  });

  test("sequence rule with require-approval action", () => {
    const trace = [
      makeEvent(0, "tool_call", { tool_name: "read_file", arguments: {} }),
      makeEvent(1, "tool_call", { tool_name: "curl", arguments: {} }),
    ];

    const policy = makePolicy({
      rules: [
        makeRule({
          id: "needs-approval",
          action: "require-approval",
          severity: "warning",
          message: "Approval needed for this pattern",
          match: {
            payload: [],
            sequence: {
              steps: [
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
                },
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "curl" }],
                },
              ],
            },
          },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.verdict).toBe("require-approval");
    expect(result.exitCode).toBe(3);
  });

  test("sequence rule violation reports original trace index when scope filters remove events", () => {
    // Trace: 2 out-of-scope events precede the matching pair.
    // Scoped indices (0,1) map to original indices (2,3).
    const trace = [
      makeEvent(0, "lifecycle", { action: "session_start" }), // out of scope (event_type)
      makeEvent(1, "tool_call", { tool_name: "read_file", arguments: {} }, "other-agent"), // out of scope (agent)
      makeEvent(2, "tool_call", { tool_name: "read_file", arguments: {} }), // in scope → scoped[0]
      makeEvent(3, "tool_result", { tool_name: "read_file", output: "x", duration_ms: 0 }), // in scope → scoped[1]
    ];

    const policy = makePolicy({
      scope: { agents: ["test-agent"], event_types: ["tool_call", "tool_result"] },
      rules: [
        makeRule({
          id: "read-then-result",
          action: "deny",
          severity: "error",
          message: "Read followed by result",
          match: {
            payload: [],
            sequence: {
              steps: [
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "read_file" }],
                },
                { event_type: "tool_result", payload: [] },
              ],
            },
          },
        }),
      ],
    });

    const result = evaluate(trace, policy);
    expect(result.violations).toHaveLength(1);
    // violation must reference original trace position, not the filtered position
    expect(result.violations[0]?.eventIndex).toBe(2);
    expect(result.violations[0]?.eventId).toBe("evt-002");
  });
});
