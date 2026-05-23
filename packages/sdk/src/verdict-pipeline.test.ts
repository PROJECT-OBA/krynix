import { describe, test, expect } from "vitest";
import { SCHEMA_VERSION, type TraceEvent } from "@krynix/core";
import type { Policy, PolicyRule, Redaction } from "@krynix/policy";
import { runPipeline } from "./verdict-pipeline.js";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeEvent(eventType: string, payload: Record<string, unknown>): TraceEvent {
  // Cast through unknown — TraceEvent is a discriminated union and TS
  // refuses to narrow `payload` from a generic record. These factories
  // exist for evaluator/pipeline tests that don't care about
  // event-type-specific payload shape.
  return {
    event_id: "evt-000",
    session_id: "sess-1",
    sequence_num: 0,
    timestamp: "2026-05-16T00:00:00.000Z",
    parent_id: null,
    agent_id: "test-agent",
    event_type: eventType,
    payload,
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION,
  } as unknown as TraceEvent;
}

function makePolicy(rules: PolicyRule[]): Policy {
  return {
    apiVersion: "krynix.dev/v1",
    kind: "Policy",
    metadata: { name: "test", version: "1.0.0", description: "test" },
    spec: {
      scope: { agents: ["*"], event_types: ["*"] },
      rules,
    },
  };
}

function rule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "r1",
    description: "",
    match: { payload: [] },
    action: "allow",
    severity: "info",
    message: "test",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPipeline — pass", () => {
  test("no rules matched → forward unchanged with no rule_id", () => {
    const event = makeEvent("llm_request", { messages: [{ content: "hi" }] });
    const policy = makePolicy([]);
    const body = { messages: [{ content: "hi" }] };

    const outcome = runPipeline(event, body, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("pass");
      expect(outcome.body).toBe(body); // same reference — pure pass-through
      expect(outcome.appliedRedactions).toEqual([]);
      expect(outcome.ruleId).toBeUndefined();
    }
  });

  test("allow rule matched → forward unchanged with rule_id recorded", () => {
    const event = makeEvent("tool_call", { tool_name: "web_search" });
    const policy = makePolicy([
      rule({
        id: "allow-search",
        action: "allow",
        match: {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "web_search" }],
        },
      }),
    ]);
    const body = { tool_name: "web_search" };

    const outcome = runPipeline(event, body, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("pass");
      expect(outcome.ruleId).toBe("allow-search");
      expect(outcome.body).toBe(body);
    }
  });
});

