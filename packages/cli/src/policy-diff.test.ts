import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runPolicyDiff } from "./policy-diff.js";
import type { PolicyDiff } from "@krynix/policy";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-policy-diff-"));
  return tempDir;
}

const BASE_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: test-policy
  version: "1.0.0"
  description: A test policy
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: rule-1
      description: Test rule
      match:
        payload: []
      action: deny
      severity: error
      message: Denied
`;

function withChanges(overrides: {
  name?: string;
  version?: string;
  description?: string;
  action?: string;
  severity?: string;
  extraRule?: boolean;
  removeRule?: boolean;
}): string {
  const rules = [];
  if (!overrides.removeRule) {
    rules.push(`    - id: rule-1
      description: Test rule
      match:
        payload: []
      action: ${overrides.action ?? "deny"}
      severity: ${overrides.severity ?? "error"}
      message: Denied`);
  }
  if (overrides.extraRule) {
    rules.push(`    - id: rule-2
      description: Extra rule
      match:
        payload: []
      action: allow
      severity: info
      message: Allowed`);
  }
  return `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: ${overrides.name ?? "test-policy"}
  version: "${overrides.version ?? "1.0.0"}"
  description: ${overrides.description ?? "A test policy"}
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
${rules.join("\n")}
`;
}

describe("runPolicyDiff", () => {
  test("identical policies → exit 0, hasChanges: false", async () => {
    const dir = await createTempDir();
    const oldPath = join(dir, "old.policy.yaml");
    const newPath = join(dir, "new.policy.yaml");
    await writeFile(oldPath, BASE_POLICY);
    await writeFile(newPath, BASE_POLICY);

    const result = await runPolicyDiff(["--old", oldPath, "--new", newPath]);
    expect(result.exitCode).toBe(0);
    expect(result.result).not.toBeNull();
    expect(result.result?.hasChanges).toBe(false);
  });

  test("severity downgrade → exit 2", async () => {
    const dir = await createTempDir();
    const oldPath = join(dir, "old.policy.yaml");
    const newPath = join(dir, "new.policy.yaml");
    await writeFile(oldPath, BASE_POLICY);
    await writeFile(newPath, withChanges({ severity: "warning" }));

    const result = await runPolicyDiff(["--old", oldPath, "--new", newPath]);
    expect(result.exitCode).toBe(2);
    expect(result.result?.hasSeverityDowngrade).toBe(true);
  });

  test("action weakening → exit 2", async () => {
    const dir = await createTempDir();
    const oldPath = join(dir, "old.policy.yaml");
    const newPath = join(dir, "new.policy.yaml");
    await writeFile(oldPath, BASE_POLICY);
    await writeFile(newPath, withChanges({ action: "allow" }));

    const result = await runPolicyDiff(["--old", oldPath, "--new", newPath]);
    expect(result.exitCode).toBe(2);
    expect(result.result?.hasActionWeakening).toBe(true);
  });

  test("minor change (description only) → exit 0, hasChanges: true", async () => {
    const dir = await createTempDir();
    const oldPath = join(dir, "old.policy.yaml");
    const newPath = join(dir, "new.policy.yaml");
    await writeFile(oldPath, BASE_POLICY);
    await writeFile(newPath, withChanges({ description: "Updated description" }));

    const result = await runPolicyDiff(["--old", oldPath, "--new", newPath]);
    expect(result.exitCode).toBe(0);
    expect(result.result?.hasChanges).toBe(true);
    expect(result.result?.metadata.descriptionChanged).toBe(true);
  });

  test("missing --old → exit 1, error", async () => {
    const result = await runPolicyDiff(["--new", "/some/path"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--old");
  });

  test("missing --new → exit 1, error", async () => {
    const result = await runPolicyDiff(["--old", "/some/path"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--new");
  });

  test("nonexistent policy file → exit 1, error", async () => {
    const dir = await createTempDir();
    const oldPath = join(dir, "old.policy.yaml");
    await writeFile(oldPath, BASE_POLICY);

    const result = await runPolicyDiff(["--old", oldPath, "--new", "/nonexistent/policy.yaml"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read new policy");
  });

  test("output contains full diff structure", async () => {
    const dir = await createTempDir();
    const oldPath = join(dir, "old.policy.yaml");
    const newPath = join(dir, "new.policy.yaml");
    await writeFile(oldPath, BASE_POLICY);
    await writeFile(newPath, withChanges({ extraRule: true }));

    const result = await runPolicyDiff(["--old", oldPath, "--new", newPath]);
    expect(result.exitCode).toBe(0);

    const diff = result.result as PolicyDiff;
    expect(diff.hasChanges).toBe(true);
    expect(diff.rules.added).toContain("rule-2");
  });
});
