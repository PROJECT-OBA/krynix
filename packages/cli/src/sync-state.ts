/**
 * Sync state management for incremental policy sync.
 *
 * Manages a `sync-state.json` file in the krynix config directory
 * (`~/.krynix/`) to track the last successful policy sync timestamp,
 * scoped by CP base URL.
 *
 * @module
 */

import { chmod, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Sync state entry for a policy pull operation. */
export interface SyncStateEntry {
  last_sync: string;
  base_url: string;
}

/** Top-level sync state file contents. */
export interface SyncState {
  policy_pull: SyncStateEntry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load sync state from disk.
 *
 * @param configDir - Config directory (defaults to `~/.krynix`)
 * @returns Parsed sync state, or null if file is missing/corrupt
 */
export async function loadSyncState(configDir?: string): Promise<SyncState | null> {
  const dir = configDir ?? join(homedir(), ".krynix");
  const filePath = join(dir, "sync-state.json");

  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "policy_pull" in parsed &&
      typeof (parsed as SyncState).policy_pull === "object" &&
      (parsed as SyncState).policy_pull !== null &&
      typeof (parsed as SyncState).policy_pull.last_sync === "string" &&
      typeof (parsed as SyncState).policy_pull.base_url === "string"
    ) {
      return parsed as SyncState;
    }
    return null;
  } catch (err: unknown) {
    // Missing file → no sync state; other errors propagate
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    // Malformed JSON → treat as corrupt/missing state
    if (err instanceof SyntaxError) {
      return null;
    }
    throw err;
  }
}

/**
 * Save sync state to disk.
 *
 * Creates the config directory if it doesn't exist.
 * File is written with mode 0o600 (owner-only read/write).
 *
 * @param state - Sync state to save
 * @param configDir - Config directory (defaults to `~/.krynix`)
 */
export async function saveSyncState(state: SyncState, configDir?: string): Promise<void> {
  const dir = configDir ?? join(homedir(), ".krynix");
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, "sync-state.json");
  await writeFile(filePath, JSON.stringify(state, null, 2) + "\n", {
    encoding: "utf-8",
    mode: 0o600,
  });
  // Ensure 0o600 even when overwriting an existing file (mode only applies on create)
  await chmod(filePath, 0o600);
}
