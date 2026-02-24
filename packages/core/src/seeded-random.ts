/**
 * Seeded PRNG and deterministic UUID generator for replay determinism.
 *
 * Uses the mulberry32 algorithm — a fast 32-bit PRNG with good distribution.
 * Given the same seed, produces the same sequence of UUIDs every time.
 *
 * DO NOT CHANGE THIS ALGORITHM — all golden traces depend on it.
 *
 * @module
 */

import { KrynixError } from "./errors.js";

/**
 * Deterministic pseudo-random number generator using mulberry32.
 *
 * Each instance maintains internal state derived from the initial seed.
 * Given the same seed, the sequence of outputs is identical across runs
 * and platforms.
 *
 * @example
 * ```ts
 * const rng = new SeededRandom(42);
 * const id1 = rng.nextUUID(); // always the same for seed 42
 * const id2 = rng.nextUUID(); // always the same second UUID
 * ```
 */
export class SeededRandom {
  private state: number;

  /**
   * Create a new SeededRandom instance.
   *
   * @param seed - Positive safe integer (1 to Number.MAX_SAFE_INTEGER)
   * @throws {KrynixError} INVALID_SEED if seed is not a positive safe integer
   */
  constructor(seed: number) {
    if (!Number.isSafeInteger(seed) || seed <= 0) {
      throw new KrynixError(
        "INVALID_SEED",
        `seed must be a positive safe integer, got ${String(seed)}`,
      );
    }

    // XOR the lower and upper 32-bit halves to derive initial 32-bit state.
    // This ensures large seeds (beyond 32 bits) still influence the state.
    // DO NOT CHANGE THIS ALGORITHM — all golden traces depend on it.
    const lo = seed & 0xffffffff;
    const hi = Math.floor(seed / 0x100000000) & 0xffffffff;
    this.state = (lo ^ hi) >>> 0;

    // If XOR produces 0 (e.g. seed = 0x100000000), advance once to escape.
    if (this.state === 0) {
      this.state = 1;
    }
  }

  /**
   * Generate the next pseudo-random unsigned 32-bit integer.
   *
   * DO NOT CHANGE THIS ALGORITHM — all golden traces depend on it.
   *
   * @returns Integer in the range [0, 2^32 - 1]
   */
  nextUint32(): number {
    // mulberry32
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const result = (t ^ (t >>> 14)) >>> 0;
    return result;
  }

  /**
   * Generate a deterministic UUID v4 string.
   *
   * Uses 4 calls to `nextUint32()` to fill the 128-bit UUID, then sets
   * the version nibble (4) and variant bits (10xx) per RFC 4122.
   *
   * DO NOT CHANGE THIS ALGORITHM — all golden traces depend on it.
   *
   * @returns UUID string in the format `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
   */
  nextUUID(): string {
    const a = this.nextUint32();
    const b = this.nextUint32();
    const c = this.nextUint32();
    const d = this.nextUint32();

    // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // a provides bytes 0-3, b provides bytes 4-7 (with version), etc.
    const hex = (n: number, len: number): string => n.toString(16).padStart(len, "0");

    // Byte positions:
    // [0-3]  a          → 8 hex chars
    // [4-5]  b >> 16    → 4 hex chars
    // [6-7]  version(4) + (b & 0x0FFF) → 4 hex chars
    // [8-9]  variant(10xx) + (c >> 16 & 0x3FFF) → 4 hex chars
    // [10-15] (c & 0xFFFF) + d → 12 hex chars

    const p1 = hex(a >>> 0, 8);
    const p2 = hex((b >>> 16) & 0xffff, 4);
    const p3 = hex(0x4000 | (b & 0x0fff), 4);
    const p4 = hex(0x8000 | ((c >>> 16) & 0x3fff), 4);
    const p5 = hex(c & 0xffff, 4) + hex(d >>> 0, 8);

    return `${p1}-${p2}-${p3}-${p4}-${p5}`;
  }
}
