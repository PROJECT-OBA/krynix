import { describe, test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, parseConfigYaml } from "./config.js";

// ---------------------------------------------------------------------------
// Tests: parseConfigYaml (pure parsing, no I/O)
// ---------------------------------------------------------------------------

describe("parseConfigYaml", () => {
  test("parses valid config with control_plane section", () => {
    const yaml = `
control_plane:
  url: https://api.krynix.dev
  org_id: org-123
  policy_sync: true
  fail_on_push_error: false
`;
    const config = parseConfigYaml(yaml);
    expect(config.url).toBe("https://api.krynix.dev");
    expect(config.org_id).toBe("org-123");
    expect(config.policy_sync).toBe(true);
    expect(config.fail_on_push_error).toBe(false);
  });

  test("parses quoted values", () => {
    const yaml = `
control_plane:
  url: "https://api.krynix.dev"
  org_id: 'org-456'
`;
    const config = parseConfigYaml(yaml);
    expect(config.url).toBe("https://api.krynix.dev");
    expect(config.org_id).toBe("org-456");
  });

  test("throws on missing url", () => {
    const yaml = `
control_plane:
  org_id: org-123
`;
    expect(() => parseConfigYaml(yaml)).toThrow("control_plane.url");
  });

  test("throws on missing org_id", () => {
    const yaml = `
control_plane:
  url: https://api.krynix.dev
`;
    expect(() => parseConfigYaml(yaml)).toThrow("control_plane.org_id");
  });

  test("ignores unknown keys (forward compatibility)", () => {
    const yaml = `
control_plane:
  url: https://api.krynix.dev
  org_id: org-123
  future_key: some_value
`;
    const config = parseConfigYaml(yaml);
    expect(config.url).toBe("https://api.krynix.dev");
    expect(config.org_id).toBe("org-123");
  });

  test("defaults booleans to false when not specified", () => {
    const yaml = `
control_plane:
  url: https://api.krynix.dev
  org_id: org-123
`;
    const config = parseConfigYaml(yaml);
    expect(config.policy_sync).toBe(false);
    expect(config.fail_on_push_error).toBe(false);
  });

  test("strips inline comments", () => {
    const yaml = `
control_plane:
  url: https://api.krynix.dev # the API URL
  org_id: org-123 # our org
`;
    const config = parseConfigYaml(yaml);
    expect(config.url).toBe("https://api.krynix.dev");
    expect(config.org_id).toBe("org-123");
  });

  test("preserves # inside quoted values", () => {
    const yaml = `
control_plane:
  url: "https://api.krynix.dev/v1#debug"
  org_id: "org-123"
`;
    const config = parseConfigYaml(yaml);
    expect(config.url).toBe("https://api.krynix.dev/v1#debug");
  });

  test("strips quotes from values that have inline comments after closing quote", () => {
    const yaml = `
control_plane:
  url: "https://api.krynix.dev"  # production API
  org_id: "org-123"              # our org
`;
    const config = parseConfigYaml(yaml);
    expect(config.url).toBe("https://api.krynix.dev");
    expect(config.org_id).toBe("org-123");
  });

  test("skips comment-only lines and empty lines", () => {
    const yaml = `
# This is a config file

control_plane:
  # API settings
  url: https://api.krynix.dev

  org_id: org-123
`;
    const config = parseConfigYaml(yaml);
    expect(config.url).toBe("https://api.krynix.dev");
    expect(config.org_id).toBe("org-123");
  });
});

// ---------------------------------------------------------------------------
// Tests: loadConfig (file I/O)
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  let tmpDir: string;

  test("returns null when file does not exist", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-config-"));
    try {
      const config = loadConfig(join(tmpDir, "nonexistent.yaml"));
      expect(config).toBeNull();
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("loads and parses a valid config file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-config-"));
    try {
      const configPath = join(tmpDir, "config.yaml");
      writeFileSync(
        configPath,
        `control_plane:\n  url: https://api.krynix.dev\n  org_id: org-789\n`,
      );

      const config = loadConfig(configPath);
      expect(config).not.toBeNull();
      expect(config?.url).toBe("https://api.krynix.dev");
      expect(config?.org_id).toBe("org-789");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("throws on malformed config file", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "krynix-config-"));
    try {
      const configPath = join(tmpDir, "config.yaml");
      writeFileSync(configPath, `control_plane:\n  org_id: org-123\n`);

      // Missing url
      expect(() => loadConfig(configPath)).toThrow("control_plane.url");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
