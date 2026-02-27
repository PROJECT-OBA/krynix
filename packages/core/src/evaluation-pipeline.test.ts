import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runEvaluationPipeline } from "./evaluation-pipeline.js";
import { computeHashChain } from "./hash-chain.js";
import { canonicalize } from "./canonical-json.js";
import type { TraceEvent } from "./types.js";
import type {
  EvaluationPipelineDeps,
  PipelineEvalResult,
  PipelineReplayResult,
} from "./evaluation-pipeline.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-pipeline-"));
  return tempDir;
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

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

function makeEvents(): TraceEvent[] {
  return [
    {
      ...BASE,
      event_id: "evt-000",
      sequence_num: 0,
      event_type: "lifecycle",
      payload: { action: "session_start" },
    } as unknown as TraceEvent,
    {
      ...BASE,
      event_id: "evt-001",
      sequence_num: 1,
      timestamp: "2025-01-15T14:01:00.000Z",
      event_type: "tool_call",
      payload: { tool_name: "file_read", arguments: { path: "/tmp/test.txt" } },
    } as unknown as TraceEvent,
    {
      ...BASE,
      event_id: "evt-002",
      sequence_num: 2,
      timestamp: "2025-01-15T14:02:00.000Z",
      event_type: "lifecycle",
      payload: { action: "session_end" },
    } as unknown as TraceEvent,
  ];
}

function makeHashedEvents(): TraceEvent[] {
  return computeHashChain(makeEvents());
}

