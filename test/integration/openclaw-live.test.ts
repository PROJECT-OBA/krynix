/**
 * Live OpenClaw Integration Test
 *
 * Source-of-truth test: events flow through OpenClaw's real `createHookRunner`
 * dispatch system → Krynix plugin hooks → adapter → session → trace file.
 * No hand-crafted OpenClawHookEvent objects — hooks fire through the real
 * dispatch mechanism.
 *
 * Requires OpenClaw repo to be available locally. Skips gracefully when
 * OpenClaw is not found (CI-safe).
 *
 * Set OPENCLAW_PATH env var to point to OpenClaw repo, or place it at
 * the default sibling location (../../../../openclaw relative to this file).
 *
 * @module
 */

import { describe, test, expect, afterEach, beforeAll } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  readTrace,
  validateHashChain,
  runEvaluationPipeline,
} from "../../packages/core/src/index.js";
import type { TraceEvent, EvaluationPipelineDeps } from "../../packages/core/src/index.js";
import { parsePolicy, evaluate } from "../../packages/policy/src/index.js";
import type { Policy, Violation } from "../../packages/policy/src/index.js";
import { verifyTrace } from "../../packages/replay/src/index.js";
import { createKrynixPlugin } from "../../packages/adapter-openclaw/src/plugin.js";
import type { KrynixPluginHandle } from "../../packages/adapter-openclaw/src/plugin.js";

// ---------------------------------------------------------------------------
// OpenClaw import — dynamic, with graceful skip
// ---------------------------------------------------------------------------

const OPENCLAW_PATH =
  process.env["OPENCLAW_PATH"] ?? join(import.meta.dirname, "../../../../openclaw");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createHookRunner: any;
let openclawAvailable = false;

