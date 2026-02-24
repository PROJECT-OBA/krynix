import { describe, test, expect } from "vitest";
import { getArg, hasFlag, parseCommand } from "./arg-parser.js";

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
