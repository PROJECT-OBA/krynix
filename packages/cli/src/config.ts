/**
 * Control Plane configuration loader.
 *
 * Parses a simple YAML config file at `~/.krynix/config.yaml`.
 * Uses manual key-value parsing (no external YAML dependency) since
 * the config is a single `control_plane` section with flat key-value pairs.
 *
 * @module
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Control Plane configuration. */
export interface ControlPlaneConfig {
  /** Control Plane API URL (e.g., "https://api.krynix.dev"). */
  url: string;
  /** Organization ID. */
  org_id: string;
  /** Whether to sync policies from registry before evaluate (default: false). */
  policy_sync: boolean;
  /** Whether to fail CI if push fails (default: false). */
  fail_on_push_error: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG_PATH = join(homedir(), ".krynix", "config.yaml");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load Control Plane configuration from a YAML file.
 *
 * @param configPath - Path to the config file (defaults to `~/.krynix/config.yaml`)
 * @returns Parsed config, or `null` if the file does not exist
 * @throws {Error} If the file exists but is malformed or missing required fields
 */
export function loadConfig(configPath?: string): ControlPlaneConfig | null {
  const path = configPath ?? DEFAULT_CONFIG_PATH;

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  return parseConfigYaml(content);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a simple YAML config string.
 *
 * Supports a single `control_plane:` section containing flat key-value pairs.
 * Handles strings (quoted or unquoted), booleans, and ignores comments.
 */
export function parseConfigYaml(content: string): ControlPlaneConfig {
  const lines = content.split("\n");
  const values: Record<string, string> = {};
  let inControlPlane = false;

  for (const raw of lines) {
    const line = raw.trim();

    // Skip empty lines and comments
    if (line === "" || line.startsWith("#")) continue;

    // Check for section header
    if (line === "control_plane:" || line === "control_plane :") {
      inControlPlane = true;
      continue;
    }

    // Non-indented line after control_plane ends the section
    if (inControlPlane && !raw.startsWith(" ") && !raw.startsWith("\t")) {
      inControlPlane = false;
    }

    // Parse key: value (only inside control_plane section)
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    // Handle quoted values and inline comments.
    // A quoted value starts with " or ' — find the matching closing quote,
    // then ignore anything after it (including inline comments).
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value.charAt(0);
      const closeIdx = value.indexOf(quote, 1);
      if (closeIdx !== -1) {
        value = value.slice(1, closeIdx);
      } else {
        // No closing quote found — treat as unquoted, strip the leading quote
        value = value.slice(1);
        const commentIdx = value.indexOf("#");
        if (commentIdx !== -1) {
          value = value.slice(0, commentIdx).trim();
        }
      }
    } else {
      // Unquoted value — strip inline comments
      const commentIdx = value.indexOf("#");
      if (commentIdx !== -1) {
        value = value.slice(0, commentIdx).trim();
      }
    }

    if (inControlPlane || key === "control_plane") {
      // Skip the section key itself
      if (key !== "control_plane") {
        values[key] = value;
      }
    }
  }

  // Validate required fields
  const url = values["url"];
  const orgId = values["org_id"];

  if (url === undefined || url === "") {
    throw new Error("Config missing required field: control_plane.url");
  }
  if (orgId === undefined || orgId === "") {
    throw new Error("Config missing required field: control_plane.org_id");
  }

  return {
    url,
    org_id: orgId,
    policy_sync: parseBool(values["policy_sync"], false),
    fail_on_push_error: parseBool(values["fail_on_push_error"], false),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return value === "true" || value === "yes";
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}
