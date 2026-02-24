/**
 * Sprint 3 Review — targeted edge-case and fault-finding tests.
 *
 * These tests exercise edge cases identified during code review.
 * Any FAILING test here indicates a real bug that needs fixing.
 */

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

import { getArg, hasFlag, parseCommand } from "../../packages/cli/src/arg-parser.js";
import { routeCommand } from "../../packages/cli/src/router.js";
import { runReplay } from "../../packages/cli/src/replay.js";
import { runValidate } from "../../packages/cli/src/validate.js";
import { formatReplayResults } from "../../packages/cli/src/format-replay.js";
import { regenerateGoldenDir } from "../../packages/replay/src/replay-runner.js";
import { computeHashChain, canonicalize } from "../../packages/core/src/index.js";
import type { TraceEvent } from "../../packages/core/src/index.js";
import type { ReplayResult } from "../../packages/replay/src/index.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-review-"));
  return tempDir;
}

const BASE = {
  event_id: "evt-000",
  session_id: "test-session",
  sequence_num: 0,
  timestamp: "2025-01-15T14:00:00.000Z",
  parent_id: null,
  agent_id: "test-agent",
  redacted: false,
  prev_hash: "",
  event_hash: "",
  metadata: null,
  schema_version: "1.0.0",
} as const;

function makeValidEvents(): TraceEvent[] {
  return [
    {
      ...BASE,
      sequence_num: 0,
      event_type: "lifecycle",
      payload: { action: "session_start", context: { replay_seed: 42 } },
    } as unknown as TraceEvent,
    {
      ...BASE,
      event_id: "evt-001",
      sequence_num: 1,
      event_type: "tool_call",
      payload: { tool_name: "file_read", arguments: { path: "/tmp/test.txt" } },
    } as unknown as TraceEvent,
    {
      ...BASE,
      event_id: "evt-002",
      sequence_num: 2,
      event_type: "lifecycle",
      payload: { action: "session_end" },
    } as unknown as TraceEvent,
  ];
}

async function writeTrace(dir: string, filename: string): Promise<string> {
  const chained = computeHashChain(makeValidEvents());
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  const filePath = join(dir, filename);
  await writeFile(filePath, lines.join("\n") + "\n");
  return filePath;
}

// ============================================================================
// EDGE CASE 1: getArg — flag value that looks like another flag
// ============================================================================

describe("getArg edge cases", () => {
  test("returns a value that starts with -- if it follows the flag", () => {
    // getArg(["--trace", "--verbose"], "--trace") should return "--verbose"
    // because it blindly returns args[idx+1] with no flag-detection.
    // This is consistent behavior (no special-casing) but worth documenting.
    const result = getArg(["--trace", "--verbose"], "--trace");
    expect(result).toBe("--verbose");
  });

  test("returns first occurrence when flag appears multiple times", () => {
    const result = getArg(["--policy", "a.yaml", "--policy", "b.yaml"], "--policy");
    expect(result).toBe("a.yaml");
  });

  test("handles empty string flag value", () => {
    const result = getArg(["--trace", ""], "--trace");
    expect(result).toBe("");
  });
});

// ============================================================================
// EDGE CASE 2: parseCommand — flag value eaten as command
// ============================================================================

describe("parseCommand edge cases", () => {
  test("flag value that doesn't start with -- is treated as command", () => {
    // parseCommand(["--trace", "myfile.jsonl"]) — "myfile.jsonl" is a value,
    // not a positional, but parseCommand sees it as the command because it
    // doesn't start with --.
    // This is EXPECTED because parseCommand cannot know which flags take values.
    // The router only calls parseCommand on the full argv before dispatching.
    const result = parseCommand(["--trace", "myfile.jsonl"]);
    expect(result.command).toBe("myfile.jsonl");
  });

  test("handles single-dash args as positional (non-flag)", () => {
    const result = parseCommand(["-v"]);
    expect(result.command).toBe("-v");
  });
});

// ============================================================================
// EDGE CASE 3: router priority — --version with subcommand
// ============================================================================

