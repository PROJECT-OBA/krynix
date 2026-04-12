import { describe, test, expect } from "vitest";
import { validateTraceEvent, validatePolicy, validateReport } from "./schema-validator.js";
import {
  makeToolCall,
  makeToolResult,
  makeLlmRequest,
  makeLlmResponse,
  makeDecision,
  makeObservation,
  makeError,
  makeLifecycle,
} from "./test-helpers.js";

// ---------------------------------------------------------------------------
// TraceEvent validation
// ---------------------------------------------------------------------------

describe("validateTraceEvent", () => {
  test("valid tool_call event passes", () => {
    const result = validateTraceEvent(makeToolCall(0));
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("valid tool_result event passes", () => {
    const result = validateTraceEvent(makeToolResult(1));
    expect(result.valid).toBe(true);
  });

  test("valid llm_request event passes", () => {
    const result = validateTraceEvent(makeLlmRequest(2));
    expect(result.valid).toBe(true);
  });

  test("valid llm_response event passes", () => {
    const result = validateTraceEvent(makeLlmResponse(3));
    expect(result.valid).toBe(true);
  });

  test("valid decision event passes", () => {
    const result = validateTraceEvent(makeDecision(4));
    expect(result.valid).toBe(true);
  });

  test("valid observation event passes", () => {
    const result = validateTraceEvent(makeObservation(5));
    expect(result.valid).toBe(true);
  });

  test("valid error event passes", () => {
    const result = validateTraceEvent(makeError(6));
    expect(result.valid).toBe(true);
  });

  test("valid lifecycle event passes", () => {
    const result = validateTraceEvent(makeLifecycle(7));
    expect(result.valid).toBe(true);
  });

  test("missing required fields → descriptive error", () => {
    const result = validateTraceEvent({ event_type: "tool_call" });
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("required");
  });

  test("invalid event_type → error", () => {
    const event = { ...makeToolCall(0), event_type: "not_a_type" };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("completely empty object → error", () => {
    const result = validateTraceEvent({});
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("negative sequence_num → error", () => {
    const event = { ...makeToolCall(0), sequence_num: -1 };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Timestamp format validation (ISO 8601 / RFC 3339)
  // ---------------------------------------------------------------------------

  test("valid ISO 8601 timestamp passes", () => {
    const event = { ...makeToolCall(0), timestamp: "2026-03-15T09:30:00.000Z" };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(true);
  });

  test("ISO 8601 with offset rejected (UTC-only required)", () => {
    const event = { ...makeToolCall(0), timestamp: "2026-03-15T09:30:00+05:30" };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(false);
  });

  test("garbage timestamp → error", () => {
    const event = { ...makeToolCall(0), timestamp: "not-a-date" };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("format");
  });

  test("epoch numeric timestamp → error", () => {
    const event = { ...makeToolCall(0), timestamp: "1710000000" };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("format");
  });

  test("date-only timestamp without time → error", () => {
    const event = { ...makeToolCall(0), timestamp: "2026-03-15" };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("format");
  });

  // ---------------------------------------------------------------------------
  // Schema v1.1 optional fields
  // ---------------------------------------------------------------------------

  test("tool_call with approved_by and approval_reason passes", () => {
    const baseEvent = makeToolCall(0, {
      tool_name: "shell_exec",
      arguments: { cmd: "ls" },
      approval_status: "manual",
    });
    const event = {
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        approved_by: "admin@example.com",
        approval_reason: "Trusted command",
      },
    };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(true);
  });

  test("llm_response with total_tokens and estimated_cost passes", () => {
    const baseEvent = makeLlmResponse(0, {
      model: "claude-opus-4-5-20251101",
      content: "Hello",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      finish_reason: "stop",
    });
    const event = {
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        usage: {
          ...baseEvent.payload.usage,
          total_tokens: 150,
          estimated_cost: 0.0045,
        },
      },
    };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(true);
  });

  test("llm_response with is_streaming passes", () => {
    const baseEvent = makeLlmResponse(0);
    const event = {
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        is_streaming: true,
      },
    };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(true);
  });

  test("llm_response with negative usage values rejected", () => {
    const baseEvent = makeLlmResponse(0);
    const event = {
      ...baseEvent,
      payload: {
        ...baseEvent.payload,
        usage: {
          prompt_tokens: -1,
          completion_tokens: -1,
          total_tokens: -1,
          estimated_cost: -0.001,
        },
      },
    };
    const result = validateTraceEvent(event);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Policy validation
// ---------------------------------------------------------------------------

const VALID_POLICY = {
  apiVersion: "krynix.dev/v1",
  kind: "Policy",
  metadata: {
    name: "test-policy",
    version: "1.0.0",
    description: "A test policy",
  },
  spec: {
    scope: {
      agents: ["*"],
      event_types: ["tool_call"],
    },
    rules: [
      {
        id: "deny-rm",
        description: "Deny rm commands",
        match: {
          payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }],
        },
        action: "deny",
        severity: "critical",
        message: "Disallowed tool",
      },
    ],
  },
};

describe("validatePolicy", () => {
  test("valid policy passes", () => {
    const result = validatePolicy(VALID_POLICY);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("missing metadata.name → error", () => {
    const policy = {
      ...VALID_POLICY,
      metadata: { version: "1.0.0", description: "test" },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("name");
  });

  test("invalid apiVersion → error", () => {
    const policy = { ...VALID_POLICY, apiVersion: "wrong/v2" };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("missing spec → error", () => {
    const { spec: _, ...policy } = VALID_POLICY;
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  test("invalid rule action → error", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            ...VALID_POLICY.spec.rules[0],
            action: "nuke",
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("valid policy with all optional fields passes", () => {
    const policy = {
      ...VALID_POLICY,
      metadata: {
        ...VALID_POLICY.metadata,
        labels: { team: "security", env: "prod" },
        extends: "base-policy",
      },
      spec: {
        ...VALID_POLICY.spec,
        defaults: {
          unmatched_action: "allow",
          unmatched_severity: "info",
        },
        rules: [
          {
            ...VALID_POLICY.spec.rules[0],
            match: {
              event_type: "tool_call",
              payload: [{ field: "tool_name", operator: "eq", value: "shell_exec" }],
            },
            ci_failure: true,
            on_violation: {
              notify: ["security@example.com"],
              create_issue: true,
            },
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("match with neither payload nor sequence → error", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            ...VALID_POLICY.spec.rules[0],
            match: { event_type: "tool_call" }, // no payload, no sequence
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("valid sequence rule passes", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            id: "sequence-rule",
            description: "A sequence rule",
            match: {
              payload: [],
              sequence: {
                steps: [
                  {
                    event_type: "tool_call",
                    payload: [{ field: "tool_name", operator: "eq", value: "read" }],
                  },
                  { event_type: "tool_result", payload: [] },
                ],
              },
            },
            action: "deny",
            severity: "error",
            message: "Sequence detected",
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(true);
  });

  test("sequence rule without top-level payload passes (matches parser behaviour)", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            id: "sequence-no-payload",
            description: "Sequence rule omitting payload",
            match: {
              // No top-level payload — parser defaults it to []
              sequence: {
                steps: [
                  {
                    event_type: "tool_call",
                    payload: [{ field: "tool_name", operator: "eq", value: "read" }],
                  },
                  { event_type: "tool_result", payload: [] },
                ],
              },
            },
            action: "deny",
            severity: "error",
            message: "Sequence without payload field",
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(true);
  });

  test("sequence rule with malformed step (missing payload) → error", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            id: "bad-seq",
            description: "Bad sequence",
            match: {
              payload: [],
              sequence: {
                steps: [
                  { event_type: "tool_call" }, // missing required payload
                  { event_type: "tool_result", payload: [] },
                ],
              },
            },
            action: "deny",
            severity: "error",
            message: "Bad",
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("sequence rule with only 1 step (minItems: 2) → error", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            id: "short-seq",
            description: "Too short",
            match: {
              payload: [],
              sequence: {
                steps: [{ event_type: "tool_call", payload: [] }],
              },
            },
            action: "deny",
            severity: "error",
            message: "Bad",
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("sequence rule with non-empty payload on match → error (schema enforces maxItems: 0)", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            id: "bad-seq-payload",
            description: "Sequence with non-empty payload",
            match: {
              payload: [{ field: "tool_name", operator: "eq", value: "read" }],
              sequence: {
                steps: [
                  { event_type: "tool_call", payload: [] },
                  { event_type: "tool_result", payload: [] },
                ],
              },
            },
            action: "deny",
            severity: "error",
            message: "Bad",
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("sequence rule with event_type on match → error (schema disallows event_type when sequence present)", () => {
    const policy = {
      ...VALID_POLICY,
      spec: {
        ...VALID_POLICY.spec,
        rules: [
          {
            id: "bad-seq-event-type",
            description: "Sequence with event_type on match",
            match: {
              event_type: "tool_call",
              payload: [],
              sequence: {
                steps: [
                  { event_type: "tool_call", payload: [] },
                  { event_type: "tool_result", payload: [] },
                ],
              },
            },
            action: "deny",
            severity: "error",
            message: "Bad",
          },
        ],
      },
    };
    const result = validatePolicy(policy);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Report (EvaluationResult) validation
// ---------------------------------------------------------------------------

const VALID_REPORT = {
  verdict: "pass",
  exitCode: 0,
  violations: [],
};

describe("validateReport", () => {
  test("valid pass report passes", () => {
    const result = validateReport(VALID_REPORT);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("valid fail report with violations passes", () => {
    const report = {
      verdict: "fail",
      exitCode: 1,
      violations: [
        {
          ruleId: "deny-rm",
          eventIndex: 2,
          eventId: "evt-002",
          action: "deny",
          severity: "error",
          message: "Tool not allowed",
          ciFailure: true,
        },
      ],
    };
    const result = validateReport(report);
    expect(result.valid).toBe(true);
  });

  test("invalid verdict → error", () => {
    const report = { ...VALID_REPORT, verdict: "maybe" };
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("invalid exitCode → error", () => {
    const report = { ...VALID_REPORT, exitCode: 99 };
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("missing violations → error", () => {
    const { violations: _, ...report } = VALID_REPORT;
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  test("violation missing required field → error", () => {
    const report = {
      verdict: "fail",
      exitCode: 1,
      violations: [
        {
          ruleId: "deny-rm",
          // missing eventIndex, eventId, action, severity, message, ciFailure
        },
      ],
    };
    const result = validateReport(report);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("valid report with structured PolicyWarning[] passes", () => {
    const report = {
      verdict: "pass",
      exitCode: 0,
      violations: [],
      warnings: [
        {
          code: "RULE_NEVER_MATCHED",
          ruleId: "deny-shell",
          message: "Rule 'deny-shell' matched zero in-scope events.",
        },
        {
          code: "ON_VIOLATION_NOTIFY_NOT_IMPLEMENTED",
          message: "Notification delivery is not yet implemented.",
        },
      ],
    };
    const result = validateReport(report);
    expect(result.valid).toBe(true);
  });

  test("report with string warnings (old shape) is rejected", () => {
    const report = {
      verdict: "pass",
      exitCode: 0,
      violations: [],
      warnings: ["some old string warning"],
    };
    const result = validateReport(report);
    expect(result.valid).toBe(false);
  });
});
