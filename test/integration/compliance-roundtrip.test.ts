/**
 * Compliance Bundle Disk Round-Trip Tests
 *
 * Generates real traces → real evaluation → real replay → compliance bundle →
 * writes to disk → reads back → verifies SHA-256 digests match, hash chain
 * preserved, evaluation contains real violations.
 *
 * @module
 */

import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  startSession,
  recordEvent,
  endSession,
  readTrace,
  validateHashChain,
  generateComplianceBundle,
  writeComplianceBundleToDir,
} from "../../packages/core/src/index.js";
import type { Session, ComplianceBundle } from "../../packages/core/src/index.js";
import { parsePolicy, evaluate } from "../../packages/policy/src/index.js";
import type { Policy } from "../../packages/policy/src/index.js";
import { verifyTrace } from "../../packages/replay/src/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-compliance-"));
  return tempDir;
}

async function loadDefaultPolicy(): Promise<Policy> {
  const yaml = await readFile(
    join(
      import.meta.dirname,
      "../../packages/adapter-openclaw/policies/openclaw-default.policy.yaml",
    ),
    "utf-8",
  );
  return parsePolicy(yaml);
}

async function createTrace(
  dir: string,
  seed: number,
  events: Array<{ type: string; tool?: string; args?: Record<string, unknown> }>,
  label?: string,
): Promise<string> {
  const suffix = label ? `-${label}` : "";
  const tracePath = join(dir, `trace-${seed}${suffix}.trace.jsonl`);
  const session = await startSession({
    agentId: "compliance-test",
    replaySeed: seed,
    outputPath: tracePath,
  });

  for (const ev of events) {
    if (ev.type === "tool_call") {
      await recordEvent(session, {
        event_type: "tool_call",
        timestamp: new Date().toISOString(),
        parent_id: null,
        agent_id: session.agentId,
        payload: { tool_name: ev.tool, arguments: ev.args ?? {} },
        metadata: null,
      });
    } else if (ev.type === "llm_request") {
      await recordEvent(session, {
        event_type: "llm_request",
        timestamp: new Date().toISOString(),
        parent_id: null,
        agent_id: session.agentId,
        payload: { model: "gpt-4", messages: [], parameters: {} },
        metadata: null,
      });
    }
  }

  await endSession(session);
  return tracePath;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Compliance Bundle Disk Round-Trip", () => {
  test("manifest digests match artifact content after disk write", async () => {
    const dir = await createTempDir();
    const tracePath = await createTrace(dir, 42, [
      { type: "tool_call", tool: "file_read", args: { path: "/test" } },
      { type: "tool_call", tool: "shell_exec", args: { command: "ls" } },
    ]);

    const events = await readTrace(tracePath);
    const policy = await loadDefaultPolicy();
    const evalResult = evaluate(events, policy);
    const replayResult = await verifyTrace(tracePath);

    const bundle = generateComplianceBundle({
      traces: [
        {
          session_id: events[0]!.session_id,
          events: [...events],
          evaluation: [
            {
              policyName: policy.metadata.name,
              verdict: evalResult.verdict,
              exitCode: evalResult.exitCode,
              violations: evalResult.violations,
            },
          ],
          replay_report: replayResult,
        },
      ],
      include_otlp: true,
    });

    // Write to disk
    const bundleDir = join(dir, "bundle");
    await writeComplianceBundleToDir(bundle, bundleDir);

    // Read manifest from disk
    const manifestContent = await readFile(join(bundleDir, "manifest.json"), "utf-8");
    const manifest = JSON.parse(manifestContent);

    // Verify each artifact's digest matches its actual file content
    for (const entry of manifest.artifacts) {
      const filePath = join(bundleDir, entry.path);
      const fileContent = await readFile(filePath, "utf-8");
      const computedDigest = `sha256:${sha256(fileContent)}`;
      expect(computedDigest).toBe(entry.digest);
    }
  });

  test("hash chain valid in trace artifact on disk", async () => {
    const dir = await createTempDir();
    const tracePath = await createTrace(dir, 100, [
      { type: "tool_call", tool: "file_read", args: { path: "/a" } },
    ]);

    const events = await readTrace(tracePath);
    const bundle = generateComplianceBundle({
      traces: [{ session_id: events[0]!.session_id, events: [...events] }],
    });

    const bundleDir = join(dir, "bundle");
    await writeComplianceBundleToDir(bundle, bundleDir);

    // Find the trace artifact
    const traceArtifact = bundle.artifacts.find((a) => a.type === "trace");
    expect(traceArtifact).toBeDefined();

    // Parse trace events from artifact content
    const traceLines = traceArtifact!.content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const chainResult = validateHashChain(traceLines);
    expect(chainResult.valid).toBe(true);
  });

  test("evaluation artifact contains real violations", async () => {
    const dir = await createTempDir();
    const tracePath = await createTrace(dir, 200, [
      { type: "tool_call", tool: "shell_exec", args: { command: "rm -rf /" } },
    ]);

    const events = await readTrace(tracePath);
    const policy = await loadDefaultPolicy();
    const evalResult = evaluate(events, policy);

    const bundle = generateComplianceBundle({
      traces: [
        {
          session_id: events[0]!.session_id,
          events: [...events],
          evaluation: [
            {
              policyName: policy.metadata.name,
              verdict: evalResult.verdict,
              exitCode: evalResult.exitCode,
              violations: evalResult.violations,
            },
          ],
        },
      ],
    });

    const bundleDir = join(dir, "bundle");
    await writeComplianceBundleToDir(bundle, bundleDir);

    // Read evaluation artifact
    const evalArtifact = bundle.artifacts.find((a) => a.type === "evaluation");
    expect(evalArtifact).toBeDefined();

    const evalData = JSON.parse(evalArtifact!.content);
    expect(Array.isArray(evalData)).toBe(true);
    expect(evalData.length).toBeGreaterThan(0);

    // Should contain deny-shell-exec violation
    const firstEntry = evalData[0];
    expect(firstEntry.violations).toBeDefined();
    const violations = firstEntry.violations;
    expect(violations.some((v: { ruleId: string }) => v.ruleId === "deny-shell-exec")).toBe(true);
  });

  test("stats artifact has correct event count", async () => {
    const dir = await createTempDir();
    const tracePath = await createTrace(dir, 300, [
      { type: "tool_call", tool: "file_read", args: { path: "/a" } },
      { type: "tool_call", tool: "file_read", args: { path: "/b" } },
      { type: "llm_request" },
    ]);

    const events = await readTrace(tracePath);
    const bundle = generateComplianceBundle({
      traces: [{ session_id: events[0]!.session_id, events: [...events] }],
    });

    const statsArtifact = bundle.artifacts.find((a) => a.type === "stats");
    expect(statsArtifact).toBeDefined();

    const stats = JSON.parse(statsArtifact!.content);
    // session_start + 3 events + session_end = 5
    expect(stats.event_count).toBe(5);
    expect(stats.tool_call_count).toBe(2);
    expect(stats.llm_request_count).toBe(1);
  });

  test("OTLP artifact has valid structure", async () => {
    const dir = await createTempDir();
    const tracePath = await createTrace(dir, 400, [
      { type: "tool_call", tool: "file_read", args: { path: "/test" } },
    ]);

    const events = await readTrace(tracePath);
    const bundle = generateComplianceBundle({
      traces: [{ session_id: events[0]!.session_id, events: [...events] }],
      include_otlp: true,
    });

    const otlpArtifact = bundle.artifacts.find((a) => a.type === "otlp");
    expect(otlpArtifact).toBeDefined();

    const otlp = JSON.parse(otlpArtifact!.content);
    expect(otlp.resourceSpans).toBeDefined();
    expect(Array.isArray(otlp.resourceSpans)).toBe(true);
  });

  test("hash chain verification artifact exists", async () => {
    const dir = await createTempDir();
    const tracePath = await createTrace(dir, 500, [
      { type: "tool_call", tool: "file_read", args: { path: "/test" } },
    ]);

    const events = await readTrace(tracePath);
    const bundle = generateComplianceBundle({
      traces: [{ session_id: events[0]!.session_id, events: [...events] }],
    });

    const verificationArtifact = bundle.artifacts.find((a) => a.type === "hash_chain_verification");
    expect(verificationArtifact).toBeDefined();

    const verification = JSON.parse(verificationArtifact!.content);
    expect(verification.valid).toBeDefined();
    expect(typeof verification.valid).toBe("boolean");
  });

  test("bundle directory contains manifest + all artifacts", async () => {
    const dir = await createTempDir();
    const tracePath = await createTrace(dir, 600, [
      { type: "tool_call", tool: "file_read", args: { path: "/test" } },
    ]);

    const events = await readTrace(tracePath);
    const bundle = generateComplianceBundle({
      traces: [{ session_id: events[0]!.session_id, events: [...events] }],
      include_otlp: true,
    });

    const bundleDir = join(dir, "bundle");
    await writeComplianceBundleToDir(bundle, bundleDir);

    // Read directory contents
    const files = await readdir(bundleDir, { recursive: true });
    const fileSet = new Set(files.map(String));

    // Must have manifest.json
    expect(fileSet.has("manifest.json")).toBe(true);

    // All artifact paths from manifest must exist as files
    for (const artifact of bundle.manifest.artifacts) {
      expect(
        fileSet.has(artifact.path),
        `Expected file ${artifact.path} to exist in bundle dir`,
      ).toBe(true);
    }
  });

  test("determinism: same input twice produces identical bundle", async () => {
    const dir = await createTempDir();

    // Generate a single trace — startSession produces unique session IDs
    // and timestamps, so we must use the same trace data for both bundles
    const tracePath = await createTrace(dir, 42, [
      { type: "tool_call", tool: "file_read", args: { path: "/test" } },
    ]);

    const events = await readTrace(tracePath);

    // Use fixed parameters for both bundles
    const fixedOpts = {
      org_id: "test-org",
      export_id: "test-export-001",
      generated_at: "2025-06-01T00:00:00.000Z",
      engine_version: "1.0.0",
    };

    // Call generateComplianceBundle twice with the same input
    const bundle1 = generateComplianceBundle({
      traces: [{ session_id: events[0]!.session_id, events: [...events] }],
      ...fixedOpts,
    });
    const bundle2 = generateComplianceBundle({
      traces: [{ session_id: events[0]!.session_id, events: [...events] }],
      ...fixedOpts,
    });

    // Manifests should be identical
    expect(JSON.stringify(bundle1.manifest)).toBe(JSON.stringify(bundle2.manifest));

    // Artifact digests should match
    for (let i = 0; i < bundle1.artifacts.length; i++) {
      expect(bundle1.artifacts[i]!.digest).toBe(bundle2.artifacts[i]!.digest);
    }
  });
});
