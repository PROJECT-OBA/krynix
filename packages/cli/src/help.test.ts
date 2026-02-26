import { describe, test, expect } from "vitest";
import { getVersion, getMainHelp, getCommandHelp } from "./help.js";

describe("getVersion", () => {
  test("returns version string starting with krynix", () => {
    const version = getVersion();
    expect(version).toMatch(/^krynix \d+\.\d+\.\d+/);
  });
});

describe("getMainHelp", () => {
  test("mentions all commands", () => {
    const help = getMainHelp();
    expect(help).toContain("evaluate");
    expect(help).toContain("replay");
    expect(help).toContain("validate");
    expect(help).toContain("stats");
    expect(help).toContain("policy test");
  });

  test("mentions --help and --version flags", () => {
    const help = getMainHelp();
    expect(help).toContain("--help");
    expect(help).toContain("--version");
  });
});

describe("getCommandHelp", () => {
  test("evaluate help mentions --trace and --policy", () => {
    const help = getCommandHelp("evaluate");
    expect(help).toBeDefined();
    expect(help).toContain("--trace");
    expect(help).toContain("--policy");
  });

  test("replay help mentions --verify and --regenerate", () => {
    const help = getCommandHelp("replay");
    expect(help).toBeDefined();
    expect(help).toContain("--verify");
    expect(help).toContain("--regenerate");
  });

  test("validate help mentions --policy", () => {
    const help = getCommandHelp("validate");
    expect(help).toBeDefined();
    expect(help).toContain("--policy");
  });

  test("returns undefined for unknown command", () => {
    const help = getCommandHelp("unknown");
    expect(help).toBeUndefined();
  });

  test("stats help mentions --trace", () => {
    const help = getCommandHelp("stats");
    expect(help).toBeDefined();
    expect(help).toContain("--trace");
    expect(help).toContain("event_count");
  });

  test("policy namespace help lists subcommands", () => {
    const help = getCommandHelp("policy");
    expect(help).toBeDefined();
    expect(help).toContain("test");
    expect(help).toContain("diff");
    expect(help).toContain("subcommand");
  });

  test("policy test help mentions --policy and --trace", () => {
    const help = getCommandHelp("policy test");
    expect(help).toBeDefined();
    expect(help).toContain("--policy");
    expect(help).toContain("--trace");
    expect(help).toContain("--expect-verdict");
  });

  test("policy diff help mentions --old and --new", () => {
    const help = getCommandHelp("policy diff");
    expect(help).toBeDefined();
    expect(help).toContain("--old");
    expect(help).toContain("--new");
  });

  test("export help mentions --format and --trace", () => {
    const help = getCommandHelp("export");
    expect(help).toBeDefined();
    expect(help).toContain("--format");
    expect(help).toContain("--trace");
    expect(help).toContain("otlp-json");
  });
});
