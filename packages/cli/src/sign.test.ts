import { describe, test, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { runSign, runKeygen } from "./sign.js";
import { runEvaluate } from "./evaluate.js";
import {
  computeHashChain,
  canonicalize,
  generateSigningKeypair,
  verifyHashChainSignature,
} from "@krynix/core";
import type { TraceEvent } from "@krynix/core";

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function createTempDir(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), "krynix-sign-"));
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
      event_type: "tool_call",
      payload: { tool_name: "file_read", arguments: { path: "/tmp/ok.txt" } },
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

async function writeTrace(dir: string): Promise<string> {
  const path = join(dir, "trace.jsonl");
  const chained = computeHashChain(makeEvents());
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

async function writeTamperedTrace(dir: string): Promise<string> {
  const path = join(dir, "tampered.jsonl");
  // Mutate + regenerate chain: structurally valid but attack-regenerated.
  const mutated = makeEvents().map((e, i) =>
    i === 1
      ? ({
          ...e,
          payload: { tool_name: "shell_exec", arguments: { cmd: "rm -rf /" } },
        } as unknown as TraceEvent)
      : e,
  );
  const chained = computeHashChain(mutated);
  const lines = chained.map((e: TraceEvent) => canonicalize(e));
  await writeFile(path, lines.join("\n") + "\n");
  return path;
}

const ALLOW_POLICY = `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: allow-all
  version: "1.0.0"
  description: Allow everything
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

async function writePolicy(dir: string): Promise<string> {
  const path = join(dir, "allow.policy.yaml");
  await writeFile(path, ALLOW_POLICY);
  return path;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runKeygen", () => {
  test("writes private + public PEM files", async () => {
    const dir = await createTempDir();
    const priv = join(dir, "id.priv");
    const pub = join(dir, "id.pub");

    const result = await runKeygen(["--out-private", priv, "--out-public", pub]);
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();

    const privContent = await readFile(priv, "utf-8");
    const pubContent = await readFile(pub, "utf-8");
    expect(privContent).toContain("BEGIN PRIVATE KEY");
    expect(pubContent).toContain("BEGIN PUBLIC KEY");
  });

  test("missing --out-private → error", async () => {
    const result = await runKeygen(["--out-public", "/tmp/x"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--out-private");
  });
});

describe("runSign", () => {
  test("signs a valid trace and writes sidecar", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const { privateKey, publicKey } = generateSigningKeypair();
    const privPath = join(dir, "id.priv");
    await writeFile(privPath, privateKey);

    const result = await runSign(["--trace", tracePath, "--private-key", privPath]);
    expect(result.exitCode).toBe(0);
    expect(result.output?.signaturePath).toBe(`${tracePath}.sig`);
    expect(result.output?.signature).toMatch(/^[0-9a-f]{128}$/);

    // Sidecar is readable and verifies against the public key
    const sidecar = (await readFile(`${tracePath}.sig`, "utf-8")).trim();
    expect(sidecar).toBe(result.output?.signature);

    // Independent verification via the library
    const { readTrace } = await import("@krynix/core");
    const events = await readTrace(tracePath);
    expect(verifyHashChainSignature(events, sidecar, publicKey)).toBe(true);
  });

  test("refuses to sign a trace with a broken chain", async () => {
    const dir = await createTempDir();
    // Hand-write a trace whose prev_hash is wrong.
    const tracePath = join(dir, "broken.jsonl");
    const chained = computeHashChain(makeEvents());
    // Corrupt event 1's prev_hash.
    const broken: TraceEvent[] = chained.map((e: TraceEvent, i: number) =>
      i === 1 ? ({ ...e, prev_hash: "0".repeat(64) } as unknown as TraceEvent) : e,
    );
    await writeFile(tracePath, broken.map((e: TraceEvent) => canonicalize(e)).join("\n") + "\n");

    const { privateKey } = generateSigningKeypair();
    const privPath = join(dir, "id.priv");
    await writeFile(privPath, privateKey);

    const result = await runSign(["--trace", tracePath, "--private-key", privPath]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Refusing to sign");
  });

  test("missing --private-key → error", async () => {
    const result = await runSign(["--trace", "/tmp/any"]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("--private-key");
  });

  test("--output overrides sidecar path", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const { privateKey } = generateSigningKeypair();
    const privPath = join(dir, "id.priv");
    await writeFile(privPath, privateKey);
    const outPath = join(dir, "custom.sig");

    const result = await runSign([
      "--trace",
      tracePath,
      "--private-key",
      privPath,
      "--output",
      outPath,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.output?.signaturePath).toBe(outPath);
  });
});

describe("runEvaluate --public-key (signature verification)", () => {
  test("valid trace + valid signature + correct public key → pass", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir);
    const { privateKey, publicKey } = generateSigningKeypair();
    const privPath = join(dir, "id.priv");
    const pubPath = join(dir, "id.pub");
    await writeFile(privPath, privateKey);
    await writeFile(pubPath, publicKey);

    // Sign first
    const signResult = await runSign(["--trace", tracePath, "--private-key", privPath]);
    expect(signResult.exitCode).toBe(0);

    // Evaluate with --public-key
    const result = await runEvaluate([
      "--trace",
      tracePath,
      "--policy",
      policyPath,
      "--public-key",
      pubPath,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.output?.verdict).toBe("pass");
  });

  test("tampered+regenerated trace + old signature + correct public key → exit 1 (the golden test)", async () => {
    const dir = await createTempDir();
    const legitPath = await writeTrace(dir);
    const policyPath = await writePolicy(dir);
    const { privateKey, publicKey } = generateSigningKeypair();
    const privPath = join(dir, "id.priv");
    const pubPath = join(dir, "id.pub");
    await writeFile(privPath, privateKey);
    await writeFile(pubPath, publicKey);

    // Sign the legitimate trace
    await runSign(["--trace", legitPath, "--private-key", privPath]);
    const legitSig = (await readFile(`${legitPath}.sig`, "utf-8")).trim();

    // Attacker produces a tampered trace with regenerated chain, attaches the
    // old signature (they have no way to produce a new one without the private key).
    const tamperedPath = await writeTamperedTrace(dir);
    await writeFile(`${tamperedPath}.sig`, legitSig);

    // Chain-only validation would pass — this is the v1.0.0 gap we're closing.
    // With --public-key, signature verification catches it.
    const result = await runEvaluate([
      "--trace",
      tamperedPath,
      "--policy",
      policyPath,
      "--public-key",
      pubPath,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Signature verification failed");
  });

  test("wrong public key → signature verification fails", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir);
    const signer = generateSigningKeypair();
    const other = generateSigningKeypair();
    const privPath = join(dir, "id.priv");
    const wrongPubPath = join(dir, "wrong.pub");
    await writeFile(privPath, signer.privateKey);
    await writeFile(wrongPubPath, other.publicKey);

    await runSign(["--trace", tracePath, "--private-key", privPath]);

    const result = await runEvaluate([
      "--trace",
      tracePath,
      "--policy",
      policyPath,
      "--public-key",
      wrongPubPath,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Signature verification failed");
  });

  test("missing signature file → clear error", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir);
    const { publicKey } = generateSigningKeypair();
    const pubPath = join(dir, "id.pub");
    await writeFile(pubPath, publicKey);

    const result = await runEvaluate([
      "--trace",
      tracePath,
      "--policy",
      policyPath,
      "--public-key",
      pubPath,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Failed to read signature");
  });

  test("--signature flag overrides sidecar path", async () => {
    const dir = await createTempDir();
    const tracePath = await writeTrace(dir);
    const policyPath = await writePolicy(dir);
    const { privateKey, publicKey } = generateSigningKeypair();
    const privPath = join(dir, "id.priv");
    const pubPath = join(dir, "id.pub");
    await writeFile(privPath, privateKey);
    await writeFile(pubPath, publicKey);

    const customSig = join(dir, "custom.sig");
    await runSign(["--trace", tracePath, "--private-key", privPath, "--output", customSig]);

    const result = await runEvaluate([
      "--trace",
      tracePath,
      "--policy",
      policyPath,
      "--public-key",
      pubPath,
      "--signature",
      customSig,
    ]);
    expect(result.exitCode).toBe(0);
  });
});
