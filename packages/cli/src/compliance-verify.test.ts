import { describe, test, expect } from "vitest";
import { runComplianceVerify, type ComplianceVerifyDeps } from "./compliance-verify.js";
import type { BundleVerificationResult } from "@krynix/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validResult(): BundleVerificationResult {
  return {
    valid: true,
    manifest_found: true,
    artifact_count: 3,
    verified_count: 3,
    errors: [],
  };
}

function invalidResult(): BundleVerificationResult {
  return {
    valid: false,
    manifest_found: true,
    artifact_count: 3,
    verified_count: 2,
    errors: [
      {
        artifact_path: "traces/sess-1.trace.jsonl",
        expected_digest: "sha256:aaa",
        actual_digest: "sha256:bbb",
        error_type: "digest_mismatch",
      },
    ],
  };
}

function makeDeps(overrides: Partial<ComplianceVerifyDeps> = {}): Partial<ComplianceVerifyDeps> {
  return {
    verifyBundle: async () => validResult(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runComplianceVerify", () => {
  test("errors when --dir is missing", async () => {
    const result = await runComplianceVerify([], makeDeps());
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--dir");
  });

  test("outputs JSON with valid result and exit code 0", async () => {
    const result = await runComplianceVerify(["--dir", "/tmp/bundle"], makeDeps());

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toBeNull();
    expect(result.output?.valid).toBe(true);
    expect(result.output?.artifact_count).toBe(3);
    expect(result.output?.verified_count).toBe(3);
  });

  test("outputs JSON with invalid result and exit code 1", async () => {
    const result = await runComplianceVerify(
      ["--dir", "/tmp/bundle"],
      makeDeps({ verifyBundle: async () => invalidResult() }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).not.toBeNull();
    expect(result.output?.valid).toBe(false);
    expect(result.output?.errors).toHaveLength(1);
    expect(result.output?.errors[0]?.error_type).toBe("digest_mismatch");
  });

  test("handles thrown error from verifier", async () => {
    const result = await runComplianceVerify(
      ["--dir", "/nonexistent"],
      makeDeps({
        verifyBundle: async () => {
          throw new Error("Bundle directory does not exist: /nonexistent");
        },
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.output).toBeNull();
    expect(result.error).toContain("does not exist");
  });
});
