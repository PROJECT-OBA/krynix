import { describe, test, expect } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
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
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PolicyPullDeps> = {}): Partial<PolicyPullDeps> {
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
});
