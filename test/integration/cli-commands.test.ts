/**
 * CLI function integration tests.
 *
 * Calls the CLI command functions directly (not subprocess), verifying
 * cross-package integration at the CLI layer.
 */

import { describe, test, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runEvaluate,
  runReplay,
  runValidate,
} from "../../packages/cli/src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(__dirname, "../golden");
const POLICY_DIR = resolve(__dirname, "../../packages/adapter-openclaw/policies");
const DEFAULT_POLICY = resolve(POLICY_DIR, "openclaw-default.policy.yaml");
const MINIMAL_TRACE = resolve(GOLDEN_DIR, "minimal.trace.jsonl");
const OPENCLAW_TRACE = resolve(GOLDEN_DIR, "openclaw-minimal.trace.jsonl");

describe("CLI integration", () => {
  test("evaluate openclaw trace + policy → exit 2 (critical deny on shell_exec)", async () => {
    const result = await runEvaluate([
      "--trace",
      OPENCLAW_TRACE,
      "--policy",
      DEFAULT_POLICY,
    ]);

    // openclaw-default.policy.yaml denies shell_exec with severity: critical (exit 2)
    expect(result.exitCode).toBe(2);
    expect(result.output?.verdict).toBe("fail");
  });

  test("replay verify with golden dir → exit 0", async () => {
    const result = await runReplay(["--verify", "--golden-dir", GOLDEN_DIR]);

    expect(result.exitCode).toBe(0);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results.every((r) => r.status === "pass")).toBe(true);
  });

  test("replay with nonexistent dir → exit 1", async () => {
    const result = await runReplay(["--verify", "--golden-dir", "/nonexistent/dir"]);

    expect(result.exitCode).toBe(1);
  });

  test("validate openclaw default policy → exit 0", async () => {
    const result = await runValidate(["--policy", DEFAULT_POLICY]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.valid).toBe(true);
  });

  test("replay verbose with golden trace shows PASS lines", async () => {
    const result = await runReplay([
      "--verbose",
      "--verify",
      "--trace",
      MINIMAL_TRACE,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.verboseLines).toBeDefined();
    const lines = result.verboseLines ?? [];
    expect(lines.some((l) => l.includes("[PASS]"))).toBe(true);
  });

  test("evaluate minimal trace + allow-all policy → exit 0", async () => {
    const result = await runEvaluate([
      "--trace",
      MINIMAL_TRACE,
      "--policy",
      POLICY_DIR,
    ]);

    // The openclaw-default policy only scopes to tool_call events.
    // The minimal trace has a file_read tool_call which is allowed (default unmatched_action: allow)
    // and a shell_exec which doesn't exist in minimal — so it should pass
    // Actually the openclaw-default denies shell_exec. The minimal trace has file_read which
    // is unmatched → allowed. So exit 0.
    expect(result.exitCode).toBe(0);
  });
});