async function writeTraceFile(dir: string): Promise<string> {
  const path = join(dir, "trace.jsonl");
  const chained = makeHashedEvents();
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

function passDeps(): EvaluationPipelineDeps {
  return {
    evaluatePolicy: async (_events, _policy): Promise<PipelineEvalResult> => ({
      policyName: "allow-all",
      verdict: "pass",
      exitCode: 0,
      violations: [],
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runEvaluationPipeline", () => {
  test("loads trace from path and evaluates single policy", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTraceFile(dir);

    const result = await runEvaluationPipeline({ tracePath, policies: ["allow-all"] }, passDeps());

    expect(result.exitCode).toBe(0);
    expect(result.events.length).toBe(3);
    expect(result.hashChain.valid).toBe(true);
    expect(result.policyResults).toHaveLength(1);
    expect(result.policyResults[0]).toBeDefined();
    expect(result.policyResults[0]?.verdict).toBe("pass");
  });

  test("uses pre-loaded events when events option provided", async () => {
    const events = makeHashedEvents();
    const result = await runEvaluationPipeline({ events, policies: ["allow-all"] }, passDeps());

    expect(result.exitCode).toBe(0);
    expect(result.events.length).toBe(3);
    expect(result.stats.event_count).toBe(3);
  });

  test("throws when both tracePath and events provided", async () => {
    const events = makeHashedEvents();
    await expect(
      runEvaluationPipeline({ tracePath: "/some/path", events, policies: [] }, passDeps()),
    ).rejects.toThrow("Cannot provide both tracePath and events");
  });

  test("throws when neither tracePath nor events provided", async () => {
    await expect(runEvaluationPipeline({ policies: [] }, passDeps())).rejects.toThrow(
      "Must provide either tracePath or events",
    );
  });

  test("validates hash chain and reports result", async () => {
    const events = makeHashedEvents();
    const result = await runEvaluationPipeline({ events, policies: [] }, passDeps());

    expect(result.hashChain.valid).toBe(true);
  });

  test("reports broken hash chain without aborting", async () => {
    const events = makeHashedEvents();
    // Tamper with hash
    const tampered = events.map((e, i) =>
      i === 1 ? { ...e, event_hash: "tampered" } : e,
    ) as TraceEvent[];

    const result = await runEvaluationPipeline(
      { events: tampered, policies: ["allow-all"] },
      passDeps(),
    );

    expect(result.hashChain.valid).toBe(false);
    expect(result.exitCode).toBeGreaterThanOrEqual(1);
    // Pipeline still completed (policy was evaluated)
    expect(result.policyResults).toHaveLength(1);
  });

  test("applies filter criteria before evaluation", async () => {
    const events = makeHashedEvents();
    let evaluatedCount = 0;
    const deps: EvaluationPipelineDeps = {
      evaluatePolicy: async (evts): Promise<PipelineEvalResult> => {
        evaluatedCount = evts.length;
        return { policyName: "test", verdict: "pass", exitCode: 0, violations: [] };
      },
    };

    const result = await runEvaluationPipeline(
      {
        events,
        policies: ["test"],
        filter: { event_types: ["tool_call"] },
      },
      deps,
    );

    expect(result.events.length).toBe(1);
    expect(evaluatedCount).toBe(1);
    expect(result.stats.event_count).toBe(1);
  });

  test("computes trace stats on filtered events", async () => {
    const events = makeHashedEvents();
    const result = await runEvaluationPipeline(
      {
        events,
        policies: [],
        filter: { event_types: ["lifecycle"] },
      },
      passDeps(),
    );

    expect(result.stats.event_count).toBe(2);
    expect(result.stats.tool_call_count).toBe(0);
  });

  test("evaluates multiple policies", async () => {
    const events = makeHashedEvents();
    let callCount = 0;
    const deps: EvaluationPipelineDeps = {
      evaluatePolicy: async (_events, policy): Promise<PipelineEvalResult> => {
        callCount++;
        return {
          policyName: String(policy),
          verdict: "pass",
          exitCode: 0,
          violations: [],
        };
      },
    };

    const result = await runEvaluationPipeline(
      { events, policies: ["policy-a", "policy-b", "policy-c"] },
      deps,
    );

    expect(callCount).toBe(3);
    expect(result.policyResults).toHaveLength(3);
  });

  test("computes exitCode as max of all sub-results", async () => {
    const events = makeHashedEvents();
    let callIdx = 0;
    const deps: EvaluationPipelineDeps = {
      evaluatePolicy: async (): Promise<PipelineEvalResult> => {
        callIdx++;
        if (callIdx === 1) {
          return { policyName: "pass", verdict: "pass", exitCode: 0, violations: [] };
        }
        return { policyName: "fail", verdict: "fail", exitCode: 2, violations: [] };
      },
    };

    const result = await runEvaluationPipeline({ events, policies: ["a", "b"] }, deps);

    expect(result.exitCode).toBe(2);
  });

  test("includes hash chain failure in exitCode", async () => {
    const events = makeHashedEvents();
    const tampered = events.map((e, i) =>
      i === 1 ? { ...e, event_hash: "bad" } : e,
    ) as TraceEvent[];

    const result = await runEvaluationPipeline({ events: tampered, policies: [] }, passDeps());

    // No policies, but hash chain is broken → exit 1
    expect(result.exitCode).toBe(1);
  });

  test("calls verifyReplay when dep provided", async () => {
    const events = makeHashedEvents();
    let replayCalled = false;
    const deps: EvaluationPipelineDeps = {
      ...passDeps(),
      verifyReplay: async (): Promise<PipelineReplayResult> => {
        replayCalled = true;
        return { valid: true, exitCode: 0, details: { ok: true } };
      },
    };

    const result = await runEvaluationPipeline({ events, policies: [] }, deps);

    expect(replayCalled).toBe(true);
    expect(result.replayResult).toBeDefined();
    expect(result.replayResult?.valid).toBe(true);
  });

  test("skips replay when dep not provided", async () => {
    const events = makeHashedEvents();
    const result = await runEvaluationPipeline({ events, policies: [] }, passDeps());

    expect(result.replayResult).toBeUndefined();
  });

  test("generates compliance bundle when requested", async () => {
    const events = makeHashedEvents();
    const result = await runEvaluationPipeline(
      {
        events,
        policies: ["allow-all"],
        generateBundle: true,
        bundleOptions: {
          export_id: "test-export-001",
          generated_at: "2025-01-15T15:00:00Z",
        },
      },
      passDeps(),
    );

    expect(result.bundle).toBeDefined();
    expect(result.bundle?.manifest.export_id).toBe("test-export-001");
    expect(result.bundle?.manifest.trace_count).toBe(1);
    const bundleArtifacts = result.bundle?.artifacts ?? [];
    expect(bundleArtifacts.length).toBeGreaterThan(0);
  });

  test("skips bundle when generateBundle is false (default)", async () => {
    const events = makeHashedEvents();
    const result = await runEvaluationPipeline({ events, policies: [] }, passDeps());

    expect(result.bundle).toBeUndefined();
  });

  test("handles empty trace gracefully", async () => {
    const result = await runEvaluationPipeline({ events: [], policies: [] }, passDeps());

    expect(result.exitCode).toBe(0);
    expect(result.events.length).toBe(0);
    expect(result.stats.event_count).toBe(0);
    expect(result.hashChain.valid).toBe(true);
  });

  test("handles evaluatePolicy throwing", async () => {
    const events = makeHashedEvents();
    const deps: EvaluationPipelineDeps = {
      evaluatePolicy: async () => {
        throw new Error("Policy engine crash");
      },
    };

    await expect(runEvaluationPipeline({ events, policies: ["bad"] }, deps)).rejects.toThrow(
      "Policy engine crash",
    );
  });

  test("handles zero policies with hash chain only", async () => {
    const events = makeHashedEvents();
    const result = await runEvaluationPipeline({ events, policies: [] }, passDeps());

    expect(result.exitCode).toBe(0);
    expect(result.policyResults).toHaveLength(0);
    expect(result.hashChain.valid).toBe(true);
    expect(result.stats.event_count).toBe(3);
  });
});
