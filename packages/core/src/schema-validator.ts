/**
 * JSON Schema validation for TraceEvents, Policies, and Evaluation Reports.
 *
 * Uses Ajv v8 with JSON Schema draft-07. Schemas are inlined as constants
 * so validation works regardless of how the package is consumed.
 *
 * @module
 */

import Ajv, { type ErrorObject } from "ajv";
import type { ValidationResult } from "./types.js";

// ---------------------------------------------------------------------------
// Inlined schemas (source of truth: spec/*.schema.json)
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  event_id: { type: "string" },
  session_id: { type: "string" },
  sequence_num: { type: "integer", minimum: 0 },
  timestamp: { type: "string" },
  parent_id: { type: ["string", "null"] },
  agent_id: { type: "string" },
  redacted: { type: "boolean" },
  prev_hash: { type: "string" },
  event_hash: { type: "string" },
  metadata: { type: ["object", "null"] },
  schema_version: { type: "string" },
} as const;

const BASE_REQUIRED = [
  "event_id",
  "session_id",
  "sequence_num",
  "timestamp",
  "event_type",
  "parent_id",
  "agent_id",
  "payload",
  "redacted",
  "prev_hash",
  "event_hash",
  "metadata",
  "schema_version",
] as const;

function eventVariant(eventTypeConst: string, payloadSchema: Record<string, unknown>) {
  return {
    properties: {
      ...BASE_PROPS,
      event_type: { const: eventTypeConst },
      payload: payloadSchema,
    },
    required: BASE_REQUIRED,
    additionalProperties: false,
  };
}

const TRACE_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://krynix.dev/schemas/trace.schema.json",
  title: "TraceEvent",
  description:
    "A single TraceEvent in the Krynix ARTL trace format. Discriminated union on event_type.",
  type: "object",
  oneOf: [
    eventVariant("tool_call", {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        arguments: { type: "object" },
        approval_status: { type: "string", enum: ["auto", "manual", "denied"] },
      },
      required: ["tool_name", "arguments"],
      additionalProperties: false,
    }),
    eventVariant("tool_result", {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        output: {},
        exit_code: { type: "integer" },
        duration_ms: { type: "number" },
      },
      required: ["tool_name", "output", "duration_ms"],
      additionalProperties: false,
    }),
    eventVariant("llm_request", {
      type: "object",
      properties: {
        model: { type: "string" },
        messages: { type: "array" },
        parameters: { type: "object" },
      },
      required: ["model", "messages", "parameters"],
      additionalProperties: false,
    }),
    eventVariant("llm_response", {
      type: "object",
      properties: {
        model: { type: "string" },
        content: { type: "string" },
        usage: {
          type: "object",
          properties: {
            prompt_tokens: { type: "integer" },
            completion_tokens: { type: "integer" },
          },
          required: ["prompt_tokens", "completion_tokens"],
          additionalProperties: false,
        },
        finish_reason: { type: "string", enum: ["stop", "max_tokens", "tool_use"] },
      },
      required: ["model", "content", "usage", "finish_reason"],
      additionalProperties: false,
    }),
    eventVariant("decision", {
      type: "object",
      properties: {
        action: { type: "string" },
        reasoning: { type: "string" },
        confidence: { type: "number" },
      },
      required: ["action", "reasoning"],
      additionalProperties: false,
    }),
    eventVariant("observation", {
      type: "object",
      properties: {
        source: { type: "string" },
        content: {},
      },
      required: ["source", "content"],
      additionalProperties: false,
    }),
    eventVariant("error", {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        recoverable: { type: "boolean" },
      },
      required: ["code", "message", "recoverable"],
      additionalProperties: false,
    }),
    eventVariant("lifecycle", {
      type: "object",
      properties: {
        action: { type: "string", enum: ["session_start", "session_end", "checkpoint"] },
        context: { type: "object" },
      },
      required: ["action"],
      additionalProperties: false,
    }),
  ],
};

