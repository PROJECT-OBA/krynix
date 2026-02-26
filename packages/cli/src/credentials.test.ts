import { describe, test, expect } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  isTokenExpired,
} from "./credentials.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("credentials", () => {
  let tmpDir: string;

  test("saveCredentials and loadCredentials round-trip", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      const creds = { token: "jwt-abc", expires_at: "2099-01-01T00:00:00Z" };

      saveCredentials(creds, credPath);
      const loaded = loadCredentials(credPath);

      expect(loaded).not.toBeNull();
      expect(loaded?.token).toBe("jwt-abc");
      expect(loaded?.expires_at).toBe("2099-01-01T00:00:00Z");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("saveCredentials writes with mode 0600", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      saveCredentials({ api_key: "key-123" }, credPath);

      const s = await stat(credPath);
      // Check owner read/write only (0600 = 0o100600 for regular file)
      const mode = s.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("saveCredentials enforces 0600 when overwriting existing file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      const { writeFileSync, chmodSync } = await import("node:fs");
      // Create file with permissive mode
      writeFileSync(credPath, "{}", { encoding: "utf-8", mode: 0o644 });
      chmodSync(credPath, 0o644);

      // Overwrite via saveCredentials
      saveCredentials({ api_key: "key-456" }, credPath);

      const s = await stat(credPath);
      const mode = s.mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadCredentials returns null for missing file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const result = loadCredentials(join(tmpDir, "nonexistent"));
      expect(result).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadCredentials throws on invalid JSON", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(credPath, "not json", "utf-8");

      expect(() => loadCredentials(credPath)).toThrow("Invalid JSON");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("clearCredentials deletes existing file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      saveCredentials({ token: "jwt-abc" }, credPath);

      clearCredentials(credPath);

      const loaded = loadCredentials(credPath);
      expect(loaded).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("clearCredentials on missing file does not throw", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      expect(() => clearCredentials(join(tmpDir, "nonexistent"))).not.toThrow();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("saveCredentials creates parent directory if needed", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "a", "b", "credentials");
      saveCredentials({ api_key: "key-deep" }, credPath);

      const loaded = loadCredentials(credPath);
      expect(loaded?.api_key).toBe("key-deep");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadCredentials throws on non-string token field", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(credPath, '{"token": 42}', "utf-8");

      expect(() => loadCredentials(credPath)).toThrow("'token' must be a string");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadCredentials throws on non-string api_key field", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(credPath, '{"api_key": true}', "utf-8");

      expect(() => loadCredentials(credPath)).toThrow("'api_key' must be a string");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("loadCredentials with api_key only", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-creds-"));
    try {
      const credPath = join(tmpDir, "credentials");
      saveCredentials({ api_key: "krynix-key-org-abc123" }, credPath);

      const loaded = loadCredentials(credPath);
      expect(loaded?.api_key).toBe("krynix-key-org-abc123");
      expect(loaded?.token).toBeUndefined();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("isTokenExpired", () => {
  test("returns false when expires_at is not set", () => {
    expect(isTokenExpired({ token: "abc" })).toBe(false);
  });

  test("returns false when token expires in the future", () => {
    expect(isTokenExpired({ token: "abc", expires_at: "2099-01-01T00:00:00Z" })).toBe(false);
  });

  test("returns true when token is expired", () => {
    expect(isTokenExpired({ token: "abc", expires_at: "2020-01-01T00:00:00Z" })).toBe(true);
  });

  test("returns true for invalid expires_at format (fail-closed)", () => {
    expect(isTokenExpired({ token: "abc", expires_at: "not-a-date" })).toBe(true);
  });
});
