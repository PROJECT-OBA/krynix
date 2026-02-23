import { describe, test, expect } from "vitest";
import { canonicalize } from "./canonical-json.js";
import { KrynixError } from "./errors.js";

describe("canonicalize", () => {
  test("produces identical output for objects with different key order", () => {
    const a = { b: 1, a: 2 };
    const b = { a: 2, b: 1 };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"a":2,"b":1}');
  });

  test("sorts keys at every nesting level", () => {
    const obj = {
      z: { c: 1, a: 2 },
      a: { z: 3, m: 4 },
    };
    expect(canonicalize(obj)).toBe('{"a":{"m":4,"z":3},"z":{"a":2,"c":1}}');
  });

  test("handles deeply nested structures", () => {
    const obj = { a: { b: { c: { d: "deep" } } } };
    expect(canonicalize(obj)).toBe('{"a":{"b":{"c":{"d":"deep"}}}}');
  });

  test("preserves non-ASCII characters (Unicode)", () => {
    const obj = { emoji: "\u{1F600}", cjk: "\u4E16\u754C" };
    const result = canonicalize(obj);
    expect(result).toContain("\u{1F600}");
    expect(result).toContain("\u4E16\u754C");
  });

  test("formats numbers minimally (1.0 → 1)", () => {
    expect(canonicalize(1.0)).toBe("1");
  });

  test("formats numbers minimally (0.10 → 0.1)", () => {
    expect(canonicalize(0.1)).toBe("0.1");
  });

  test("formats zero correctly", () => {
    expect(canonicalize(0)).toBe("0");
  });

  test("formats negative zero as 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  test("formats negative integers", () => {
    expect(canonicalize(-42)).toBe("-42");
  });

  test("serializes null", () => {
    expect(canonicalize(null)).toBe("null");
  });

  test("serializes booleans", () => {
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
  });

  test("serializes strings with escaping", () => {
    expect(canonicalize('hello "world"')).toBe('"hello \\"world\\""');
  });

  test("serializes empty object", () => {
    expect(canonicalize({})).toBe("{}");
  });

  test("serializes empty array", () => {
    expect(canonicalize([])).toBe("[]");
  });

  test("serializes arrays with mixed types", () => {
    expect(canonicalize([1, "two", true, null])).toBe('[1,"two",true,null]');
  });

  test("serializes nested arrays", () => {
    expect(
      canonicalize([
        [1, 2],
        [3, 4],
      ]),
    ).toBe("[[1,2],[3,4]]");
  });

  test("skips undefined values in objects", () => {
    const obj = { a: 1, b: undefined, c: 3 };
    expect(canonicalize(obj)).toBe('{"a":1,"c":3}');
  });

  test("serializes undefined in arrays as null", () => {
    expect(canonicalize([1, undefined, 3])).toBe("[1,null,3]");
  });

  test("produces no whitespace", () => {
    const obj = { key: [1, 2, { nested: true }] };
    const result = canonicalize(obj);
    expect(result).not.toContain(" ");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\t");
  });

  test("rejects NaN", () => {
    expect(() => canonicalize(NaN)).toThrow(KrynixError);
    expect(() => canonicalize(NaN)).toThrow("non-finite");
  });

  test("rejects Infinity", () => {
    expect(() => canonicalize(Infinity)).toThrow(KrynixError);
    expect(() => canonicalize(Infinity)).toThrow("non-finite");
  });

  test("rejects -Infinity", () => {
    expect(() => canonicalize(-Infinity)).toThrow(KrynixError);
    expect(() => canonicalize(-Infinity)).toThrow("non-finite");
  });

  test("rejects BigInt", () => {
    expect(() => canonicalize(BigInt(42))).toThrow(KrynixError);
    expect(() => canonicalize(BigInt(42))).toThrow("BigInt");
  });

  test("rejects NaN nested in object", () => {
    expect(() => canonicalize({ a: NaN })).toThrow(KrynixError);
  });

  test("rejects Infinity nested in array", () => {
    expect(() => canonicalize([1, Infinity])).toThrow(KrynixError);
  });
});
