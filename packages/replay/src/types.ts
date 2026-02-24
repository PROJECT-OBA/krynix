/**
 * Type definitions for the replay engine.
 *
 * Covers the Determinism Envelope (extracted from session_start events),
 * divergence detection results, and replay runner output.
 *
 * @module
 */

/**
 * The Determinism Envelope extracted from a `lifecycle:session_start` event.
 *
 * Contains the parameters needed to reproduce a trace deterministically.
 * Extracted from `payload.context` of the first event in a trace.
 */
export interface DeterminismEnvelope {
  /** Seed used for deterministic PRNG (UUID generation, etc.). */
  replaySeed: number;

  /** Version of the agent that produced the trace. */
  agentVersion?: string;

  /** Pinned dependency versions (package name → version string). */
  dependencies?: Record<string, string>;

  /** Environment parameters (e.g., OS, Node.js version). */
  environment?: Record<string, string>;
}

/**
 * A single field-level difference between expected and actual values.
 */
export interface FieldDiff {
  /** Dot-notation path to the differing field (e.g., `"payload.arguments.path"`). */
  field: string;

  /** The expected value from the golden trace. */
  expected: unknown;

  /** The actual value from the replay trace. */
  actual: unknown;
}

/**
 * The point at which two traces first diverge.
 */
export interface DivergencePoint {
  /** The sequence_num where divergence was detected. */
  sequenceNum: number;

  /** The expected event at this position. */
  expected: {
    eventType: string;
    payload: unknown;
  };

  /** The actual event at this position. */
  actual: {
    eventType: string;
    payload: unknown;
  };

  /** Field-level diffs between expected and actual. */
  diffs: FieldDiff[];
}

/**
 * Result of comparing two trace event sequences.
 */
export interface DivergenceReport {
  /** Whether the traces match ("pass") or differ ("diverged"). */
  status: "pass" | "diverged";

  /** Details of the first divergence point. Present only when status is "diverged". */
  firstDivergence?: DivergencePoint;

  /** Total number of events in the expected trace. */
  totalEvents: number;

  /** Number of events that matched before the divergence (or total if pass). */
  eventsBeforeDivergence: number;
}

/**
 * Result of replaying/verifying a single trace file.
 */
export interface ReplayResult {
  /** Path to the trace file that was verified. */
  file: string;

  /** Overall status: pass, diverged, or error (structural/parse failure). */
  status: "pass" | "diverged" | "error";

  /** Divergence report (present when status is "pass" or "diverged"). */
  report?: DivergenceReport;

  /** Validation error messages (present when status is "error"). */
  validationErrors?: string[];
}

/**
 * Options for the replay runner.
 */
export interface ReplayOptions {
  /** Verify mode: check trace integrity and determinism. Default: true. */
  verify?: boolean;

  /** Regenerate mode: recompute hashes and overwrite the trace file. */
  regenerate?: boolean;

  /** Enable verbose output with detailed diff information. */
  verbose?: boolean;
}
