/**
 * Payload field scanning and redaction for TraceEvents.
 *
 * Replaces sensitive field values with deterministic placeholder tokens
 * before hash chain computation. Redaction is a pure function that returns
 * a new TraceEvent — the original is never mutated.
 *
 * @module
 */

import { createHash } from "node:crypto";
import type { TraceEvent } from "./types.js";

/** Pattern matching sensitive field names (case-insensitive, suffix match). */
const SENSITIVE_PATTERN = /(_key|_secret|_token|_password|_credential)$/i;

/**
 * Redact sensitive fields in a TraceEvent's payload.
 *
 * Fields whose names match `*_key`, `*_secret`, `*_token`, `*_password`,
 * or `*_credential` (case-insensitive) have their string values replaced
 * with `[REDACTED:SHA256_PREFIX_8]`.
 *
 * @param event - The TraceEvent to redact
 * @returns A new TraceEvent with sensitive fields replaced and `redacted` flag set
 */
export function redact(event: TraceEvent): TraceEvent {
  let wasRedacted = false;

  const redactedPayload = scanObject(
    event.payload as unknown as Record<string, unknown>,
    (fieldName, value) => {
      if (SENSITIVE_PATTERN.test(fieldName) && typeof value === "string") {
        wasRedacted = true;
        return redactValue(value);
      }
      return value;
    },
  );

  return {
    ...event,
    payload: redactedPayload,
    redacted: wasRedacted || event.redacted,
  } as unknown as TraceEvent;
}

/**
 * Produce a deterministic redaction placeholder for a string value.
 *
 * @param value - The original sensitive string
 * @returns Placeholder in the format `[REDACTED:abcd1234]`
 */
function redactValue(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `[REDACTED:${hash.slice(0, 8)}]`;
}

/**
 * Recursively walk an object, applying a visitor to each field.
 */
function scanObject(
  obj: Record<string, unknown>,
  visitor: (fieldName: string, value: unknown) => unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const visited = visitor(key, value);
    if (visited !== null && typeof visited === "object" && !Array.isArray(visited)) {
      result[key] = scanObject(visited as Record<string, unknown>, visitor);
    } else if (Array.isArray(visited)) {
      result[key] = scanArray(visited, visitor);
    } else {
      result[key] = visited;
    }
  }

  return result;
}

/**
 * Recursively walk an array, scanning any nested objects.
 */
function scanArray(
  arr: unknown[],
  visitor: (fieldName: string, value: unknown) => unknown,
): unknown[] {
  return arr.map((item) => {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      return scanObject(item as Record<string, unknown>, visitor);
    }
    if (Array.isArray(item)) {
      return scanArray(item, visitor);
    }
    return item;
  });
}
