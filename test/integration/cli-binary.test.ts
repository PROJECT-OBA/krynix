/**
 * CLI Binary Subprocess Tests
 *
 * Tests the Krynix CLI as a built binary (`packages/cli/dist/main.js`)
 * by spawning child processes. Verifies I/O, exit codes, and JSON output.
 *
 * Requires `pnpm build` before running. Skips if build output not found.
 *
 * @module
 */

import { describe, test, expect, beforeAll } from "vitest";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";

const CLI_TIMEOUT_MS = 30_000;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "../../packages/cli/dist/main.js");
const GOLDEN_DIR = resolve(__dirname, "../golden");
const POLICY_PATH = resolve(
  __dirname,
  "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml",
);

let cliAvailable = false;

beforeAll(async () => {
  try {
    await access(CLI_PATH);
    cliAvailable = true;
  } catch {
    // CLI not built — tests will skip
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), CLI_TIMEOUT_MS);

    const child = spawn("node", [CLI_PATH, ...args], {
      env: { ...process.env, NO_COLOR: "1" },
      signal: ac.signal,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8").trim(),
        stderr: Buffer.concat(stderrChunks).toString("utf-8").trim(),
      });
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8").trim(),
        stderr: "Process killed: timeout or abort",
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI Binary", () => {
  test("--version outputs version string", async () => {
    if (!cliAvailable) return;

    const result = await runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^krynix \d+\.\d+\.\d+/);
  });

  test("--help outputs usage info", async () => {
    if (!cliAvailable) return;

    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("krynix");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("Local Commands");
  });

  test("unknown command exits 1 with error", async () => {
    if (!cliAvailable) return;

    const result = await runCli(["foobar"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command: foobar");
  });

  test("stats outputs valid JSON with correct fields", async () => {
    if (!cliAvailable) return;

    const tracePath = resolve(GOLDEN_DIR, "minimal.trace.jsonl");
    const result = await runCli(["stats", "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    const stats = JSON.parse(result.stdout);
    expect(stats.event_count).toBe(3);
    expect(stats.tool_call_count).toBe(1);
    expect(typeof stats.duration_ms).toBe("number");
  });

  test("validate accepts valid policy", async () => {
    if (!cliAvailable) return;

    const result = await runCli(["validate", "--policy", POLICY_PATH]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  test("replay verify passes on golden trace", async () => {
    if (!cliAvailable) return;

    const tracePath = resolve(GOLDEN_DIR, "minimal.trace.jsonl");
    const result = await runCli(["replay", "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    const results = JSON.parse(result.stdout);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].status).toBe("pass");
  });

  test("evaluate with deny policy exits > 0", async () => {
    if (!cliAvailable) return;

    const tracePath = resolve(GOLDEN_DIR, "policy-violation.trace.jsonl");
    const result = await runCli(["evaluate", "--trace", tracePath, "--policy", POLICY_PATH]);

    expect(result.exitCode).toBeGreaterThan(0);
    const output = JSON.parse(result.stdout);
    expect(output).toBeDefined();
  });

  test("evaluate with allowed events exits 0", async () => {
    if (!cliAvailable) return;

    const tracePath = resolve(GOLDEN_DIR, "minimal.trace.jsonl");
    const result = await runCli(["evaluate", "--trace", tracePath, "--policy", POLICY_PATH]);

    // minimal trace has only file_read (tool_call), which is allowed
    expect(result.exitCode).toBe(0);
  });

  test("export otlp-json produces JSON output", async () => {
    if (!cliAvailable) return;

    const tracePath = resolve(GOLDEN_DIR, "minimal.trace.jsonl");
    const result = await runCli(["export", "--trace", tracePath, "--format", "otlp-json"]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toBeDefined();
  });

  test("policy test validates a policy file", async () => {
    if (!cliAvailable) return;

    const tracePath = resolve(GOLDEN_DIR, "minimal.trace.jsonl");
    const result = await runCli(["policy", "test", "--policy", POLICY_PATH, "--trace", tracePath]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toBeDefined();
  });

  test("missing file produces error", async () => {
    if (!cliAvailable) return;

    const result = await runCli(["stats", "--trace", "/nonexistent/path.trace.jsonl"]);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
