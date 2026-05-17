/**
 * Tests for `matchSingleEvent()` — the runtime-eval path used by
 * `@krynix/sdk`. Distinguished from the trace-eval path in
 * `evaluator.test.ts` by the fact that it takes a single in-flight
 * event and returns a single verdict (no violations list).
 */

import { describe, test, expect } from "vitest";
import { matchSingleEvent, type SingleEventResult } from "./evaluator.js";
import type { Policy, PolicyDefaults, PolicyRule, PolicyScope, Redaction } from "./schema.js";
import { SCHEMA_VERSION, type TraceEvent } from "@krynix/core";

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
  // Pinned to the version `@krynix/core` actually exports today so the
  // fixtures stay valid relative to the current schema; updating the
  // core constant flows through here automatically via the import.
  schema_version: SCHEMA_VERSION,
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
    action: "allow",
    severity: "info",
    message: "Test message",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("matchSingleEvent — verdicts", () => {
  test("pass when no rules match and no default-deny", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "web_search" });
    const policy = makePolicy({ rules: [] });

    const result: SingleEventResult = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("pass");
    expect(result.ruleId).toBeUndefined();
  });

  test("pass when first matching rule has action allow", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "web_search" });
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "allow-search",
          action: "allow",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "eq", value: "web_search" }],
          },
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("pass");
    expect(result.ruleId).toBe("allow-search");
    expect(result.severity).toBe("info");
  });

  test("fail when first matching rule has action deny", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "delete_users" });
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "deny-destructive",
          action: "deny",
          severity: "critical",
          message: "destructive tool call denied",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "matches", value: "^delete_" }],
          },
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("fail");
    expect(result.ruleId).toBe("deny-destructive");
    expect(result.severity).toBe("critical");
    expect(result.message).toBe("destructive tool call denied");
  });

  test("redact verdict surfaces redactions[] from the matched rule", () => {
    const event = makeEvent(0, "llm_request", { messages: [{ content: "email: a@b.com" }] });
    const redactions: Redaction[] = [
      { path: "messages[*].content", pattern: "[^\\s]+@[^\\s]+", replacement: "<EMAIL>" },
    ];
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "redact-email",
          action: "redact",
          severity: "info",
          message: "email scrubbed",
          match: { event_type: "llm_request", payload: [] },
          redactions,
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("redact");
    expect(result.ruleId).toBe("redact-email");
    expect(result.redactions).toEqual(redactions);
  });

  test("redact returns an empty redactions[] when the rule omits them (defensive)", () => {
    // The parser guarantees redactions is non-empty for redact rules, but
    // `matchSingleEvent` is called on rules constructed in code too.
    const event = makeEvent(0, "llm_request", { messages: [] });
    const rule: PolicyRule = {
      id: "redact-no-config",
      description: "",
      match: { event_type: "llm_request", payload: [] },
      action: "redact",
      severity: "info",
      message: "",
    };
    const policy = makePolicy({ rules: [rule] });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("redact");
    expect(result.redactions).toEqual([]);
  });

  test("require-approval surfaces on_timeout when set", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "transfer_funds", amount: 50000 });
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "approve-large-transfer",
          action: "require-approval",
          severity: "warning",
          message: "large transfer requires approval",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "eq", value: "transfer_funds" }],
          },
          on_timeout: "deny",
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("require-approval");
    expect(result.ruleId).toBe("approve-large-transfer");
    expect(result.onTimeout).toBe("deny");
  });

  test("require-approval onTimeout is undefined when the rule omits it", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "transfer_funds" });
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "approve-no-timeout",
          action: "require-approval",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "eq", value: "transfer_funds" }],
          },
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("require-approval");
    expect(result.onTimeout).toBeUndefined();
  });
});

describe("matchSingleEvent — first-match-wins", () => {
  test("returns the first matching rule even if a later rule also matches", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "delete_users" });
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "first-match",
          action: "require-approval",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "matches", value: "^delete_" }],
          },
        }),
        makeRule({
          id: "second-match",
          action: "deny",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "eq", value: "delete_users" }],
          },
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("require-approval");
    expect(result.ruleId).toBe("first-match");
  });
});

describe("matchSingleEvent — scope", () => {
  test("out-of-scope events pass without any rule check", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "delete_users" }, "other-agent");
    const policy = makePolicy({
      scope: { agents: ["my-agent"], event_types: ["*"] },
      rules: [
        makeRule({
          id: "would-match-but-out-of-scope",
          action: "deny",
          match: {
            event_type: "tool_call",
            payload: [{ field: "tool_name", operator: "matches", value: "^delete_" }],
          },
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("pass");
    expect(result.ruleId).toBeUndefined();
  });

  test("event_type scope filters before rule evaluation", () => {
    const event = makeEvent(0, "decision", { action: "delete_users" });
    const policy = makePolicy({
      scope: { agents: ["*"], event_types: ["tool_call"] },
      rules: [
        makeRule({
          id: "would-match",
          action: "deny",
          match: {
            payload: [{ field: "action", operator: "eq", value: "delete_users" }],
          },
        }),
      ],
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("pass");
  });
});

describe("matchSingleEvent — defaults", () => {
  test("unmatched in-scope events with unmatched_action='deny' return fail", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "anything" });
    const policy = makePolicy({
      rules: [],
      defaults: { unmatched_action: "deny", unmatched_severity: "warning" },
    });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("fail");
    expect(result.ruleId).toBe("__default_deny__");
    expect(result.severity).toBe("warning");
  });

  test("unmatched in-scope events with unmatched_action absent return pass", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "anything" });
    const policy = makePolicy({ rules: [] });

    const result = matchSingleEvent(event, policy);

    expect(result.verdict).toBe("pass");
  });
});

describe("matchSingleEvent — sequence rules are skipped", () => {
  test("a sequence rule never fires from matchSingleEvent (needs cross-event context)", () => {
    const event = makeEvent(0, "tool_call", { tool_name: "delete_users" });
    const policy = makePolicy({
      rules: [
        {
          id: "seq-rule",
          description: "",
          match: {
            payload: [],
            sequence: {
              steps: [
                {
                  event_type: "tool_call",
                  payload: [{ field: "tool_name", operator: "eq", value: "delete_users" }],
                },
              ],
            },
          },
          action: "deny",
          severity: "error",
          message: "seq match",
        },
      ],
    });

    const result = matchSingleEvent(event, policy);

    // Sequence rule is skipped → pass. Per-event rules behind it would
    // still fire; this test deliberately uses a sequence-only policy to
    // assert the skip.
    expect(result.verdict).toBe("pass");
  });
});

describe("evaluate — redact action treated as advisory at trace time", () => {
  // Cross-check: the trace-eval path (evaluator.evaluate) must NOT produce
  // a violation for a matching redact rule. The runtime SDK is the only
  // consumer that acts on redact verdicts.
  test("a redact rule on a trace produces no violation", async () => {
    const { evaluate } = await import("./evaluator.js");

    const trace = [makeEvent(0, "llm_request", { messages: [{ content: "email: a@b.com" }] })];
    const policy = makePolicy({
      rules: [
        makeRule({
          id: "redact-email",
          action: "redact",
          severity: "info",
          match: { event_type: "llm_request", payload: [] },
          redactions: [{ path: "messages[*].content" }],
        }),
      ],
    });

    const result = evaluate(trace, policy);

    expect(result.verdict).toBe("pass");
    expect(result.violations).toEqual([]);
  });
});
