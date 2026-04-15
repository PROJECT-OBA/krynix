/**
 * Ed25519 signing for hash chains.
 *
 * A SHA-256 hash chain (see `hash-chain.ts`) provides structural integrity but
 * no protection against intentional tampering: anyone with write access can
 * mutate an event, regenerate the chain, and `validateHashChain` will return
 * valid. Ed25519 signing closes this gap by cryptographically binding the
 * chain's tip (the final `event_hash`) to a private key. Verification requires
 * only the matching public key — without the private key, an attacker cannot
 * produce a signature that verifies against the trusted public key.
 *
 * Keys are PEM-encoded (standard OpenSSL format). Node's built-in `crypto`
 * supports Ed25519 natively — no new dependencies.
 *
 * ## Signing input
 * Signs the raw 32 bytes of the chain-tip SHA-256 digest, NOT the textual hex
 * encoding. This makes the primitive language-agnostic: any verifier with the
 * 32-byte digest and the public key produces the same result regardless of
 * how their language formats hex (case, whitespace, prefix). The
 * implementation parses the tip's `event_hash` field (a 64-char lowercase hex
 * string per `hash-chain.ts`) into bytes before signing.
 *
 * ## Threat model
 * - Defeats: event mutation + chain regeneration, event deletion/insertion
 *   followed by chain rebuild, chain truncation (tip differs), reorder attacks.
 * - Does NOT defeat: compromise of the private key itself.
 *
 * @module
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type { TraceEvent } from "./types.js";
import { KrynixError } from "./errors.js";

/** A PEM-encoded Ed25519 keypair. */
export interface SigningKeypair {
  /** PEM-encoded Ed25519 private key (PKCS#8). Keep secret. */
  privateKey: string;
  /** PEM-encoded Ed25519 public key (SubjectPublicKeyInfo). Safe to distribute. */
  publicKey: string;
}

/**
 * Generate a fresh Ed25519 keypair for signing hash chains.
 *
 * The private key must be stored securely (env var, secret manager, HSM).
 * The public key can be distributed freely to verifiers.
 */
export function generateSigningKeypair(): SigningKeypair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

/**
 * SHA-256 produces 32-byte digests, encoded in `event_hash` as 64 lowercase
 * hex characters. Validate strictly so signing/verification use the digest
 * bytes deterministically, independent of any textual representation.
 */
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Decode a chain tip's `event_hash` field into its 32 raw digest bytes,
 * throwing a typed error on shape violations. Used by both sign and verify
 * so that signing input is always the bytes of a SHA-256 digest, never the
 * textual encoding.
 */
function decodeTipDigest(tip: TraceEvent): Buffer {
  const tipHash = tip.event_hash;
  if (!tipHash) {
    throw new KrynixError(
      "HASH_CHAIN_NOT_COMPUTED",
      "final event has no event_hash — did you call computeHashChain first?",
    );
  }
  if (!HEX64.test(tipHash)) {
    throw new KrynixError(
      "HASH_CHAIN_NOT_COMPUTED",
      `final event's event_hash is not a 64-char lowercase hex SHA-256 digest (got length ${String(tipHash.length)})`,
    );
  }
  return Buffer.from(tipHash, "hex");
}

/**
 * Sign a hash chain's tip with an Ed25519 private key.
 *
 * Produces a hex-encoded signature over the final event's `event_hash`. Because
 * every event's hash depends on all preceding events (via `prev_hash`), signing
 * the tip is equivalent to signing the entire chain.
 *
 * @param events - Ordered events with a fully-computed hash chain
 * @param privateKeyPem - PEM-encoded Ed25519 private key
 * @returns Hex-encoded Ed25519 signature (128 hex chars / 64 bytes)
 * @throws {KrynixError} EMPTY_CHAIN if events is empty
 * @throws {KrynixError} HASH_CHAIN_NOT_COMPUTED if the tip lacks a valid event_hash
 * @throws {KrynixError} INVALID_KEY if the private key cannot be parsed
 */
export function signHashChain(events: readonly TraceEvent[], privateKeyPem: string): string {
  if (events.length === 0) {
    throw new KrynixError("EMPTY_CHAIN", "cannot sign an empty hash chain");
  }
  const tip = events[events.length - 1];
  if (tip === undefined) {
    throw new KrynixError("EMPTY_CHAIN", "cannot sign an empty hash chain");
  }
  const digestBytes = decodeTipDigest(tip);

  let keyObject;
  try {
    keyObject = createPrivateKey(privateKeyPem);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new KrynixError("INVALID_KEY", `failed to parse private key: ${message}`);
  }

  const signature = sign(null, digestBytes, keyObject);
  return signature.toString("hex");
}

/**
 * Verify an Ed25519 signature over a hash chain's tip.
 *
 * Returns `true` iff the signature was produced by the private key matching
 * `publicKeyPem` over the final event's `event_hash`.
 *
 * Callers should typically ALSO run `validateHashChain` — signature verification
 * proves the tip is authentic, chain validation proves the intermediate events
 * hash correctly to that tip. Together they give end-to-end tamper evidence.
 *
 * @param events - Ordered events with a fully-computed hash chain
 * @param signatureHex - Hex-encoded signature from `signHashChain`
 * @param publicKeyPem - PEM-encoded Ed25519 public key
 * @returns `true` if the signature is valid for this chain and key
 */
export function verifyHashChainSignature(
  events: readonly TraceEvent[],
  signatureHex: string,
  publicKeyPem: string,
): boolean {
  if (events.length === 0) {
    return false;
  }
  const tip = events[events.length - 1];
  if (tip === undefined) {
    return false;
  }

  // Decode the tip digest defensively. A malformed or missing event_hash is
  // a verification failure (false), not an exception — verify must never
  // throw on attacker-controlled input.
  let digestBytes: Buffer;
  try {
    digestBytes = decodeTipDigest(tip);
  } catch {
    return false;
  }

  let keyObject;
  try {
    keyObject = createPublicKey(publicKeyPem);
  } catch {
    return false;
  }

  let signatureBuf: Buffer;
  try {
    signatureBuf = Buffer.from(signatureHex, "hex");
    // Ed25519 signatures are always 64 bytes
    if (signatureBuf.length !== 64) return false;
  } catch {
    return false;
  }

  try {
    return verify(null, digestBytes, keyObject, signatureBuf);
  } catch {
    return false;
  }
}
