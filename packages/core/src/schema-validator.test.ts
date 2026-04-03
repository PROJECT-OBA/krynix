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
});
