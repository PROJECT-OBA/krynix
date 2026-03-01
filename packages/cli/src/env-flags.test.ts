import { describe, test, expect } from "vitest";
import { parseEnvFlags, buildEnvironmentContext } from "./env-flags.js";

// ---------------------------------------------------------------------------
// parseEnvFlags
// ---------------------------------------------------------------------------

describe("parseEnvFlags", () => {
  test("parses key=value pairs", () => {
    const result = parseEnvFlags(["--env", "git_sha=abc123", "--env", "custom=val"]);
    expect(result).toEqual({ git_sha: "abc123", custom: "val" });
  });

  test("rejects key with no = separator", () => {
    expect(() => parseEnvFlags(["--env", "noequals"])).toThrow('missing "=" separator');
  });

  test("handles value containing = signs", () => {
    const result = parseEnvFlags(["--env", "url=https://example.com?a=1&b=2"]);
    expect(result).toEqual({ url: "https://example.com?a=1&b=2" });
  });

  test("rejects empty key", () => {
    expect(() => parseEnvFlags(["--env", "=value"])).toThrow("empty key");
  });

  test("returns empty object when no --env flags", () => {
    const result = parseEnvFlags(["--trace", "file.jsonl"]);
    expect(result).toEqual({});
  });

  test("handles empty value after =", () => {
    const result = parseEnvFlags(["--env", "key="]);
    expect(result).toEqual({ key: "" });
  });
});

// ---------------------------------------------------------------------------
// buildEnvironmentContext
// ---------------------------------------------------------------------------

describe("buildEnvironmentContext", () => {
  test("returns undefined when not in CI and no --env flags", () => {
    // Pass an empty env map to simulate a non-CI environment deterministically
    const result = buildEnvironmentContext(["--trace", "file.jsonl"], {});
    expect(result).toBeUndefined();
  });

  test("returns EnvironmentContext when in CI even without --env flags", () => {
    const ciEnv = { GITHUB_ACTIONS: "true", GITHUB_SHA: "abc", GITHUB_REF: "refs/heads/main" };
    const result = buildEnvironmentContext(["--trace", "file.jsonl"], ciEnv);
    expect(result).toBeDefined();
    expect(result?.ci_provider).toBe("github-actions");
  });

  test("places known fields in EnvironmentContext fields", () => {
    const result = buildEnvironmentContext(
      ["--env", "git_sha=abc123", "--env", "ci_provider=custom-ci"],
      {},
    );

    expect(result).toBeDefined();
    expect(result?.git_sha).toBe("abc123");
    expect(result?.ci_provider).toBe("custom-ci");
  });

  test("places unknown keys in extra", () => {
    const result = buildEnvironmentContext(
      ["--env", "git_sha=abc123", "--env", "deploy_env=staging"],
      {},
    );

    expect(result).toBeDefined();
    expect(result?.extra?.deploy_env).toBe("staging");
  });
});
