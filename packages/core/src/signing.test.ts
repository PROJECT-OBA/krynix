import { describe, test, expect } from "vitest";
import { computeHashChain } from "./hash-chain.js";
import { generateSigningKeypair, signHashChain, verifyHashChainSignature } from "./signing.js";
import type { TraceEvent } from "./types.js";

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

function makeChain(): TraceEvent[] {
  return computeHashChain(makeEvents());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("generateSigningKeypair", () => {
  test("produces PEM-encoded Ed25519 keypair", () => {
    const { privateKey, publicKey } = generateSigningKeypair();
    expect(privateKey).toContain("-----BEGIN PRIVATE KEY-----");
    expect(privateKey).toContain("-----END PRIVATE KEY-----");
    expect(publicKey).toContain("-----BEGIN PUBLIC KEY-----");
    expect(publicKey).toContain("-----END PUBLIC KEY-----");
  });

  test("produces distinct keys on successive calls", () => {
    const a = generateSigningKeypair();
    const b = generateSigningKeypair();
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });
});

describe("signHashChain / verifyHashChainSignature", () => {
  test("round-trip: sign with private key, verify with matching public key", () => {
    const { privateKey, publicKey } = generateSigningKeypair();
    const chain = makeChain();
    const sig = signHashChain(chain, privateKey);
    expect(verifyHashChainSignature(chain, sig, publicKey)).toBe(true);
  });

  test("signature is deterministic (Ed25519 is deterministic)", () => {
    const { privateKey } = generateSigningKeypair();
    const chain = makeChain();
    const sig1 = signHashChain(chain, privateKey);
    const sig2 = signHashChain(chain, privateKey);
    expect(sig1).toBe(sig2);
  });

  test("signature is 64 bytes (128 hex chars)", () => {
    const { privateKey } = generateSigningKeypair();
    const sig = signHashChain(makeChain(), privateKey);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
  });

  test("verification fails with wrong public key", () => {
    const kp1 = generateSigningKeypair();
    const kp2 = generateSigningKeypair();
    const chain = makeChain();
    const sig = signHashChain(chain, kp1.privateKey);
    expect(verifyHashChainSignature(chain, sig, kp2.publicKey)).toBe(false);
  });

  test("verification fails on corrupted signature", () => {
    const { privateKey, publicKey } = generateSigningKeypair();
    const chain = makeChain();
    const sig = signHashChain(chain, privateKey);
    // Flip one hex char
    const corrupted = sig[0] === "0" ? "1" + sig.slice(1) : "0" + sig.slice(1);
    expect(verifyHashChainSignature(chain, corrupted, publicKey)).toBe(false);
  });

  test("verification fails on malformed signature (wrong length)", () => {
    const { publicKey } = generateSigningKeypair();
    expect(verifyHashChainSignature(makeChain(), "abcd", publicKey)).toBe(false);
  });

  test("verification fails on malformed public key", () => {
    const { privateKey } = generateSigningKeypair();
    const sig = signHashChain(makeChain(), privateKey);
    expect(verifyHashChainSignature(makeChain(), sig, "not-a-pem-key")).toBe(false);
  });

  test("signing empty chain throws EMPTY_CHAIN", () => {
    const { privateKey } = generateSigningKeypair();
    expect(() => signHashChain([], privateKey)).toThrow(/empty/i);
  });

  test("signing chain without computed hashes throws EMPTY_CHAIN", () => {
    const { privateKey } = generateSigningKeypair();
    expect(() => signHashChain(makeEvents(), privateKey)).toThrow(/computeHashChain/);
  });

  test("signing with malformed private key throws INVALID_KEY", () => {
    expect(() => signHashChain(makeChain(), "not-a-pem-key")).toThrow(/private key/);
  });

  test("verification of empty chain returns false", () => {
    const { publicKey } = generateSigningKeypair();
    expect(verifyHashChainSignature([], "0".repeat(128), publicKey)).toBe(false);
  });
});

describe("signing defeats chain regeneration attack (the golden scenario)", () => {
  test("attacker cannot forge a valid signature by regenerating the chain", () => {
    const { privateKey, publicKey } = generateSigningKeypair();

    // 1. Legitimate trace: sign it.
    const legitimate = makeChain();
    const legitimateSig = signHashChain(legitimate, privateKey);
    expect(verifyHashChainSignature(legitimate, legitimateSig, publicKey)).toBe(true);

    // 2. Attacker mutates a payload and regenerates the chain from scratch.
    //    Unsigned hash-chain validation would PASS on this tampered chain
    //    (that is the v1.0.0 gap). Signature verification must FAIL.
    const mutated = makeEvents().map((e, i) =>
      i === 1
        ? ({
            ...e,
            payload: { tool_name: "shell_exec", arguments: { cmd: "rm -rf /" } },
          } as unknown as TraceEvent)
        : e,
    );
    const regenerated = computeHashChain(mutated);

    // Attacker attaches the original signature to the regenerated chain.
    // The tip hash now differs because the chain was rebuilt over different data.
    const regeneratedTip = regenerated[regenerated.length - 1];
    const legitimateTip = legitimate[legitimate.length - 1];
    expect(regeneratedTip?.event_hash).not.toBe(legitimateTip?.event_hash);
    expect(verifyHashChainSignature(regenerated, legitimateSig, publicKey)).toBe(false);

    // Attacker cannot produce a new signature either — they don't have the private key.
    // (This is trivially true because Ed25519 requires the private key to sign.)
  });
});
