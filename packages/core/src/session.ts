/**
 * Session management for TraceEvent recording.
 *
 * Provides a functional API (`startSession`, `recordEvent`, `endSession`)
 * that composes `SeededRandom`, `TraceWriter`, and `redact` to produce
 * deterministic, hash-chained, redacted trace files.
 *
 * @module
 * @mutates Writes to the filesystem
 */

import { randomInt } from "node:crypto";
import type { TraceEvent, EventType, LifecyclePayload, TraceEventBase } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import { KrynixError } from "./errors.js";
import { SeededRandom } from "./seeded-random.js";
import { TraceWriter } from "./trace-writer.js";
import { redact } from "./redaction.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Configuration for starting a new session. */
export interface SessionConfig {
  /** Agent ID stamped on every event. */
  agentId: string;

  /**
   * Replay seed for deterministic UUID generation.
   * If omitted, a random seed is generated (non-deterministic mode).
   */
  replaySeed?: number;

  /** Filesystem path for the output `.trace.jsonl` file. */
  outputPath: string;

  /** Additional metadata included in the `session_start` event context. */
  metadata?: Record<string, unknown>;
}

/** Opaque session handle returned to callers. */
export interface Session {
  readonly sessionId: string;
  readonly agentId: string;
  readonly replaySeed: number;
  readonly outputPath: string;
}

/**
 * The subset of TraceEvent fields that callers provide.
 * Session Manager fills in `event_id`, `sequence_num`, `session_id`,
 * `prev_hash`, `event_hash`, and `redacted`.
 */
export interface PartialTraceEvent {
  event_type: EventType;
  timestamp: string;
  parent_id: string | null;
  agent_id: string;
  payload: unknown;
  metadata: Record<string, unknown> | null;
  schema_version?: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface SessionInternal {
  rng: SeededRandom;
  writer: TraceWriter;
  sequenceNum: number;
  closed: boolean;
}

const sessions = new Map<string, SessionInternal>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a new recording session.
 *
 * Creates a trace file at `config.outputPath`, writes a `lifecycle:session_start`
 * event (sequence 0), and returns an opaque `Session` handle.
 *
 * @param config - Session configuration
 * @returns Opaque session handle for use with `recordEvent` and `endSession`
 * @throws {KrynixError} INVALID_SEED if the provided seed is invalid
 */
export async function startSession(config: SessionConfig): Promise<Session> {
  const seed = config.replaySeed ?? randomInt(1, 2 ** 48);
  const rng = new SeededRandom(seed);
  const sessionId = rng.nextUUID();

  const writer = new TraceWriter();
  await writer.open(config.outputPath);

  const internal: SessionInternal = {
    rng,
    writer,
    sequenceNum: 0,
    closed: false,
  };

  sessions.set(sessionId, internal);

  // Write lifecycle:session_start as sequence 0
  const startEvent: TraceEvent = {
    event_id: rng.nextUUID(),
    session_id: sessionId,
    sequence_num: 0,
    timestamp: new Date().toISOString(),
    event_type: "lifecycle",
    parent_id: null,
    agent_id: config.agentId,
    payload: {
      action: "session_start" as const,
      context: {
        replay_seed: seed,
        ...(config.metadata ?? {}),
      },
    } as LifecyclePayload,
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION,
  } as TraceEventBase<"lifecycle", LifecyclePayload>;

  await writer.write(startEvent);
  internal.sequenceNum = 1;

  return {
    sessionId,
    agentId: config.agentId,
    replaySeed: seed,
    outputPath: config.outputPath,
  };
}

/**
 * Record a single event in an open session.
 *
 * Assigns `event_id` (deterministic via SeededRandom), `sequence_num`,
 * `session_id`, applies redaction, and writes through `TraceWriter`
 * (which computes the hash chain).
 *
 * @param session - Session handle from `startSession`
 * @param partial - Partial event data (caller provides event_type, payload, etc.)
 * @returns The finalized TraceEvent as written to the trace file
 * @throws {KrynixError} SESSION_CLOSED if the session has been ended
 */
export async function recordEvent(
  session: Session,
  partial: PartialTraceEvent,
): Promise<TraceEvent> {
  const internal = sessions.get(session.sessionId);
  if (!internal || internal.closed) {
    throw new KrynixError("SESSION_CLOSED", "cannot record event on a closed session");
  }

  const fullEvent = {
    event_id: internal.rng.nextUUID(),
    session_id: session.sessionId,
    sequence_num: internal.sequenceNum,
    timestamp: partial.timestamp,
    event_type: partial.event_type,
    parent_id: partial.parent_id,
    agent_id: partial.agent_id,
    payload: partial.payload,
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: partial.metadata,
    schema_version: partial.schema_version ?? SCHEMA_VERSION,
  } as TraceEvent;

  const redacted = redact(fullEvent);

  await internal.writer.write(redacted);
  internal.sequenceNum++;

  return redacted;
}

/**
 * End an open session.
 *
 * Writes a `lifecycle:session_end` event, closes the trace file,
 * and cleans up internal state. Calling this twice throws.
 *
 * @param session - Session handle from `startSession`
 * @param summary - Optional summary data included in the session_end context
 * @throws {KrynixError} SESSION_CLOSED if the session has already been ended
 */
export async function endSession(
  session: Session,
  summary?: Record<string, unknown>,
): Promise<void> {
  const internal = sessions.get(session.sessionId);
  if (!internal || internal.closed) {
    throw new KrynixError("SESSION_CLOSED", "session has already been ended");
  }

  // Write lifecycle:session_end
  const endEvent: TraceEvent = {
    event_id: internal.rng.nextUUID(),
    session_id: session.sessionId,
    sequence_num: internal.sequenceNum,
    timestamp: new Date().toISOString(),
    event_type: "lifecycle",
    parent_id: null,
    agent_id: session.agentId,
    payload: {
      action: "session_end" as const,
      ...(summary ? { context: summary } : {}),
    } as LifecyclePayload,
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION,
  } as TraceEventBase<"lifecycle", LifecyclePayload>;

  await internal.writer.write(endEvent);
  await internal.writer.close();

  internal.closed = true;
  sessions.delete(session.sessionId);
}

/**
 * Forcibly remove a session from the registry without writing lifecycle events.
 *
 * Used for error recovery and cleanup of abandoned sessions.
 * Closes the `TraceWriter` file handle to avoid fd leaks.
 * Idempotent — no-op if the session is not found or already closed.
 *
 * @param session - Session handle from `startSession`
 */
export async function destroySession(session: Session): Promise<void> {
  const internal = sessions.get(session.sessionId);
  if (!internal || internal.closed) {
    return;
  }

  internal.closed = true;
  sessions.delete(session.sessionId);

  try {
    await internal.writer.close();
  } catch {
    // Best-effort close — swallow errors from already-closed handles.
  }
}

/**
 * Return the number of active (non-closed) sessions.
 *
 * Diagnostic utility for detecting session leaks.
 */
export function getActiveSessions(): number {
  return sessions.size;
}
