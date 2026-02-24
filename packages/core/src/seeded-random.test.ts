import { describe, test, expect } from "vitest";
import { SeededRandom } from "./seeded-random.js";
import { KrynixError } from "./errors.js";

describe("SeededRandom", () => {
  test("determinism: same seed produces the same first 10 UUIDs", () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(42);

    const uuids1 = Array.from({ length: 10 }, () => rng1.nextUUID());
    const uuids2 = Array.from({ length: 10 }, () => rng2.nextUUID());

    expect(uuids1).toEqual(uuids2);
  });

  test("different seeds produce different sequences", () => {
    const rng1 = new SeededRandom(42);
    const rng2 = new SeededRandom(99);

    const uuid1 = rng1.nextUUID();
    const uuid2 = rng2.nextUUID();

    expect(uuid1).not.toBe(uuid2);
  });

  test("UUIDs match v4 format", () => {
    const rng = new SeededRandom(42);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    for (let i = 0; i < 100; i++) {
      const uuid = rng.nextUUID();
      expect(uuid).toMatch(uuidRegex);
    }
  });

  test("Number.MAX_SAFE_INTEGER accepted as valid seed", () => {
    const rng = new SeededRandom(Number.MAX_SAFE_INTEGER);
    const uuid = rng.nextUUID();
    expect(uuid).toBeTruthy();
  });

  test("Number.MAX_SAFE_INTEGER + 1 throws INVALID_SEED", () => {
    expect(() => new SeededRandom(Number.MAX_SAFE_INTEGER + 1)).toThrow(KrynixError);
    try {
      new SeededRandom(Number.MAX_SAFE_INTEGER + 1);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });

  test("seed 0 throws INVALID_SEED", () => {
    expect(() => new SeededRandom(0)).toThrow(KrynixError);
    try {
      new SeededRandom(0);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });

  test("seed -1 throws INVALID_SEED", () => {
    expect(() => new SeededRandom(-1)).toThrow(KrynixError);
    try {
      new SeededRandom(-1);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });

  test("seed 3.14 throws INVALID_SEED", () => {
    expect(() => new SeededRandom(3.14)).toThrow(KrynixError);
    try {
      new SeededRandom(3.14);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });

  test("nextUint32 returns values in [0, 2^32 - 1]", () => {
    const rng = new SeededRandom(42);

    for (let i = 0; i < 1000; i++) {
      const value = rng.nextUint32();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  test("1000 UUIDs from same instance have no collisions", () => {
    const rng = new SeededRandom(42);
    const uuids = new Set<string>();

    for (let i = 0; i < 1000; i++) {
      uuids.add(rng.nextUUID());
    }

    expect(uuids.size).toBe(1000);
  });
});
