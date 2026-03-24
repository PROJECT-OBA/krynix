/**
 * Incremental trace writer for JSONL output.
 *
 * Appends TraceEvents one at a time, computing the hash chain incrementally.
 * This is a boundary module (impure) — it performs file I/O.
 *
 * @module
 * @mutates Writes to the filesystem
 */

import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { TraceEvent } from "./types.js";
import { canonicalize } from "./canonical-json.js";
import { validateTraceEvent } from "./schema-validator.js";
import { KrynixError } from "./errors.js";

/** Options accepted by TraceWriter. */
export interface TraceWriterOptions {
  /**
   * When `true`, each event is validated against the TraceEvent JSON schema
   * before being written. Invalid events cause a `KrynixError("INVALID_EVENT")`
   * to be thrown, preventing malformed data from being persisted.
   *
   * @default false
   */
  validateOnWrite?: boolean;
}

/**
 * Incremental JSONL writer that computes the hash chain on the fly.
 *
 * Usage:
 * ```ts
 * const writer = new TraceWriter({ validateOnWrite: true });
 * await writer.open("/path/to/trace.jsonl");
 * await writer.write(event1);
 * await writer.write(event2);
 * await writer.close();
 * ```
 */
export class TraceWriter {
  private fileHandle: FileHandle | null = null;
  private lastEventHash = "";
  private readonly validateOnWrite: boolean;

  constructor(options?: TraceWriterOptions) {
    this.validateOnWrite = options?.validateOnWrite ?? false;
  }

  /**
   * Open a file for writing trace events.
   *
   * @param path - Filesystem path to write to (created or truncated)
   */
  async open(path: string): Promise<void> {
    if (this.fileHandle !== null) {
      throw new Error("TraceWriter is already open; call close() first");
    }
    this.fileHandle = await open(path, "w");
    this.lastEventHash = "";
  }

  /**
   * Write a single TraceEvent, computing its hash chain link.
   *
   * The event's `prev_hash` and `event_hash` are overwritten
   * with the correct values for the chain.
   *
   * @param event - The TraceEvent to write
   */
  async write(event: TraceEvent): Promise<void> {
    if (this.fileHandle === null) {
      throw new Error("TraceWriter is not open; call open() first");
    }

    // Set prev_hash to the last written event's hash (or "" for first event)
    const withPrev = {
      ...event,
      prev_hash: this.lastEventHash,
      event_hash: "",
    } as unknown as TraceEvent;

    // Validate against schema before computing hash, so we never persist invalid events.
    if (this.validateOnWrite) {
      const result = validateTraceEvent(withPrev);
      if (!result.valid) {
        throw new KrynixError(
          "INVALID_EVENT",
          `Schema validation failed for event seq=${event.sequence_num}: ${result.error}`,
        );
      }
    }

    // Compute event_hash
    const canonical = canonicalize(withPrev);
    const eventHash = createHash("sha256").update(canonical).digest("hex");

    const hashed = { ...withPrev, event_hash: eventHash } as unknown as TraceEvent;

    // Append canonical JSON line
    await this.fileHandle.write(canonicalize(hashed) + "\n");

    this.lastEventHash = eventHash;
  }

  /**
   * The event_hash of the last written event, or "" if none written yet.
   */
  get currentHash(): string {
    return this.lastEventHash;
  }

  /**
   * Close the file handle.
   */
  async close(): Promise<void> {
    if (this.fileHandle !== null) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }
}
