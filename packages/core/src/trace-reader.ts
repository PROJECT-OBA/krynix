/**
 * Parse `.trace.jsonl` files into arrays of TraceEvent objects.
 *
 * Provides clear, line-numbered error messages for malformed input.
 * Does not perform hash chain validation — callers invoke
 * `validateHashChain` separately.
 *
 * @module
 */

import { readFile } from "node:fs/promises";
import type { TraceEvent } from "./types.js";
import { KrynixError } from "./errors.js";
import { validateTraceEvent } from "./schema-validator.js";

/** Required top-level fields on every TraceEvent. */
const REQUIRED_FIELDS = [
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

/**
 * Read and parse a `.trace.jsonl` file into an array of TraceEvents.
 *
 * @param path - Path to a UTF-8 encoded JSON Lines file
 * @returns Array of parsed TraceEvent objects
 * @throws {KrynixError} TRACE_READ_ERROR if a line contains invalid JSON or is missing required fields
 */
export async function readTrace(path: string): Promise<TraceEvent[]> {
  const content = await readFile(path, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim() !== "");

  return lines.map((line, index) => {
    const lineNum = index + 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new KrynixError("TRACE_READ_ERROR", `Invalid JSON on line ${String(lineNum)}`);
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new KrynixError(
        "TRACE_READ_ERROR",
        `Expected object on line ${String(lineNum)}, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      );
    }

    const obj = parsed as Record<string, unknown>;
    for (const field of REQUIRED_FIELDS) {
      if (!(field in obj)) {
        throw new KrynixError(
          "TRACE_READ_ERROR",
          `Missing required field "${field}" on line ${String(lineNum)}`,
        );
      }
    }

    const validation = validateTraceEvent(obj);
    if (!validation.valid) {
      throw new KrynixError(
        "TRACE_READ_ERROR",
        `Invalid TraceEvent on line ${String(lineNum)}: ${validation.error ?? "unknown error"}`,
      );
    }

    return parsed as TraceEvent;
  });
}
