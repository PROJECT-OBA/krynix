/**
 * Trace Adapter interface and configuration types.
 *
 * Adapters translate external agent framework events (e.g., OpenClaw hooks)
 * into Krynix TraceEvents. This file is type-only — zero runtime code.
 *
 * Lifecycle: `initialize → [onEvent...] → flush → shutdown`
 *
 * Adapters must NOT set `event_id`, `sequence_num`, `prev_hash`, or
 * `event_hash` — these are assigned by the Session Manager after the
 * adapter returns partial events.
 *
 * @module
 */

import type { TraceEvent } from "./types.js";

/**
 * Configuration passed to a TraceAdapter during initialization.
 */
export interface AdapterConfig {
  /** Agent ID to stamp on all produced TraceEvents. */
  agentId: string;

  /** Session ID for this execution. */
  sessionId: string;

  /**
   * Replay seed for deterministic operations.
   * Must be a safe integer (<= Number.MAX_SAFE_INTEGER, i.e., 2^53 - 1).
   * Seeds exceeding this range must be rejected at initialization.
   */
  replaySeed: number;

  /** Additional adapter-specific configuration. */
  options?: Record<string, unknown>;
}

/**
 * Interface that all Trace Adapters must implement.
 *
 * A TraceAdapter converts external agent framework events into Krynix
 * TraceEvents. The adapter is responsible for mapping framework-specific
 * event shapes to the canonical TraceEvent format.
 *
 * Lifecycle:
 * 1. `initialize(config)` — called once before any events
 * 2. `onEvent(externalEvent)` — called for each framework event; returns
 *    a partial TraceEvent or `null` to skip
 * 3. `flush()` — drain any buffered events before shutdown
 * 4. `shutdown()` — release resources; called once after all events
 */
export interface TraceAdapter {
  /** Unique adapter identifier, e.g., `"openclaw"`. */
  readonly name: string;

  /** Adapter version (semver). */
  readonly version: string;

  /**
   * Initialize the adapter with configuration.
   * Called once before any events are processed.
   */
  initialize(config: AdapterConfig): Promise<void>;

  /**
   * Convert a single external framework event to a TraceEvent.
   * Return `null` to skip events that have no Krynix equivalent.
   *
   * The returned TraceEvent may have placeholder values for fields
   * managed by the Session Manager (`event_id`, `sequence_num`,
   * `prev_hash`, `event_hash`).
   */
  onEvent(externalEvent: unknown): TraceEvent | null;

  /**
   * Drain any buffered events.
   * Called before shutdown to ensure no events are lost.
   */
  flush(): Promise<TraceEvent[]>;

  /**
   * Clean up adapter resources.
   * Called once after all events are processed.
   */
  shutdown(): Promise<void>;
}
