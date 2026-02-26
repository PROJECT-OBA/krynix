import { describe, test, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPush, type PushDeps } from "./push.js";
import type { ControlPlaneConfig } from "./config.js";
import type { Credentials } from "./credentials.js";
import type { ControlPlaneClient, ApiResponse } from "./http-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: ControlPlaneConfig = {
  url: "https://cp.example.com",
  org_id: "org-1",
  policy_sync: false,
  fail_on_push_error: false,
};

const TEST_CREDS: Credentials = { token: "test-token" };

function okResponse<T>(data: T): ApiResponse<T> {
  return { ok: true, status: 200, data, error: null };
}

function errorResponse(status: number, message: string): ApiResponse {
  return { ok: false, status, data: null, error: message };
}

function makeClient(overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient {
  return {
    pushTrace: async () => okResponse({ id: "trace-1" }),
    pushEvaluation: async () => okResponse({ id: "eval-1" }),
    pushReplayReport: async () => okResponse({ id: "replay-1" }),
    pullPolicies: async () => okResponse([]),
    pushPolicy: async () => okResponse({ name: "p", version: "1" }),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PushDeps> = {}): Partial<PushDeps> {
  return {
    loadConfig: () => TEST_CONFIG,
    loadCredentials: () => TEST_CREDS,
    createClient: () => makeClient(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPush", () => {
  test("errors when no artifact flags provided", async () => {
    const result = await runPush([], makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
  });

  test("errors when config is missing", async () => {
    const result = await runPush(
      ["--trace", "/tmp/file.jsonl"],
      makeDeps({ loadConfig: () => null }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("not configured");
  });

  test("errors when credentials are missing", async () => {
    const result = await runPush(
      ["--trace", "/tmp/file.jsonl"],
      makeDeps({ loadCredentials: () => null }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Not authenticated");
  });

  test("errors when credentials have no token or api_key", async () => {
    const result = await runPush(
      ["--trace", "/tmp/file.jsonl"],
      makeDeps({ loadCredentials: () => ({}) }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Not authenticated");
  });

  test("errors when token is expired", async () => {
    const expiredCreds: Credentials = {
      token: "expired-token",
      expires_at: "2020-01-01T00:00:00Z",
    };
    const result = await runPush(
      ["--trace", "/tmp/file.jsonl"],
      makeDeps({ loadCredentials: () => expiredCreds }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("expired");
  });

  test("pushes trace successfully", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-push-"));
    try {
      const tracePath = join(tmpDir, "trace.jsonl");
      await writeFile(tracePath, '{"event_id":"evt-1"}\n', "utf-8");

      const mockClient = makeClient();
      const result = await runPush(
        ["--trace", tracePath],
        makeDeps({ createClient: () => mockClient }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).not.toBeNull();
      expect(result.output?.results).toHaveLength(1);
      expect(result.output?.results?.[0]?.type).toBe("trace");
      expect(result.output?.results?.[0]?.status).toBe("success");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("pushes evaluation successfully", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-push-"));
    try {
      const evalPath = join(tmpDir, "eval.json");
      await writeFile(evalPath, JSON.stringify({ verdict: "pass" }), "utf-8");

      const result = await runPush(["--evaluation", evalPath], makeDeps());

      expect(result.exitCode).toBe(0);
      expect(result.output?.results).toHaveLength(1);
      expect(result.output?.results?.[0]?.type).toBe("evaluation");
      expect(result.output?.results?.[0]?.status).toBe("success");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("pushes replay report successfully", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-push-"));
    try {
      const replayPath = join(tmpDir, "replay.json");
      await writeFile(replayPath, JSON.stringify({ matches: true }), "utf-8");

      const result = await runPush(["--replay-report", replayPath], makeDeps());

      expect(result.exitCode).toBe(0);
      expect(result.output?.results).toHaveLength(1);
      expect(result.output?.results?.[0]?.type).toBe("replay_report");
      expect(result.output?.results?.[0]?.status).toBe("success");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("reports error when pushTrace fails", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-push-"));
    try {
      const tracePath = join(tmpDir, "trace.jsonl");
      await writeFile(tracePath, '{"event_id":"evt-1"}\n', "utf-8");

      const mockClient = makeClient({
        pushTrace: async () => errorResponse(500, "Server error"),
      });
      const result = await runPush(
        ["--trace", tracePath],
        makeDeps({ createClient: () => mockClient }),
      );

      expect(result.exitCode).toBe(1);
      expect(result.output?.results?.[0]?.status).toBe("error");
      expect(result.output?.results?.[0]?.error).toBe("Server error");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles non-existent trace file", async () => {
    const mockClient = makeClient({
      pushTrace: async () => {
        throw new Error("ENOENT: no such file or directory");
      },
    });
    const result = await runPush(
      ["--trace", "/nonexistent/trace.jsonl"],
      makeDeps({ createClient: () => mockClient }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output?.results?.[0]?.status).toBe("error");
    expect(result.output?.results?.[0]?.error).toBeTruthy();
  });

  test("handles non-existent evaluation file", async () => {
    const result = await runPush(["--evaluation", "/nonexistent/eval.json"], makeDeps());

    expect(result.exitCode).toBe(1);
    expect(result.output?.results?.[0]?.status).toBe("error");
  });
});
