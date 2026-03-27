/**
 * Determinism Envelope extraction from trace event sequences.
 *
 * Extracts replay parameters from the `lifecycle:session_start` event's
 * `payload.context` to enable deterministic trace replay.
 *
 * @module
 */

import { KrynixError } from "@krynix/core";
import type { TraceEvent } from "@krynix/core";
import type { DeterminismEnvelope } from "./types.js";

/**
 * Extract the Determinism Envelope from a trace event sequence.
 *
 * The envelope is sourced from the first event, which must be a
 * `lifecycle:session_start` event with a `context.replay_seed` field.
 *
 * @param events - Ordered trace events
 * @returns The extracted Determinism Envelope
 * @throws {KrynixError} INVALID_ENVELOPE if the trace is empty, first event
 *   is not a lifecycle:session_start, or replay_seed is missing
 * @throws {KrynixError} INVALID_SEED if replay_seed exceeds Number.MAX_SAFE_INTEGER
 */
export function extractEnvelope(events: readonly TraceEvent[]): DeterminismEnvelope {
  if (events.length === 0) {
    throw new KrynixError("INVALID_ENVELOPE", "trace is empty");
  }

  const first = events[0] as TraceEvent;

  if (first.event_type !== "lifecycle") {
    throw new KrynixError(
      "INVALID_ENVELOPE",
      `expected first event to be lifecycle, got "${first.event_type}"`,
    );
  }

  const payload = first.payload as { action: string; context?: Record<string, unknown> };

  if (payload.action !== "session_start") {
    throw new KrynixError(
      "INVALID_ENVELOPE",
      `expected first lifecycle event action to be "session_start", got "${payload.action}"`,
    );
  }

  const context = payload.context;
  if (!context || !("replay_seed" in context)) {
    throw new KrynixError("INVALID_ENVELOPE", "missing replay_seed in session_start context");
  }

  const replaySeed = context.replay_seed as number;

  if (typeof replaySeed !== "number" || !Number.isSafeInteger(replaySeed) || replaySeed <= 0) {
    throw new KrynixError(
      "INVALID_SEED",
      `replay_seed must be a positive safe integer, got ${String(replaySeed)}`,
    );
  }

  const envelope: DeterminismEnvelope = {
    replaySeed,
  };

  if (typeof context.agent_version === "string") {
    envelope.agentVersion = context.agent_version;
  }

  if (context.dependencies !== null && typeof context.dependencies === "object") {
    const raw = context.dependencies as Record<string, unknown>;
    envelope.dependencies = Object.fromEntries(
      Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  }

  if (context.environment !== null && typeof context.environment === "object") {
    const raw = context.environment as Record<string, unknown>;
    envelope.environment = Object.fromEntries(
      Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
  }

  return envelope;
}
