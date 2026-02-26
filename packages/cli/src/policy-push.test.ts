import { describe, test, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runPolicyPush, type PolicyPushDeps } from "./policy-push.js";
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

const VALID_POLICY_YAML = `apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: test-policy
  version: "1.0.0"
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`;

function okResponse<T>(data: T): ApiResponse<T> {
  return { ok: true, status: 201, data, error: null };
}

function makeClient(overrides: Partial<ControlPlaneClient> = {}): ControlPlaneClient {
  return {
    pushTrace: async () => ({ ok: true, status: 200, data: {}, error: null }),
    pushEvaluation: async () => ({ ok: true, status: 200, data: {}, error: null }),
    pushReplayReport: async () => ({ ok: true, status: 200, data: {}, error: null }),
    pullPolicies: async () => ({ ok: true, status: 200, data: [], error: null }),
    pushPolicy: async () => okResponse({ name: "test-policy", version: "1.0.0" }),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<PolicyPushDeps> = {}): Partial<PolicyPushDeps> {
  return {
    loadConfig: () => TEST_CONFIG,
    loadCredentials: () => TEST_CREDS,
    createClient: () => makeClient(),
    parsePolicy: (_yaml: string) => ({
      metadata: { name: "test-policy", version: "1.0.0" },
    }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPolicyPush", () => {
  test("errors when --file flag is missing", async () => {
    const result = await runPolicyPush([], makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--file");
  });

  test("errors when config is missing", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-ppush-"));
    try {
      const filePath = join(tmpDir, "policy.yaml");
      await writeFile(filePath, VALID_POLICY_YAML, "utf-8");

      const result = await runPolicyPush(
        ["--file", filePath],
        makeDeps({ loadConfig: () => null }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("not configured");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("errors when credentials are missing", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-ppush-"));
    try {
      const filePath = join(tmpDir, "policy.yaml");
      await writeFile(filePath, VALID_POLICY_YAML, "utf-8");

      const result = await runPolicyPush(
        ["--file", filePath],
        makeDeps({ loadCredentials: () => null }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Not authenticated");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("errors when token is expired", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-ppush-"));
    try {
      const filePath = join(tmpDir, "policy.yaml");
      await writeFile(filePath, VALID_POLICY_YAML, "utf-8");

      const expiredCreds: Credentials = {
        token: "expired-token",
        expires_at: "2020-01-01T00:00:00Z",
      };
      const result = await runPolicyPush(
        ["--file", filePath],
        makeDeps({ loadCredentials: () => expiredCreds }),
      );
      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("expired");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("publishes policy successfully", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-ppush-"));
    try {
      const filePath = join(tmpDir, "policy.yaml");
      await writeFile(filePath, VALID_POLICY_YAML, "utf-8");

      const result = await runPolicyPush(["--file", filePath], makeDeps());

      expect(result.exitCode).toBe(0);
      expect(result.result).not.toBeNull();
      expect(result.result?.published).toBe(true);
      expect(result.result?.name).toBe("test-policy");
      expect(result.result?.version).toBe("1.0.0");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("sends changelog when provided", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-ppush-"));
    try {
      const filePath = join(tmpDir, "policy.yaml");
      await writeFile(filePath, VALID_POLICY_YAML, "utf-8");

      let capturedChangelog: string | undefined;
      const client = makeClient({
        pushPolicy: async (_yaml, changelog) => {
          capturedChangelog = changelog;
          return okResponse({ name: "test-policy", version: "1.0.0" });
        },
      });

      await runPolicyPush(
        ["--file", filePath, "--changelog", "Added new rule"],
        makeDeps({ createClient: () => client }),
      );

      expect(capturedChangelog).toBe("Added new rule");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("errors when policy validation fails", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-ppush-"));
    try {
      const filePath = join(tmpDir, "bad-policy.yaml");
      await writeFile(filePath, "not a valid policy", "utf-8");

      const result = await runPolicyPush(
        ["--file", filePath],
        makeDeps({
          parsePolicy: () => {
            throw new Error("Invalid policy schema");
          },
        }),
      );

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Invalid policy file");
      expect(result.error).toContain("Invalid policy schema");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("errors when API rejects the push", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-ppush-"));
    try {
      const filePath = join(tmpDir, "policy.yaml");
      await writeFile(filePath, VALID_POLICY_YAML, "utf-8");

      const client = makeClient({
        pushPolicy: async () => ({
          ok: false,
          status: 409,
          data: null,
          error: "Conflict: version exists",
        }),
      });

      const result = await runPolicyPush(
        ["--file", filePath],
        makeDeps({ createClient: () => client }),
      );

      expect(result.exitCode).toBe(1);
      expect(result.error).toContain("Conflict");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("handles non-existent file", async () => {
    const result = await runPolicyPush(["--file", "/nonexistent/policy.yaml"], makeDeps());

    expect(result.exitCode).toBe(1);
    expect(result.error).toBeTruthy();
  });
});
