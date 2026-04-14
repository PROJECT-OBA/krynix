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
 * Sign a hash chain's tip with an Ed25519 private key.
 *
 * Produces a hex-encoded signature over the final event's `event_hash`. Because
 * every event's hash depends on all preceding events (via `prev_hash`), signing
 * the tip is equivalent to signing the entire chain.
 *
 * @param events - Ordered events with a fully-computed hash chain
 * @param privateKeyPem - PEM-encoded Ed25519 private key
 * @returns Hex-encoded Ed25519 signature
 * @throws {KrynixError} EMPTY_CHAIN if events is empty
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
  const tipHash = tip.event_hash;
  if (!tipHash) {
    throw new KrynixError(
      "EMPTY_CHAIN",
      "final event has no event_hash — did you call computeHashChain first?",
    );
  }

  let keyObject;
  try {
    keyObject = createPrivateKey(privateKeyPem);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new KrynixError("INVALID_KEY", `failed to parse private key: ${message}`);
  }

  const signature = sign(null, Buffer.from(tipHash, "utf-8"), keyObject);
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
  const tipHash = tip.event_hash;
  if (!tipHash) {
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
    return verify(null, Buffer.from(tipHash, "utf-8"), keyObject, signatureBuf);
  } catch {
    return false;
  }
}
