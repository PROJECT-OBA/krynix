/**
 * Control Plane credential store.
 *
 * Manages API keys and tokens stored in `~/.krynix/credentials` (JSON, mode 0600).
 * Provides load/save/clear operations for credential lifecycle.
 *
 * @module
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Stored credentials for Control Plane authentication. */
export interface Credentials {
  /** Short-lived JWT token (from interactive login). */
  token?: string;
  /** Long-lived API key (from `auth create-key`). */
  api_key?: string;
  /** Token expiration timestamp (ISO 8601). */
  expires_at?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CRED_PATH = join(homedir(), ".krynix", "credentials");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load credentials from the credential store.
 *
 * @param credPath - Path to the credentials file (defaults to `~/.krynix/credentials`)
 * @returns Parsed credentials, or `null` if the file does not exist
 * @throws {Error} If the file exists but contains invalid JSON
 */
export function loadCredentials(credPath?: string): Credentials | null {
  const path = credPath ?? DEFAULT_CRED_PATH;

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Credentials file must contain a JSON object");
    }
    const obj = parsed as Record<string, unknown>;
    // Validate field types to catch corrupted files early
    if (obj["token"] !== undefined && typeof obj["token"] !== "string") {
      throw new Error("Credentials field 'token' must be a string");
    }
    if (obj["api_key"] !== undefined && typeof obj["api_key"] !== "string") {
      throw new Error("Credentials field 'api_key' must be a string");
    }
    if (obj["expires_at"] !== undefined && typeof obj["expires_at"] !== "string") {
      throw new Error("Credentials field 'expires_at' must be a string");
    }
    return obj as Credentials;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in credentials file: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Save credentials to the credential store.
 *
 * Creates the parent directory if it does not exist.
 * Writes with mode 0600 (owner read/write only).
 *
 * @param creds - Credentials to save
 * @param credPath - Path to the credentials file (defaults to `~/.krynix/credentials`)
 */
export function saveCredentials(creds: Credentials, credPath?: string): void {
  const path = credPath ?? DEFAULT_CRED_PATH;
  const dir = dirname(path);

  // Ensure parent directory exists
  mkdirSync(dir, { recursive: true });

  const content = JSON.stringify(creds, null, 2);
  writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
  // Ensure 0600 even when overwriting an existing file (mode only applies on create)
  chmodSync(path, 0o600);
}

/**
 * Clear credentials by deleting the credential file.
 *
 * No error if the file does not exist.
 *
 * @param credPath - Path to the credentials file (defaults to `~/.krynix/credentials`)
 */
export function clearCredentials(credPath?: string): void {
  const path = credPath ?? DEFAULT_CRED_PATH;

  try {
    unlinkSync(path);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return; // Already gone, no error
    }
    throw err;
  }
}

/**
 * Check if a token in the credentials has expired.
 *
 * @param creds - Credentials to check
 * @returns `true` if `expires_at` is set and in the past or malformed (fail-closed),
 *          `false` if `expires_at` is set and in the future, `false` if not set
 */
export function isTokenExpired(creds: Credentials): boolean {
  if (creds.expires_at === undefined) return false;
  const expiresAt = new Date(creds.expires_at).getTime();
  // Fail-closed: treat malformed dates as expired
  if (isNaN(expiresAt)) return true;
  return Date.now() > expiresAt;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
