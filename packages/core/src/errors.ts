/**
 * Shared error types for the Krynix runtime.
 *
 * Core modules throw typed errors; boundary modules (CLI, adapters) catch
 * and map them to exit codes or user-facing messages.
 *
 * @module
 */

/**
 * Base error class for all Krynix-specific errors.
 *
 * @example
 * ```ts
 * throw new KrynixError("HASH_CHAIN_BROKEN", "Hash mismatch at event 3");
 * ```
 */
export class KrynixError extends Error {
  constructor(
    /** Machine-readable error code for programmatic handling. */
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KrynixError";
  }
}
