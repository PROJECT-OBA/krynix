/**
 * Lightweight runtime payload validation for TraceEvents.
 *
 * Checks that a payload has the required fields for its declared event_type.
 * This is NOT full JSON Schema validation — just structural checks to catch
 * mismatched payloads (e.g., tool_call event with an llm_response payload).
 *
 * @module
 */

import type { EventType } from "./types.js";
import { KrynixError } from "./errors.js";

/**
 * Required field definitions per event type.
 * Each entry is [fieldName, expectedType].
 */
const REQUIRED_FIELDS: Record<EventType, Array<[string, string]>> = {
  tool_call: [
    ["tool_name", "string"],
    ["arguments", "object"],
  ],
  tool_result: [
    ["tool_name", "string"],
    ["output", "any"],
    ["duration_ms", "number"],
  ],
  llm_request: [
    ["model", "string"],
    ["messages", "array"],
    ["parameters", "object"],
  ],
  llm_response: [
    ["model", "string"],
    ["content", "string"],
    ["usage", "object"],
    ["finish_reason", "string"],
  ],
  decision: [
    ["action", "string"],
    ["reasoning", "string"],
  ],
  observation: [
    ["source", "string"],
    ["content", "any"],
  ],
  error: [
    ["code", "string"],
    ["message", "string"],
    ["recoverable", "boolean"],
  ],
  lifecycle: [["action", "string"]],
};

/**
 * Validate that a payload has the required fields for the given event type.
 *
 * @param eventType - The declared event type
 * @param payload - The payload to validate
 * @throws {KrynixError} INVALID_PAYLOAD if required fields are missing or wrong type
 */
export function validatePayload(eventType: EventType, payload: unknown): void {
  if (payload === null || payload === undefined || typeof payload !== "object") {
    throw new KrynixError(
      "INVALID_PAYLOAD",
      `${eventType} payload must be an object, got ${payload === null ? "null" : typeof payload}`,
    );
  }

  const fields = REQUIRED_FIELDS[eventType];
  const obj = payload as Record<string, unknown>;

  for (const [fieldName, expectedType] of fields) {
    const value = obj[fieldName];
    if (value === undefined) {
      throw new KrynixError(
        "INVALID_PAYLOAD",
        `${eventType} payload missing required field '${fieldName}'`,
      );
    }

    // "any" means the field must be present but can be any type (including null)
    if (expectedType === "any") {
      continue;
    }

    if (expectedType === "object") {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new KrynixError(
          "INVALID_PAYLOAD",
          `${eventType} payload field '${fieldName}' must be an object, got ${value === null ? "null" : Array.isArray(value) ? "array" : typeof value}`,
        );
      }
    } else if (expectedType === "array") {
      if (!Array.isArray(value)) {
        throw new KrynixError(
          "INVALID_PAYLOAD",
          `${eventType} payload field '${fieldName}' must be an array, got ${value === null ? "null" : typeof value}`,
        );
      }
    } else if (typeof value !== expectedType) {
      throw new KrynixError(
        "INVALID_PAYLOAD",
        `${eventType} payload field '${fieldName}' must be ${expectedType}, got ${typeof value}`,
      );
    }
  }
}
