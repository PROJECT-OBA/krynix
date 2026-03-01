import { describe, test, expect } from "vitest";
import { mkdtemp, rm, readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPolicyPull, type PolicyPullDeps } from "./policy-pull.js";
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

function makePolicy(name: string, version: string, yaml: string) {
  const digest = `sha256:${createHash("sha256").update(yaml, "utf-8").digest("hex")}`;
  return { name, version, yaml_content: yaml, digest };
}

function makeClient(overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient {
  return {
    pushTrace: async () => okResponse({}),
    pushEvaluation: async () => okResponse({}),
    pushReplayReport: async () => okResponse({}),
    pullPolicies: async () => okResponse([]),
    pushPolicy: async () => okResponse({}),
    pushComplianceBundle: async () => okResponse({ bundle_id: "b" }),
    promoteGoldenTrace: async () => okResponse({ golden_trace_id: "gt" }),
    listGoldenTraces: async () => okResponse([]),
    pullGoldenTrace: async () => okResponse({ path: "" }),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PolicyPullDeps> = {}): Partial<PolicyPullDeps> {
  return {
    loadConfig: () => TEST_CONFIG,
    loadCredentials: () => TEST_CREDS,
    createClient: () => makeClient(),
    loadSyncState: async () => null,
    saveSyncState: async () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPolicyPull", () => {
  test("errors when config is missing", async () => {
    const result = await runPolicyPull([], makeDeps({ loadConfig: () => null }));
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("not configured");
  });

  test("errors when credentials are missing", async () => {
    const result = await runPolicyPull([], makeDeps({ loadCredentials: () => null }));
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Not authenticated");
  });

  test("errors when token is expired", async () => {
    const expiredCreds: Credentials = {
      token: "expired-token",
      expires_at: "2020-01-01T00:00:00Z",
    };
    const result = await runPolicyPull([], makeDeps({ loadCredentials: () => expiredCreds }));
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("expired");
  });

  test("pulls and writes policies to output directory", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      const outputDir = join(tmpDir, "policies");
      const yaml = "apiVersion: krynix.dev/v1\nkind: Policy\n";
      const policy = makePolicy("test-policy", "1.0.0", yaml);

      const client = makeClient({
        pullPolicies: async () => okResponse([policy]),
      });

      const result = await runPolicyPull(
        ["--output-dir", outputDir],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.result).not.toBeNull();
      expect(result.result?.policies_fetched).toBe(1);
      expect(result.result?.policies_written).toBe(1);
      expect(result.result?.policies_skipped).toBe(0);

      const written = await readFile(join(outputDir, "test-policy@1.0.0.policy.yaml"), "utf-8");
      expect(written).toBe(yaml);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("skips policies with digest mismatch", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      const outputDir = join(tmpDir, "policies");
      const badPolicy = {
        name: "bad",
        version: "1.0.0",
        yaml_content: "content",
        digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      };

      const client = makeClient({
        pullPolicies: async () => okResponse([badPolicy]),
      });

      const result = await runPolicyPull(
        ["--output-dir", outputDir],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.result?.policies_fetched).toBe(1);
      expect(result.result?.policies_written).toBe(0);
      expect(result.result?.policies_skipped).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("skips policies that already exist with same content", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      const outputDir = join(tmpDir, "policies");
      const yaml = "apiVersion: krynix.dev/v1\n";
      const policy = makePolicy("existing", "1.0.0", yaml);

      // Pre-write the file
      const { mkdir } = await import("node:fs/promises");
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(outputDir, "existing@1.0.0.policy.yaml"), yaml, "utf-8");

      const client = makeClient({
        pullPolicies: async () => okResponse([policy]),
      });

      const result = await runPolicyPull(
        ["--output-dir", outputDir],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.result?.policies_written).toBe(0);
      expect(result.result?.policies_skipped).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("overwrites existing file when content differs", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      const outputDir = join(tmpDir, "policies");
      const newYaml = "apiVersion: krynix.dev/v1\nversion: 2\n";
      const policy = makePolicy("update", "1.0.0", newYaml);

      // Pre-write with old content
      const { mkdir } = await import("node:fs/promises");
      await mkdir(outputDir, { recursive: true });
      await writeFile(join(outputDir, "update@1.0.0.policy.yaml"), "old-content", "utf-8");

      const client = makeClient({
        pullPolicies: async () => okResponse([policy]),
      });

      const result = await runPolicyPull(
        ["--output-dir", outputDir],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.result?.policies_written).toBe(1);

      const written = await readFile(join(outputDir, "update@1.0.0.policy.yaml"), "utf-8");
      expect(written).toBe(newYaml);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles empty policy list", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      const outputDir = join(tmpDir, "policies");
      const client = makeClient({
        pullPolicies: async () => okResponse([]),
      });

      const result = await runPolicyPull(
        ["--output-dir", outputDir],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.result?.policies_fetched).toBe(0);
      expect(result.result?.policies_written).toBe(0);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns error when API fails", async () => {
    const client = makeClient({
      pullPolicies: async () => ({ ok: false, status: 401, data: null, error: "Unauthorized" }),
    });

    const result = await runPolicyPull([], makeDeps({ createClient: () => client }));

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Unauthorized");
  });

  test("returns error when API returns non-array data", async () => {
    const client = makeClient({
      pullPolicies: async () => okResponse({ policies: [] }),
    });

    const result = await runPolicyPull([], makeDeps({ createClient: () => client }));

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("expected an array");
  });

  test("passes labels to pullPolicies", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      let capturedLabels: string | undefined;
      const client = makeClient({
        pullPolicies: async (opts) => {
          capturedLabels = opts?.labels;
          return okResponse([]);
        },
      });

      await runPolicyPull(
        ["--labels", "env:prod", "--output-dir", join(tmpDir, "policies")],
        makeDeps({ createClient: () => client }),
      );

      expect(capturedLabels).toBe("env:prod");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("uses default output directory when not specified", async () => {
    const client = makeClient({
      pullPolicies: async () => okResponse([]),
    });

    const result = await runPolicyPull([], makeDeps({ createClient: () => client }));

    expect(result.exitCode).toBe(0);
    expect(result.result?.output_dir).toBe("./policies");
  });

  // -------------------------------------------------------------------------
  // Sprint 9: Incremental policy sync
  // -------------------------------------------------------------------------

  test("--since passes since parameter to pullPolicies", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      let capturedOpts: Record<string, unknown> | undefined;
      const client = makeClient({
        pullPolicies: async (opts) => {
          capturedOpts = opts as Record<string, unknown>;
          return okResponse([]);
        },
      });

      await runPolicyPull(
        ["--since", "2025-06-01T00:00:00Z", "--output-dir", join(tmpDir, "policies")],
        makeDeps({ createClient: () => client }),
      );

      expect(capturedOpts?.since).toBe("2025-06-01T00:00:00Z");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("--incremental first run → no since param, state written", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      let capturedOpts: Record<string, unknown> | undefined;
      let savedState: unknown = null;

      const client = makeClient({
        pullPolicies: async (opts) => {
          capturedOpts = opts as Record<string, unknown>;
          return okResponse([]);
        },
      });

      const result = await runPolicyPull(
        ["--incremental", "--output-dir", join(tmpDir, "policies")],
        makeDeps({
          createClient: () => client,
          loadSyncState: async () => null,
          saveSyncState: async (state) => {
            savedState = state;
          },
        }),
      );

      expect(result.exitCode).toBe(0);
      // First run: no since param
      expect(capturedOpts?.since).toBeUndefined();
      // State was saved
      expect(savedState).not.toBeNull();
      expect((savedState as { policy_pull: { base_url: string } }).policy_pull.base_url).toBe(
        "https://cp.example.com",
      );
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("--incremental second run → since param from state", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      let capturedOpts: Record<string, unknown> | undefined;
      const client = makeClient({
        pullPolicies: async (opts) => {
          capturedOpts = opts as Record<string, unknown>;
          return okResponse([]);
        },
      });

      await runPolicyPull(
        ["--incremental", "--output-dir", join(tmpDir, "policies")],
        makeDeps({
          createClient: () => client,
          loadSyncState: async () => ({
            policy_pull: {
              last_sync: "2025-05-01T00:00:00.000Z",
              base_url: "https://cp.example.com",
            },
          }),
        }),
      );

      expect(capturedOpts?.since).toBe("2025-05-01T00:00:00.000Z");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("--since and --incremental → --since wins", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      let capturedOpts: Record<string, unknown> | undefined;
      const client = makeClient({
        pullPolicies: async (opts) => {
          capturedOpts = opts as Record<string, unknown>;
          return okResponse([]);
        },
      });

      await runPolicyPull(
        [
          "--since",
          "2025-06-15T00:00:00Z",
          "--incremental",
          "--output-dir",
          join(tmpDir, "policies"),
        ],
        makeDeps({
          createClient: () => client,
          loadSyncState: async () => ({
            policy_pull: {
              last_sync: "2025-05-01T00:00:00.000Z",
              base_url: "https://cp.example.com",
            },
          }),
        }),
      );

      expect(capturedOpts?.since).toBe("2025-06-15T00:00:00Z");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("state file scoped to base_url — different URL = fresh pull", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      let capturedOpts: Record<string, unknown> | undefined;
      const client = makeClient({
        pullPolicies: async (opts) => {
          capturedOpts = opts as Record<string, unknown>;
          return okResponse([]);
        },
      });

      await runPolicyPull(
        ["--incremental", "--output-dir", join(tmpDir, "policies")],
        makeDeps({
          createClient: () => client,
          loadSyncState: async () => ({
            policy_pull: {
              last_sync: "2025-05-01T00:00:00.000Z",
              base_url: "https://different.example.com",
            },
          }),
        }),
      );

      // Different base_url → treats as fresh
      expect(capturedOpts?.since).toBeUndefined();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("invalid --since timestamp → error", async () => {
    const result = await runPolicyPull(["--since", "not-a-timestamp"], makeDeps());

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Invalid --since timestamp");
  });

  test("--incremental updates state after success", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      let savedState: unknown = null;
      const client = makeClient({
        pullPolicies: async () => okResponse([]),
      });

      const result = await runPolicyPull(
        ["--incremental", "--output-dir", join(tmpDir, "policies")],
        makeDeps({
          createClient: () => client,
          saveSyncState: async (state) => {
            savedState = state;
          },
        }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.result?.sync_timestamp).toBeDefined();
      expect(savedState).not.toBeNull();
      const ss = savedState as { policy_pull: { last_sync: string } };
      expect(ss.policy_pull.last_sync).toBe(result.result?.sync_timestamp);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("skips policy when write target is a symlink (POSIX only)", async () => {
    if (process.platform === "win32") return;

    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-pull-"));
    try {
      const outputDir = join(tmpDir, "policies");
      await mkdir(outputDir, { recursive: true });

      const yaml = "name: test-policy\nversion: '1'\nrules: []\n";
      const policy = makePolicy("test-policy", "1.0.0", yaml);

      // Create a symlink at the expected policy file location pointing outside
      const outsideFile = join(tmpDir, "outside-target.txt");
      await writeFile(outsideFile, "should not be overwritten", "utf-8");
      await symlink(outsideFile, join(outputDir, "test-policy@1.0.0.policy.yaml"));

      const client = makeClient({
        pullPolicies: async () => okResponse([policy]),
      });

      const result = await runPolicyPull(
        ["--output-dir", outputDir],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(0);
      expect(result.result?.policies_written).toBe(0);
      expect(result.result?.policies_skipped).toBe(1);

      // Verify the outside file was not overwritten
      const outsideContent = await readFile(outsideFile, "utf-8");
      expect(outsideContent).toBe("should not be overwritten");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