describe("runPipeline — redact", () => {
  test("redact verdict applies redactions to a deep-cloned body", () => {
    const event = makeEvent("llm_request", {
      messages: [{ content: "email: alice@example.com" }],
    });
    const redactions: Redaction[] = [
      { path: "messages[*].content", pattern: "[^\\s]+@[^\\s]+", replacement: "<EMAIL>" },
    ];
    const policy = makePolicy([
      rule({
        id: "redact-email",
        action: "redact",
        match: { event_type: "llm_request", payload: [] },
        redactions,
      }),
    ]);
    const body = { messages: [{ content: "email: alice@example.com" }] };

    const outcome = runPipeline(event, body, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("redact");
      expect(outcome.ruleId).toBe("redact-email");
      // Body was deep-cloned + redacted; original is untouched.
      expect(outcome.body).not.toBe(body);
      const cloned = outcome.body as { messages: { content: string }[] };
      expect(cloned.messages[0]?.content).toBe("email: <EMAIL>");
      expect(body.messages[0]?.content).toBe("email: alice@example.com");
      // Audit trail recorded.
      expect(outcome.appliedRedactions).toEqual([
        { path: "messages[*].content", value_redacted: "<EMAIL>" },
      ]);
    }
  });

  test("redact rule with empty redactions[] is downgraded to pass (no audit-trail entries to emit)", () => {
    // `@krynix/core`'s schema requires `policy_decision.redactions: minItems 1`
    // when `verdict === "redact"`. A rule declared `action: redact` with
    // no `redactions[]` directives, or one whose directives didn't change
    // anything, must downgrade to a `pass` verdict — otherwise the
    // adapter would emit a schema-invalid `policy_decision` event.
    const event = makeEvent("llm_request", { messages: [] });
    const policy = makePolicy([
      {
        id: "bare-redact",
        description: "",
        match: { event_type: "llm_request", payload: [] },
        action: "redact",
        severity: "info",
        message: "",
      },
    ]);
    const body = { messages: [{ content: "untouched" }] };

    const outcome = runPipeline(event, body, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      // Downgrade: empty `applied` → verdict pass, rule_id preserved.
      expect(outcome.verdict).toBe("pass");
      expect(outcome.appliedRedactions).toEqual([]);
      expect(outcome.ruleId).toBe("bare-redact");
      // Original body forwarded by reference — no point deep-cloning
      // when nothing changed.
      expect(outcome.body).toBe(body);
    }
  });

  test("redact rule whose regex doesn't match anything is downgraded to pass", () => {
    // Same schema-validity argument as the empty-redactions[] case: a
    // rule that matched but produced no changes must not claim
    // `verdict: "redact"` on the wire.
    const event = makeEvent("llm_request", { messages: [{ content: "no email here" }] });
    const policy = makePolicy([
      rule({
        id: "redact-email",
        action: "redact",
        match: { event_type: "llm_request", payload: [] },
        redactions: [
          { path: "messages[*].content", pattern: "[^\\s]+@[^\\s]+", replacement: "<EMAIL>" },
        ],
      }),
    ]);
    const body = { messages: [{ content: "no email here" }] };

    const outcome = runPipeline(event, body, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("pass");
      expect(outcome.appliedRedactions).toEqual([]);
      expect(outcome.ruleId).toBe("redact-email");
      expect(outcome.body).toBe(body);
    }
  });

  test("redactionMode 'off' downgrades a matching redact rule to pass (no body mutation)", () => {
    // The caller asked us not to mutate request bodies. Even if the
    // rule would have changed something, the pipeline must forward
    // the original body unchanged.
    const event = makeEvent("llm_request", {
      messages: [{ content: "email: alice@example.com" }],
    });
    const policy = makePolicy([
      rule({
        id: "redact-email",
        action: "redact",
        match: { event_type: "llm_request", payload: [] },
        redactions: [
          { path: "messages[*].content", pattern: "[^\\s]+@[^\\s]+", replacement: "<EMAIL>" },
        ],
      }),
    ]);
    const body = { messages: [{ content: "email: alice@example.com" }] };

    const outcome = runPipeline(event, body, policy, "off");

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("pass");
      expect(outcome.body).toBe(body); // identity — no deep-clone, no mutation
      expect(outcome.appliedRedactions).toEqual([]);
      expect(outcome.ruleId).toBe("redact-email");
    }
  });
});

describe("runPipeline — deny", () => {
  test("deny rule matched → action: deny with rule_id + message", () => {
    const event = makeEvent("tool_call", { tool_name: "delete_users" });
    const policy = makePolicy([
      rule({
        id: "deny-destructive",
        action: "deny",
        severity: "critical",
        message: "destructive tool calls blocked",
        match: {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "matches", value: "^delete_" }],
        },
      }),
    ]);

    const outcome = runPipeline(event, { tool_name: "delete_users" }, policy);

    expect(outcome.action).toBe("deny");
    if (outcome.action === "deny") {
      expect(outcome.verdict).toBe("fail");
      expect(outcome.ruleId).toBe("deny-destructive");
      expect(outcome.message).toBe("destructive tool calls blocked");
    }
  });
});

describe("runPipeline — require-approval", () => {
  test("require-approval surfaces on_timeout", () => {
    const event = makeEvent("tool_call", { tool_name: "transfer_funds" });
    const policy = makePolicy([
      rule({
        id: "approve-transfer",
        action: "require-approval",
        severity: "warning",
        message: "needs approval",
        match: {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "transfer_funds" }],
        },
        on_timeout: "deny",
      }),
    ]);

    const outcome = runPipeline(event, { tool_name: "transfer_funds" }, policy);

    expect(outcome.action).toBe("require-approval");
    if (outcome.action === "require-approval") {
      expect(outcome.ruleId).toBe("approve-transfer");
      expect(outcome.message).toBe("needs approval");
      expect(outcome.onTimeout).toBe("deny");
    }
  });

  test("require-approval with no on_timeout → onTimeout is undefined (caller applies SDK default)", () => {
    const event = makeEvent("tool_call", { tool_name: "transfer_funds" });
    const policy = makePolicy([
      rule({
        id: "approve-transfer",
        action: "require-approval",
        match: {
          event_type: "tool_call",
          payload: [{ field: "tool_name", operator: "eq", value: "transfer_funds" }],
        },
      }),
    ]);

    const outcome = runPipeline(event, { tool_name: "transfer_funds" }, policy);

    expect(outcome.action).toBe("require-approval");
    if (outcome.action === "require-approval") {
      expect(outcome.onTimeout).toBeUndefined();
    }
  });
});

