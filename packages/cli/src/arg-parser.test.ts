import { describe, test, expect } from "vitest";
import { getArg, getAllArgs, hasFlag, parseCommand } from "./arg-parser.js";

describe("getArg", () => {
  test("returns value after flag", () => {
    expect(getArg(["--trace", "file.jsonl"], "--trace")).toBe("file.jsonl");
  });

  test("returns undefined for missing flag", () => {
    expect(getArg(["--policy", "x"], "--trace")).toBeUndefined();
  });

  test("returns undefined when flag is last token (no value follows)", () => {
    expect(getArg(["--trace"], "--trace")).toBeUndefined();
  });
});

describe("hasFlag", () => {
  test("detects present boolean flag", () => {
    expect(hasFlag(["--verbose", "--trace", "x"], "--verbose")).toBe(true);
  });

  test("returns false for absent flag", () => {
    expect(hasFlag(["--trace", "x"], "--verbose")).toBe(false);
  });
});

describe("parseCommand", () => {
  test("extracts first positional as command", () => {
    const result = parseCommand(["evaluate", "--trace", "x"]);
    expect(result.command).toBe("evaluate");
    expect(result.rest).toEqual(["--trace", "x"]);
  });

  test("returns undefined command when only flags present", () => {
    const result = parseCommand(["--version"]);
    expect(result.command).toBeUndefined();
    expect(result.rest).toEqual(["--version"]);
  });

  test("empty args array returns undefined command and empty rest", () => {
    const result = parseCommand([]);
    expect(result.command).toBeUndefined();
    expect(result.rest).toEqual([]);
  });
});

describe("getAllArgs", () => {
  test("returns all values for a repeated flag", () => {
    const result = getAllArgs(["--trace", "a.jsonl", "--trace", "b.jsonl"], "--trace");
    expect(result).toEqual(["a.jsonl", "b.jsonl"]);
  });

  test("returns empty array when flag is absent", () => {
    const result = getAllArgs(["--policy", "x"], "--trace");
    expect(result).toEqual([]);
  });

  test("returns single value for one occurrence", () => {
    const result = getAllArgs(["--trace", "file.jsonl", "--verbose"], "--trace");
    expect(result).toEqual(["file.jsonl"]);
  });

  test("skips flag when it has no following value", () => {
    const result = getAllArgs(["--trace"], "--trace");
    expect(result).toEqual([]);
  });

  test("handles interleaved flags", () => {
    const result = getAllArgs(
      ["--trace", "a.jsonl", "--output", "/tmp", "--trace", "b.jsonl"],
      "--trace",
    );
    expect(result).toEqual(["a.jsonl", "b.jsonl"]);
  });
});
