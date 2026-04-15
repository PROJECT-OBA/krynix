/**
 * CLI `sign` and `keygen` commands.
 *
 * `keygen` produces an Ed25519 keypair as two files (public + private PEM).
 * `sign` reads a trace, validates its hash chain, signs the tip with a
 * private key, and writes a `.sig` sidecar.
 *
 * Verification lives in `evaluate --public-key` (no separate verify command;
 * the evaluate gate is where verification matters for CI).
 *
 * @module
 */

import { readFile, writeFile, chmod } from "node:fs/promises";
import { readTrace, validateHashChain, signHashChain, generateSigningKeypair } from "@krynix/core";
import { getArg } from "./arg-parser.js";

/** Result of the sign command. */
export interface SignResult {
  exitCode: number;
  output: { signaturePath: string; signature: string } | null;
  error: string | null;
}

/** Result of the keygen command. */
export interface KeygenResult {
  exitCode: number;
  output: { publicKeyPath: string; privateKeyPath: string } | null;
  error: string | null;
}

/**
 * Sign a trace's hash chain with an Ed25519 private key and write a sidecar.
 *
 * @param args - `["--trace", path, "--private-key", path, ?"--output", path]`
 *               `--output` defaults to `<trace>.sig`.
 */
export async function runSign(args: string[]): Promise<SignResult> {
  const tracePath = getArg(args, "--trace");
  const privateKeyPath = getArg(args, "--private-key");
  const outputPath = getArg(args, "--output");

  if (tracePath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --trace" };
  }
  if (privateKeyPath === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --private-key" };
  }

  let trace;
  try {
    trace = await readTrace(tracePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Failed to read trace: ${message}` };
  }

  // validateHashChain([]) returns {valid: true} — empty chains are
  // structurally valid. Reject here with a clearer message than the
  // generic "Signing failed: cannot sign an empty hash chain" that
  // would otherwise surface from signHashChain.
  if (trace.length === 0) {
    return {
      exitCode: 1,
      output: null,
      error: `Refusing to sign: trace at ${tracePath} contains no events`,
    };
  }

  // Always verify chain integrity before signing — signing a broken chain
  // would produce a signature that will never verify, and silently too.
  const chainResult = validateHashChain(trace);
  if (!chainResult.valid) {
    return {
      exitCode: 1,
      output: null,
      error: `Refusing to sign: hash chain is not valid (${chainResult.error ?? "unknown error"})`,
    };
  }

  let privateKeyPem: string;
  try {
    privateKeyPem = await readFile(privateKeyPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      output: null,
      error: `Failed to read private key at ${privateKeyPath}: ${message}`,
    };
  }

  let signature: string;
  try {
    signature = signHashChain(trace, privateKeyPem);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Signing failed: ${message}` };
  }

  const signaturePath = outputPath ?? `${tracePath}.sig`;
  try {
    await writeFile(signaturePath, signature + "\n", "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      output: null,
      error: `Failed to write signature to ${signaturePath}: ${message}`,
    };
  }

  return { exitCode: 0, output: { signaturePath, signature }, error: null };
}

/**
 * Generate an Ed25519 keypair and write the two PEM files.
 *
 * @param args - `["--out-private", path, "--out-public", path]`
 */
export async function runKeygen(args: string[]): Promise<KeygenResult> {
  const privateOut = getArg(args, "--out-private");
  const publicOut = getArg(args, "--out-public");

  if (privateOut === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --out-private" };
  }
  if (publicOut === undefined) {
    return { exitCode: 1, output: null, error: "Missing required argument: --out-public" };
  }

  const { privateKey, publicKey } = generateSigningKeypair();

  try {
    // writeFile's `mode` option only applies when the file is newly created.
    // Explicit chmod ensures 0600 even if --out-private points to a pre-existing
    // file with looser permissions. Failing the chmod is a hard error: the
    // private key must not be left readable to other users.
    await writeFile(privateOut, privateKey, { encoding: "utf-8", mode: 0o600 });
    await chmod(privateOut, 0o600);
    await writeFile(publicOut, publicKey, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: `Failed to write key file: ${message}` };
  }

  return {
    exitCode: 0,
    output: { publicKeyPath: publicOut, privateKeyPath: privateOut },
    error: null,
  };
}