const POLICY_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://krynix.dev/schemas/policy.schema.json",
  title: "Policy",
  description: "A Krynix ARTL policy document conforming to apiVersion krynix.dev/v1.",
  type: "object",
  properties: {
    apiVersion: { type: "string", const: "krynix.dev/v1" },
    kind: { type: "string", const: "Policy" },
    metadata: {
      type: "object",
      properties: {
        name: { type: "string" },
        version: { type: "string" },
        description: { type: "string" },
        labels: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["name", "version", "description"],
      additionalProperties: false,
    },
    spec: {
      type: "object",
      properties: {
        scope: {
          type: "object",
          properties: {
            agents: { type: "array", items: { type: "string" } },
            event_types: { type: "array", items: { type: "string" } },
          },
          required: ["agents", "event_types"],
          additionalProperties: false,
        },
        rules: { type: "array", items: { $ref: "#/definitions/PolicyRule" } },
        defaults: {
          type: "object",
          properties: {
            unmatched_action: { type: "string", enum: ["allow", "deny"] },
            unmatched_severity: { type: "string", enum: ["info", "warning"] },
          },
          additionalProperties: false,
        },
      },
      required: ["scope", "rules"],
      additionalProperties: false,
    },
  },
  required: ["apiVersion", "kind", "metadata", "spec"],
  additionalProperties: false,
  definitions: {
    PolicyRule: {
      type: "object",
      properties: {
        id: { type: "string" },
        description: { type: "string" },
        match: {
          type: "object",
          properties: {
            event_type: { type: "string" },
            payload: { type: "array", items: { $ref: "#/definitions/PayloadCondition" } },
          },
          required: ["payload"],
          additionalProperties: false,
        },
        action: { type: "string", enum: ["allow", "deny", "require-approval"] },
        severity: { type: "string", enum: ["info", "warning", "error", "critical"] },
        ci_failure: { type: "boolean" },
        message: { type: "string" },
        on_violation: {
          type: "object",
          properties: {
            notify: { type: "array", items: { type: "string" } },
            create_issue: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      required: ["id", "description", "match", "action", "severity", "message"],
      additionalProperties: false,
    },
    PayloadCondition: {
      type: "object",
      properties: {
        field: { type: "string" },
        operator: {
          type: "string",
          enum: ["eq", "neq", "in", "not_in", "matches", "contains", "exists"],
        },
        value: {},
      },
      required: ["field", "operator", "value"],
      additionalProperties: false,
    },
  },
};

const REPORT_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://krynix.dev/schemas/report.schema.json",
  title: "EvaluationResult",
  description: "The output of evaluating a trace against a Krynix ARTL policy.",
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["pass", "fail", "require-approval"] },
    exitCode: { type: "integer", enum: [0, 1, 2, 3] },
    violations: { type: "array", items: { $ref: "#/definitions/Violation" } },
  },
  required: ["verdict", "exitCode", "violations"],
  additionalProperties: false,
  definitions: {
    Violation: {
      type: "object",
      properties: {
        ruleId: { type: "string" },
        eventIndex: { type: "integer" },
        eventId: { type: "string" },
        action: { type: "string" },
        severity: { type: "string", enum: ["info", "warning", "error", "critical"] },
        message: { type: "string" },
        ciFailure: { type: "boolean" },
      },
      required: ["ruleId", "eventIndex", "eventId", "action", "severity", "message", "ciFailure"],
      additionalProperties: false,
    },
  },
};

// ---------------------------------------------------------------------------
// Error formatting
// ---------------------------------------------------------------------------

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "";
  return errors
    .map((e) => {
      const path = e.instancePath || "/";
      const msg = e.message ?? "unknown error";
      if (e.params && "allowedValues" in e.params) {
        const vals = (e.params as { allowedValues: unknown[] }).allowedValues;
        return `${path}: ${msg} (allowed: ${JSON.stringify(vals)})`;
      }
      return `${path}: ${msg}`;
    })
    .join("; ");
}

// ---------------------------------------------------------------------------
// Lazy-compiled validators
// ---------------------------------------------------------------------------

type ValidateFn = ReturnType<Ajv["compile"]>;

function lazyCompile(schema: Record<string, unknown>): () => ValidateFn {
  let validate: ValidateFn | null = null;
  return () => {
    if (!validate) {
      const ajv = new Ajv({ allErrors: true, verbose: true });
      validate = ajv.compile(schema);
    }
    return validate;
  };
}

const getTraceValidator = lazyCompile(TRACE_SCHEMA);
const getPolicyValidator = lazyCompile(POLICY_SCHEMA);
const getReportValidator = lazyCompile(REPORT_SCHEMA);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function runValidation(getValidate: () => ValidateFn, data: unknown): ValidationResult {
  const validate = getValidate();
  const valid = validate(data);
  if (valid) return { valid: true };
  return { valid: false, error: formatErrors(validate.errors) };
}

/** Validate an unknown value against the TraceEvent JSON schema. */
export function validateTraceEvent(event: unknown): ValidationResult {
  return runValidation(getTraceValidator, event);
}

/** Validate an unknown value against the Policy JSON schema. */
export function validatePolicy(policy: unknown): ValidationResult {
  return runValidation(getPolicyValidator, policy);
}

/** Validate an unknown value against the EvaluationResult (report) JSON schema. */
export function validateReport(report: unknown): ValidationResult {
  return runValidation(getReportValidator, report);
}