describe("runPipeline — redaction-no-op warnings (krynix#56)", () => {
  test("redactionMode='off' surfaces a 'redaction_mode_off' warning", () => {
    const event = makeEvent("llm_request", { user_content: "anything" });
    const redactions: Redaction[] = [{ path: "messages[0].content", replacement: "<X>" }];
    const policy = makePolicy([
      rule({
        id: "r-redact",
        action: "redact",
        match: { payload: [{ field: "user_content", operator: "exists", value: true }] },
        redactions,
      }),
    ]);

    const outcome = runPipeline(event, { messages: [{ content: "hi" }] }, policy, "off");

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("pass");
      expect(outcome.appliedRedactions).toEqual([]);
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings?.[0]).toMatchObject({
        kind: "redaction_no_op",
        reason: "redaction_mode_off",
        ruleId: "r-redact",
        paths: ["messages[0].content"],
      });
    }
  });

  test("rule with no redactions[] directives surfaces a 'no_directives' warning", () => {
    const event = makeEvent("llm_request", { user_content: "anything" });
    const policy = makePolicy([
      rule({
        id: "r-empty",
        action: "redact",
        match: { payload: [{ field: "user_content", operator: "exists", value: true }] },
        // No redactions[] field — policy parser would normally reject this,
        // but adapters can call runPipeline with hand-built policies.
      }),
    ]);

    const outcome = runPipeline(event, { foo: "bar" }, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("pass");
      expect(outcome.warnings?.[0]?.kind).toBe("redaction_no_op");
      expect(outcome.warnings?.[0]?.reason).toBe("no_directives");
    }
  });

  test("redact rule whose directives apply zero changes surfaces 'path_or_pattern_no_match'", () => {
    // The pre-alpha.2 silent-failure mode: rule fires, applyRedactions runs,
    // but the path doesn't resolve OR the regex doesn't match. Verdict
    // legitimately downgrades to pass (the body must not lie about being
    // redacted when nothing changed) but now carries a warning the caller
    // can surface.
    const event = makeEvent("llm_request", { user_content: "anything" });
    const redactions: Redaction[] = [
      { path: "nonexistent.path", pattern: ".+", replacement: "<X>" },
    ];
    const policy = makePolicy([
      rule({
        id: "r-bad-path",
        action: "redact",
        match: { payload: [{ field: "user_content", operator: "exists", value: true }] },
        redactions,
      }),
    ]);

    const outcome = runPipeline(event, { messages: [{ content: "hi" }] }, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("pass");
      expect(outcome.appliedRedactions).toEqual([]);
      expect(outcome.warnings).toHaveLength(1);
      expect(outcome.warnings?.[0]).toMatchObject({
        kind: "redaction_no_op",
        reason: "path_or_pattern_no_match",
        ruleId: "r-bad-path",
        paths: ["nonexistent.path"],
      });
    }
  });

  test("successful redaction does NOT emit a warning", () => {
    // Pre-condition for the test: this is the case the alpha.2 bracket-
    // index fix specifically enables. Same body, same path, same regex —
    // alpha.1 silently no-op'd; alpha.2 applies the redaction successfully.
    const event = makeEvent("llm_request", { user_content: "anything" });
    const redactions: Redaction[] = [
      { path: "messages[0].content", pattern: "[^\\s]+@[^\\s]+", replacement: "<EMAIL>" },
    ];
    const policy = makePolicy([
      rule({
        id: "r-redact-email",
        action: "redact",
        match: { payload: [{ field: "user_content", operator: "exists", value: true }] },
        redactions,
      }),
    ]);

    const outcome = runPipeline(event, { messages: [{ content: "email me at a@b.com" }] }, policy);

    expect(outcome.action).toBe("forward");
    if (outcome.action === "forward") {
      expect(outcome.verdict).toBe("redact");
      expect(outcome.appliedRedactions).toHaveLength(1);
      expect(outcome.warnings).toBeUndefined();
      const body = outcome.body as { messages: { content: string }[] };
      expect(body.messages[0]?.content).toBe("email me at <EMAIL>");
    }
  });
});
