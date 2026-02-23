/**
 * Deterministic JSON serialization for hash chain computation.
 *
 * Produces canonical JSON: sorted keys, no whitespace, minimal number
 * representation, UTF-8 encoding. Two semantically equivalent objects
 * (differing only in key insertion order) produce byte-identical output.
 *
 * @module
 */

import { KrynixError } from "./errors.js";

/**
 * Serialize a value to canonical JSON.
 *
 * @param value - The value to serialize
 * @returns Canonical JSON string (sorted keys, no whitespace)
 * @throws {KrynixError} INVALID_JSON_VALUE if the value contains NaN, Infinity, -Infinity, or BigInt
 */
export function canonicalize(value: unknown): string {
  return serializeValue(value);
}

function serializeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number":
      if (!Number.isFinite(value)) {
        throw new KrynixError(
          "INVALID_JSON_VALUE",
          `cannot serialize non-finite number: ${String(value)}`,
        );
      }
      // JSON.stringify produces minimal representation for finite numbers
      // e.g., 1.0 → "1", 0.10 → "0.1"
      return JSON.stringify(value);

    case "bigint":
      throw new KrynixError("INVALID_JSON_VALUE", "cannot serialize BigInt value");

    case "string":
      return JSON.stringify(value);

    case "object":
      if (Array.isArray(value)) {
        return serializeArray(value);
      }
      return serializeObject(value as Record<string, unknown>);

    default:
      // undefined, function, symbol — skip (matches JSON.stringify behavior)
      return "null";
  }
}

function serializeArray(arr: unknown[]): string {
  const parts = arr.map((item) => serializeValue(item));
  return `[${parts.join(",")}]`;
}

function serializeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];

  for (const key of keys) {
    const val = obj[key];
    // Skip undefined values (matches JSON.stringify behavior)
    if (val === undefined) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${serializeValue(val)}`);
  }

  return `{${parts.join(",")}}`;
}
