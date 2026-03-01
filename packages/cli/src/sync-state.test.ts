import { describe, test, expect } from "vitest";
import { mkdtemp, rm, readFile, stat, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { loadSyncState, saveSyncState, type SyncState } from "./sync-state.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadSyncState", () => {
  let tmpDir: string;

  async function setup(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-sync-"));
    return tmpDir;
  }

  async function cleanup(): Promise<void> {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  test("reads valid state file", async () => {
    const dir = await setup();
    try {
      const state: SyncState = {
        policy_pull: {
          last_sync: "2025-06-01T12:00:00.000Z",
          base_url: "https://cp.krynix.dev",
        },
      };
      await writeFile(join(dir, "sync-state.json"), JSON.stringify(state), "utf-8");

      const result = await loadSyncState(dir);
      expect(result).not.toBeNull();
      expect(result?.policy_pull.last_sync).toBe("2025-06-01T12:00:00.000Z");
      expect(result?.policy_pull.base_url).toBe("https://cp.krynix.dev");
    } finally {
      await cleanup();
    }
  });

  test("returns null when file is missing", async () => {
    const dir = await setup();
    try {
      const result = await loadSyncState(dir);
      expect(result).toBeNull();
    } finally {
      await cleanup();
    }
  });

  test("returns null for corrupt JSON", async () => {
    const dir = await setup();
    try {
      await writeFile(join(dir, "sync-state.json"), "not valid json {{{", "utf-8");
      const result = await loadSyncState(dir);
      expect(result).toBeNull();
    } finally {
      await cleanup();
    }
  });

  test("returns null for invalid structure", async () => {
    const dir = await setup();
    try {
      await writeFile(join(dir, "sync-state.json"), JSON.stringify({ foo: "bar" }), "utf-8");
      const result = await loadSyncState(dir);
      expect(result).toBeNull();
    } finally {
      await cleanup();
    }
  });
});

describe("saveSyncState", () => {
  let tmpDir: string;

  async function setup(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-sync-"));
    return tmpDir;
  }

  async function cleanup(): Promise<void> {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  test("writes state file", async () => {
    const dir = await setup();
    try {
      const state: SyncState = {
        policy_pull: {
          last_sync: "2025-06-01T12:00:00.000Z",
          base_url: "https://cp.krynix.dev",
        },
      };
      await saveSyncState(state, dir);

      const raw = await readFile(join(dir, "sync-state.json"), "utf-8");
      const parsed = JSON.parse(raw) as SyncState;
      expect(parsed.policy_pull.last_sync).toBe("2025-06-01T12:00:00.000Z");
    } finally {
      await cleanup();
    }
  });

  test("creates directory if missing", async () => {
    const dir = await setup();
    try {
      const subDir = join(dir, "newdir");
      const state: SyncState = {
        policy_pull: {
          last_sync: "2025-06-01T12:00:00.000Z",
          base_url: "https://cp.krynix.dev",
        },
      };
      await saveSyncState(state, subDir);

      const s = await stat(join(subDir, "sync-state.json"));
      expect(s.isFile()).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("writes with 0o600 permissions (POSIX only)", async () => {
    if (platform() === "win32") return;

    const dir = await setup();
    try {
      const state: SyncState = {
        policy_pull: {
          last_sync: "2025-06-01T12:00:00.000Z",
          base_url: "https://cp.krynix.dev",
        },
      };
      await saveSyncState(state, dir);

      const s = await stat(join(dir, "sync-state.json"));
      const mode = s.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await cleanup();
    }
  });

  test("enforces 0o600 when overwriting existing file (POSIX only)", async () => {
    if (platform() === "win32") return;

    const dir = await setup();
    try {
      const state: SyncState = {
        policy_pull: {
          last_sync: "2025-06-01T12:00:00.000Z",
          base_url: "https://cp.krynix.dev",
        },
      };
      // Create the file first
      await saveSyncState(state, dir);

      // Loosen permissions to simulate external modification
      await chmod(join(dir, "sync-state.json"), 0o644);

      // Overwrite via saveSyncState
      const updated: SyncState = {
        policy_pull: {
          last_sync: "2025-06-02T00:00:00.000Z",
          base_url: "https://cp.krynix.dev",
        },
      };
      await saveSyncState(updated, dir);

      const s = await stat(join(dir, "sync-state.json"));
      const mode = s.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await cleanup();
    }
  });
});