beforeAll(async () => {
  try {
    const hooksModule = await import(
      pathToFileURL(join(OPENCLAW_PATH, "src/plugins/hooks.ts")).href
    );
    createHookRunner = hooksModule.createHookRunner;
    openclawAvailable = true;
  } catch {
    // OpenClaw not available — all tests will skip
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;
let handle: KrynixPluginHandle | null = null;

afterEach(async () => {
  if (handle) {
    try {
      await handle.shutdown();
    } catch {
      // May already be shut down
    }
    handle = null;
  }
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-openclaw-live-"));
  return tempDir;
}

/**
 * Create a minimal PluginRegistry matching OpenClaw's expected shape.
 * Only the `typedHooks` array is needed for hook dispatch.
 */
function createMinimalRegistry(): { typedHooks: unknown[] } & Record<string, unknown> {
  return {
    plugins: [],
    tools: [],
    hooks: [],
    typedHooks: [],
    channels: [],
    providers: [],
    gatewayHandlers: { get: [], post: [], put: [], delete: [] },
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    commands: [],
    diagnostics: [],
  };
}

/**
 * Create a mock `api.on()` that pushes handlers to the registry's typedHooks.
 * This replicates what OpenClaw's `registerTypedHook` does internally:
 * `registry.typedHooks.push({ pluginId, hookName, handler, priority, source })`.
 */
function createPluginApi(registry: ReturnType<typeof createMinimalRegistry>) {
  return {
    on(
      hookName: string,
      handler: (event: unknown, context: unknown) => unknown | Promise<unknown>,
      opts?: { priority?: number },
    ): void {
      registry.typedHooks.push({
        pluginId: "krynix",
        hookName,
        handler,
        priority: opts?.priority ?? 0,
        source: "krynix-plugin",
      });
    },
  };
}

/**
 * Fire a realistic hook sequence through OpenClaw's real hook runner.
 * Includes: session_start, file_read (before+after), shell_exec (before+after),
 * llm_input, llm_output, session_end.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fireHooksViaRunner(runner: any): Promise<void> {
  await runner.runSessionStart(
    { sessionId: "oc-live-e2e" },
    { agentId: "live-test-agent", sessionId: "oc-live-e2e" },
  );

  await runner.runBeforeToolCall(
    { toolName: "file_read", params: { path: "/src/index.ts" } },
    { agentId: "live-test-agent", sessionKey: "sk1", toolName: "file_read" },
  );

  await runner.runAfterToolCall(
    {
      toolName: "file_read",
      params: { path: "/src/index.ts" },
      result: "file contents here",
      durationMs: 12,
    },
    { agentId: "live-test-agent", sessionKey: "sk1", toolName: "file_read" },
  );

  await runner.runBeforeToolCall(
    { toolName: "shell_exec", params: { command: "rm -rf /" } },
    { agentId: "live-test-agent", sessionKey: "sk2", toolName: "shell_exec" },
  );

  await runner.runAfterToolCall(
    {
      toolName: "shell_exec",
      params: { command: "rm -rf /" },
      error: "blocked by policy",
      durationMs: 0,
    },
    { agentId: "live-test-agent", sessionKey: "sk2", toolName: "shell_exec" },
  );

  await runner.runLlmInput(
    {
      runId: "r1",
      sessionId: "oc-live-e2e",
      provider: "openai",
      model: "gpt-4",
      prompt: "Hello",
      historyMessages: [],
      imagesCount: 0,
    },
    { agentId: "live-test-agent", sessionId: "oc-live-e2e" },
  );

  await runner.runLlmOutput(
    {
      runId: "r1",
      sessionId: "oc-live-e2e",
      provider: "openai",
      model: "gpt-4",
      assistantTexts: ["Hi there"],
      usage: { input: 10, output: 5 },
    },
    { agentId: "live-test-agent", sessionId: "oc-live-e2e" },
  );

  await runner.runSessionEnd(
    { sessionId: "oc-live-e2e", messageCount: 3, durationMs: 500 },
    { agentId: "live-test-agent", sessionId: "oc-live-e2e" },
  );
}

/**
 * Build real pipeline deps that wire @krynix/policy + @krynix/replay.
 */
function createRealDeps(tracePath: string): EvaluationPipelineDeps {
  return {
    evaluatePolicy: async (events: readonly TraceEvent[], policy: unknown) => {
      const p = policy as Policy;
      const result = evaluate([...events], p);
      return {
        policyName: p.metadata.name,
        verdict: result.verdict,
        exitCode: result.exitCode,
        violations: result.violations,
      };
    },
    verifyReplay: async (_events: readonly TraceEvent[]) => {
      const result = await verifyTrace(tracePath);
      return {
        valid: result.status === "pass",
        exitCode: result.status === "pass" ? 0 : 1,
        details: result,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests — all skip when OpenClaw is not available
// ---------------------------------------------------------------------------

describe("Live OpenClaw Integration", () => {
  test("live: hooks → trace file with valid hash chain", async () => {
    if (!openclawAvailable) {
      return; // skip
    }

    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");

    // Create registry + plugin api + plugin
    const registry = createMinimalRegistry();
    const api = createPluginApi(registry);
    const initPlugin = createKrynixPlugin({
      outputPath,
      replaySeed: 42,
      agentId: "live-test-agent",
    });
    handle = await initPlugin(api);

    // Create hook runner from OpenClaw's real implementation
    const runner = createHookRunner(registry, { catchErrors: false });

    // Fire hooks through OpenClaw's real dispatch
    await fireHooksViaRunner(runner);

    // Read and validate trace
    const events = await readTrace(outputPath);

    // session_start(auto) + session_start(hook) + before_tool_call(file_read)
    // + after_tool_call(file_read) + before_tool_call(shell_exec) + after_tool_call(shell_exec)
    // + llm_input + llm_output + session_end(hook lifecycle) + session_end(auto) = 10
    expect(events.length).toBe(10);

    const chainResult = validateHashChain(events);
    expect(chainResult.valid).toBe(true);
  });

  test("live: policy evaluation on real trace → shell_exec denied", async () => {
    if (!openclawAvailable) {
      return;
    }

    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");

    const registry = createMinimalRegistry();
    const api = createPluginApi(registry);
    const initPlugin = createKrynixPlugin({
      outputPath,
      replaySeed: 42,
      agentId: "live-test-agent",
    });
    handle = await initPlugin(api);

    const runner = createHookRunner(registry, { catchErrors: false });
    await fireHooksViaRunner(runner);

    // Load real policy and evaluate
    const policyYaml = await readFile(
      join(
        import.meta.dirname,
        "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml",
      ),
      "utf-8",
    );
    const policy = parsePolicy(policyYaml);
    const events = await readTrace(outputPath);
    const result = evaluate(events, policy);

    // shell_exec events should trigger critical deny
    expect(result.exitCode).toBeGreaterThan(0);
    const shellViolations = result.violations.filter(
      (v: Violation) => v.ruleId === "deny-shell-exec",
    );
    expect(shellViolations.length).toBeGreaterThan(0);
    expect(shellViolations[0]?.severity).toBe("critical");
  });

  test("live: replay verification passes", async () => {
    if (!openclawAvailable) {
      return;
    }

    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");

    const registry = createMinimalRegistry();
    const api = createPluginApi(registry);
    const initPlugin = createKrynixPlugin({
      outputPath,
      replaySeed: 42,
      agentId: "live-test-agent",
    });
    handle = await initPlugin(api);

    const runner = createHookRunner(registry, { catchErrors: false });
    await fireHooksViaRunner(runner);

    const result = await verifyTrace(outputPath);
    expect(result.status).toBe("pass");
  });

  test("live: full pipeline with real deps → correct exit code", async () => {
    if (!openclawAvailable) {
      return;
    }

    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");

    const registry = createMinimalRegistry();
    const api = createPluginApi(registry);
    const initPlugin = createKrynixPlugin({
      outputPath,
      replaySeed: 42,
      agentId: "live-test-agent",
    });
    handle = await initPlugin(api);

    const runner = createHookRunner(registry, { catchErrors: false });
    await fireHooksViaRunner(runner);

    // Load real policy
    const policyYaml = await readFile(
      join(
        import.meta.dirname,
        "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml",
      ),
      "utf-8",
    );
    const policy = parsePolicy(policyYaml);

    // Run evaluation pipeline with real deps
    const realDeps = createRealDeps(outputPath);
    const pipelineResult = await runEvaluationPipeline(
      { tracePath: outputPath, policies: [policy] },
      realDeps,
    );

    // shell_exec → deny → exit code 2
    expect(pipelineResult.exitCode).toBe(2);
    expect(pipelineResult.hashChain.valid).toBe(true);
    expect(pipelineResult.policyResults.length).toBe(1);
    expect(pipelineResult.policyResults[0]?.verdict).toBe("fail");
    expect(pipelineResult.replayResult?.valid).toBe(true);
  });

  test("live: compliance bundle has valid artifacts", async () => {
    if (!openclawAvailable) {
      return;
    }

    const dir = await createTempDir();
    const outputPath = join(dir, "trace.jsonl");

    const registry = createMinimalRegistry();
    const api = createPluginApi(registry);
    const initPlugin = createKrynixPlugin({
      outputPath,
      replaySeed: 42,
      agentId: "live-test-agent",
    });
    handle = await initPlugin(api);

    const runner = createHookRunner(registry, { catchErrors: false });
    await fireHooksViaRunner(runner);

    const policyYaml = await readFile(
      join(
        import.meta.dirname,
        "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml",
      ),
      "utf-8",
    );
    const policy = parsePolicy(policyYaml);

    const realDeps = createRealDeps(outputPath);
    const pipelineResult = await runEvaluationPipeline(
      {
        tracePath: outputPath,
        policies: [policy],
        generateBundle: true,
        bundleOptions: { include_otlp: true },
      },
      realDeps,
    );

    expect(pipelineResult.bundle).toBeDefined();
    const bundle = pipelineResult.bundle!;

    // Manifest should list artifacts
    expect(bundle.manifest.artifacts.length).toBeGreaterThan(0);

    // Every artifact in the manifest should have a valid sha256: digest
    for (const artifact of bundle.manifest.artifacts) {
      expect(artifact.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    }

    // Bundle should include trace, evaluation, and stats artifacts
    const types = bundle.manifest.artifacts.map((a) => a.type);
    expect(types).toContain("trace");
    expect(types).toContain("evaluation");
    expect(types).toContain("stats");
  });
});
