import { describe, test, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGoldenPromote, runGoldenList, runGoldenPull, type GoldenDeps } from "./golden.js";
import type { ControlPlaneClient, ApiResponse, GoldenTraceEntry } from "./http-client.js";
import type { ControlPlaneConfig } from "./config.js";
import type { Credentials } from "./credentials.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: ControlPlaneConfig = {
  url: "https://cp.example.com",
  org_id: "org-1",
  policy_sync: false,
  fail_on_push_error: false,
};
const TEST_CREDS: Credentials = {
  token: "valid-token",
  expires_at: "2099-01-01T00:00:00Z",
};

function okResponse<T>(data: T): ApiResponse<T> {
  return { ok: true, status: 200, data, error: null };
}

function errorResponse<T = unknown>(code: number, msg: string): ApiResponse<T> {
  return { ok: false, status: code, data: null, error: msg };
}

function makeClient(overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient {
  return {
    pushTrace: async () => okResponse({ id: "t" }),
    pushEvaluation: async () => okResponse({ id: "e" }),
    pushReplayReport: async () => okResponse({ id: "r" }),
    pullPolicies: async () => okResponse([]),
    pushPolicy: async () => okResponse({ name: "p", version: "1" }),
    pushComplianceBundle: async () => okResponse({ bundle_id: "b" }),
    promoteGoldenTrace: async () => okResponse({ golden_trace_id: "gt-1" }),
    listGoldenTraces: async () => okResponse([] as GoldenTraceEntry[]),
    pullGoldenTrace: async () => okResponse({ path: "/tmp/out" }),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<GoldenDeps> = {}): Partial<GoldenDeps> {
  return {
    loadConfig: () => TEST_CONFIG,
    loadCredentials: () => TEST_CREDS,
    isTokenExpired: () => false,
    createClient: () => makeClient(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: golden promote
// ---------------------------------------------------------------------------

describe("runGoldenPromote", () => {
  test("promotes trace successfully", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-golden-"));
    try {
      const tracePath = join(tmpDir, "test.trace.jsonl");
      await writeFile(tracePath, '{"event":"test"}\n', "utf-8");

      const result = await runGoldenPromote(
        ["--trace", tracePath, "--name", "my-golden"],
        makeDeps(),
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toEqual({ golden_trace_id: "gt-1" });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("sends metadata with description and labels", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-golden-"));
    try {
      const tracePath = join(tmpDir, "test.trace.jsonl");
      await writeFile(tracePath, '{"event":"test"}\n', "utf-8");

      let capturedMetadata: unknown;
      const client = makeClient({
        promoteGoldenTrace: async (_path, metadata) => {
          capturedMetadata = metadata;
          return okResponse({ golden_trace_id: "gt-2" });
        },
      });

      await runGoldenPromote(
        [
          "--trace",
          tracePath,
          "--name",
          "baseline",
          "--description",
          "Main workflow",
          "--label",
          "env=prod",
          "--label",
          "team=core",
        ],
        makeDeps({ createClient: () => client }),
      );

      expect(capturedMetadata).toEqual({
        name: "baseline",
        description: "Main workflow",
        labels: { env: "prod", team: "core" },
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("errors when --trace is missing", async () => {
    const result = await runGoldenPromote(["--name", "test"], makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--trace");
  });

  test("errors when --name is missing", async () => {
    const result = await runGoldenPromote(["--trace", "/tmp/f.jsonl"], makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--name");
  });

  test("errors when not authenticated", async () => {
    const result = await runGoldenPromote(
      ["--trace", "/tmp/f.jsonl", "--name", "test"],
      makeDeps({ loadCredentials: () => null }),
    );
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Not authenticated");
  });
});

// ---------------------------------------------------------------------------
// Tests: golden list
// ---------------------------------------------------------------------------

describe("runGoldenList", () => {
  test("lists golden traces", async () => {
    const entries: GoldenTraceEntry[] = [
      {
        id: "gt-1",
        name: "baseline",
        description: "Main",
        created_at: "2025-01-01T00:00:00Z",
        event_count: 10,
        labels: {},
      },
    ];
    const client = makeClient({
      listGoldenTraces: async () => okResponse(entries),
    });

    const result = await runGoldenList([], makeDeps({ createClient: () => client }));

    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual(entries);
  });

  test("passes filters to client", async () => {
    let capturedFilters: unknown;
    const client = makeClient({
      listGoldenTraces: async (filters) => {
        capturedFilters = filters;
        return okResponse([] as GoldenTraceEntry[]);
      },
    });

    await runGoldenList(
      ["--name", "test", "--label", "env=prod", "--limit", "5"],
      makeDeps({ createClient: () => client }),
    );

    expect(capturedFilters).toEqual({ name: "test", label: "env=prod", limit: 5 });
  });

  test("returns empty array when no results", async () => {
    const result = await runGoldenList([], makeDeps());
    expect(result.exitCode).toBe(0);
    expect(result.output).toEqual([]);
  });

  test("handles server error", async () => {
    const client = makeClient({
      listGoldenTraces: async () => errorResponse<GoldenTraceEntry[]>(500, "Internal error"),
    });

    const result = await runGoldenList([], makeDeps({ createClient: () => client }));
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Internal error");
  });
});

// ---------------------------------------------------------------------------
// Tests: golden pull
// ---------------------------------------------------------------------------

describe("runGoldenPull", () => {
  test("pulls golden trace to output path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-golden-"));
    try {
      const outPath = join(tmpDir, "golden.trace.jsonl");
      const client = makeClient({
        pullGoldenTrace: async (_id, output) => okResponse({ path: output }),
      });

      const result = await runGoldenPull(
        ["--id", "gt-1", "--output", outPath],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.output).toEqual({ path: outPath });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("errors when --id is missing", async () => {
    const result = await runGoldenPull(["--output", "/tmp/out"], makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--id");
  });

  test("errors when --output is missing", async () => {
    const result = await runGoldenPull(["--id", "gt-1"], makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--output");
  });

  test("handles 404 from server", async () => {
    const client = makeClient({
      pullGoldenTrace: async () => errorResponse<{ path: string }>(404, "Golden trace not found"),
    });

    const result = await runGoldenPull(
      ["--id", "gt-nonexistent", "--output", "/tmp/out"],
      makeDeps({ createClient: () => client }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("not found");
  });
});
