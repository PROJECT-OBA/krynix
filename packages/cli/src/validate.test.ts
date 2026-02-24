import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runValidate } from "./validate.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-validate-"));
  return tempDir;
}

const VALID_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: test-policy
  version: "1.0.0"
  description: A valid test policy
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: allow-all
      description: Allow all events
      match:
        payload: []
      action: allow
      severity: info
      message: Allowed
`;

describe("runValidate", () => {
  test("valid single policy file returns exit 0", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "good.policy.yaml");
    await writeFile(filePath, VALID_POLICY);

    const result = await runValidate(["--policy", filePath]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.valid).toBe(true);
    expect(result.results[0]?.errors).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  test("invalid policy (missing metadata.name) returns exit 1 with error", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "bad.policy.yaml");
    await writeFile(
      filePath,
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  version: "1.0.0"
  description: Missing name
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`,
    );

    const result = await runValidate(["--policy", filePath]);

    expect(result.exitCode).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.valid).toBe(false);
    expect(result.results[0]?.errors.some((e) => e.includes("metadata.name"))).toBe(true);
  });

  test("invalid YAML syntax returns exit 1", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "broken.policy.yaml");
    await writeFile(filePath, "{% broken yaml");

    const result = await runValidate(["--policy", filePath]);

    expect(result.exitCode).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.valid).toBe(false);
    expect(result.results[0]?.errors.length).toBeGreaterThan(0);
  });

  test("directory with mixed valid/invalid returns exit 1", async () => {
    const dir = await createTempDir();
    const policyDir = join(dir, "policies");
    await mkdir(policyDir);
    await writeFile(join(policyDir, "good.policy.yaml"), VALID_POLICY);
    await writeFile(
      join(policyDir, "bad.policy.yaml"),
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  version: "1.0.0"
  description: Missing name
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`,
    );

    const result = await runValidate(["--policy", policyDir]);

    expect(result.exitCode).toBe(1);
    expect(result.results).toHaveLength(2);

    const good = result.results.find((r) => r.file.includes("good"));
    const bad = result.results.find((r) => r.file.includes("bad"));
    expect(good?.valid).toBe(true);
    expect(bad?.valid).toBe(false);
  });

  test("empty directory returns exit 0 with empty results", async () => {
    const dir = await createTempDir();

    const result = await runValidate(["--policy", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(0);
    expect(result.error).toBeNull();
  });

  test("missing --policy flag returns exit 1 with usage error", async () => {
    const result = await runValidate([]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--policy");
  });

  test("nonexistent path returns exit 1", async () => {
    const result = await runValidate(["--policy", "/nonexistent/policy.yaml"]);

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Path not found");
  });

  test("directory with only non-.policy.yaml files returns exit 0", async () => {
    const dir = await createTempDir();
    await writeFile(join(dir, "readme.md"), "not a policy");
    await writeFile(join(dir, "data.json"), "{}");

    const result = await runValidate(["--policy", dir]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});