describe("router priority edge cases", () => {
  test("--version takes priority even with a valid subcommand", async () => {
    const result = await routeCommand(["evaluate", "--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^krynix \d+\.\d+\.\d+/);
  });

  test("--version takes priority even with --help", async () => {
    const result = await routeCommand(["--version", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^krynix \d+\.\d+\.\d+/);
  });

  test("unknown command with --help still shows help for unknown command (falls through)", async () => {
    // "foobar --help" — foobar is parsed as command, --help is in rest.
    // getCommandHelp("foobar") returns undefined, so the help branch
    // falls through to the command switch, hitting the default case.
    const result = await routeCommand(["foobar", "--help"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });

  test("only unrecognized flags (no command) returns exit 1 with help", async () => {
    const result = await routeCommand(["--foobar"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown arguments");
  });
});

// ============================================================================
// EDGE CASE 4: replay --verbose during regenerate (ignored silently)
// ============================================================================

describe("replay --verbose in regenerate mode", () => {
  test("--verbose is silently ignored during --regenerate (no verboseLines)", async () => {
    const dir = await createTempDir();
    await writeTrace(dir, "valid.trace.jsonl");

    const result = await runReplay([
      "--regenerate",
      "--verbose",
      "--trace",
      join(dir, "valid.trace.jsonl"),
    ]);

    expect(result.exitCode).toBe(0);
    // --verbose is not wired in handleRegenerate, so verboseLines should be absent
    expect(result.verboseLines).toBeUndefined();
  });
});

// ============================================================================
// EDGE CASE 5: replay --trace + --golden-dir combined
// ============================================================================

describe("replay --trace + --golden-dir combined", () => {
  test("verify processes both --trace and --golden-dir when both provided", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "single.trace.jsonl");

    const goldenDir = join(dir, "golden");
    await mkdir(goldenDir);
    await writeTrace(goldenDir, "a.trace.jsonl");
    await writeTrace(goldenDir, "b.trace.jsonl");

    const result = await runReplay([
      "--verify",
      "--trace",
      tracePath,
      "--golden-dir",
      goldenDir,
    ]);

    // Should include the single trace + 2 golden dir traces = 3 results
    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(3);
  });

  test("regenerate processes both --trace and --golden-dir", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir, "single.trace.jsonl");

    const goldenDir = join(dir, "golden");
    await mkdir(goldenDir);
    await writeTrace(goldenDir, "a.trace.jsonl");

    const result = await runReplay([
      "--regenerate",
      "--trace",
      tracePath,
      "--golden-dir",
      goldenDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(2);
  });
});

// ============================================================================
// EDGE CASE 6: validate with a single non-.policy.yaml file
// ============================================================================

describe("validate edge cases", () => {
  test("single file that is not named .policy.yaml still gets validated", async () => {
    const dir = await createTempDir();
    const filePath = join(dir, "rules.yaml");
    await writeFile(
      filePath,
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: test
  version: "1.0.0"
  description: test
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`,
    );

    const result = await runValidate(["--policy", filePath]);

    // Single file mode doesn't filter by extension — it validates whatever you pass
    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.valid).toBe(true);
  });

  test("directory mode requires .policy.yaml extension", async () => {
    const dir = await createTempDir();
    await writeFile(
      join(dir, "rules.yaml"),
      `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: test
  version: "1.0.0"
  description: test
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules: []
`,
    );

    const result = await runValidate(["--policy", dir]);

    // rules.yaml is not *.policy.yaml so directory mode skips it
    expect(result.exitCode).toBe(0);
    expect(result.results).toHaveLength(0);
  });
});

// ============================================================================
// EDGE CASE 7: regenerateGoldenDir with nonexistent directory
// ============================================================================

describe("regenerateGoldenDir edge cases", () => {
  test("nonexistent directory returns error result", async () => {
    const results = await regenerateGoldenDir("/nonexistent/dir");

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("error");
  });
});

// ============================================================================
// EDGE CASE 8: formatReplayResults with diverged but no report
// ============================================================================

describe("formatReplayResults edge cases", () => {
  test("diverged result with no report shows file only", () => {
    const result: ReplayResult = {
      file: "test.trace.jsonl",
      status: "diverged",
    };

    const lines = formatReplayResults([result]);

    expect(lines.some((l) => l.includes("[DIVERGED]"))).toBe(true);
    expect(lines.some((l) => l.includes("test.trace.jsonl"))).toBe(true);
  });

  test("error result with no validationErrors shows file only", () => {
    const result: ReplayResult = {
      file: "test.trace.jsonl",
      status: "error",
    };

    const lines = formatReplayResults([result]);

    expect(lines.some((l) => l.includes("[ERROR]"))).toBe(true);
    // Should not crash when validationErrors is undefined
    expect(lines.some((l) => l.includes("test.trace.jsonl"))).toBe(true);
  });

  test("pass result with no report shows 0 events", () => {
    const result: ReplayResult = {
      file: "test.trace.jsonl",
      status: "pass",
    };

    const lines = formatReplayResults([result]);

    expect(lines.some((l) => l.includes("[PASS]"))).toBe(true);
    expect(lines.some((l) => l.includes("0 events"))).toBe(true);
  });
});

// ============================================================================
// EDGE CASE 9: router — evaluate command error goes to stderr
// ============================================================================

describe("router error routing", () => {
  test("evaluate missing --trace puts error in stderr", async () => {
    const result = await routeCommand(["evaluate"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--trace");
    expect(result.stdout).toBe("");
  });

  test("validate missing --policy puts error in stderr", async () => {
    const result = await routeCommand(["validate"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--policy");
    expect(result.stdout).toBe("");
  });

  test("replay missing args puts error in stderr", async () => {
    const result = await routeCommand(["replay"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--trace or --golden-dir");
  });
});

// ============================================================================
// EDGE CASE 10: router — replay verbose output goes to stderr
// ============================================================================

describe("router verbose output routing", () => {
  test("replay verbose lines go to stderr, JSON results go to stdout", async () => {
    const dir = await createTempDir();
    await writeTrace(dir, "valid.trace.jsonl");

    const result = await routeCommand([
      "replay",
      "--verbose",
      "--verify",
      "--trace",
      join(dir, "valid.trace.jsonl"),
    ]);

    expect(result.exitCode).toBe(0);

    // stdout should be valid JSON (the results array)
    expect(() => JSON.parse(result.stdout)).not.toThrow();

    // stderr should contain the verbose PASS line
    expect(result.stderr).toContain("[PASS]");
  });
});
