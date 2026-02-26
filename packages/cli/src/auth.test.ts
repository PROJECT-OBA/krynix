import { describe, test, expect } from "vitest";
import { runAuthStatus, runAuthLogout } from "./auth.js";
import type { ControlPlaneConfig } from "./config.js";
import type { Credentials } from "./credentials.js";

// ---------------------------------------------------------------------------
// Helpers — mock deps
// ---------------------------------------------------------------------------

const mockConfig: ControlPlaneConfig = {
  url: "https://api.krynix.dev",
  org_id: "org-123",
  policy_sync: false,
  fail_on_push_error: false,
};

const mockCreds: Credentials = {
  token: "jwt-abc",
  expires_at: "2099-01-01T00:00:00Z",
};

// ---------------------------------------------------------------------------
// Tests: runAuthStatus
// ---------------------------------------------------------------------------

describe("runAuthStatus", () => {
  test("reports configured and authenticated when both exist", () => {
    const result = runAuthStatus([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).not.toBeNull();
    const output = result.output as {
      configured: boolean;
      authenticated: boolean;
      config_url: string;
      has_token: boolean;
      token_expired: boolean;
    };
    expect(output.configured).toBe(true);
    expect(output.authenticated).toBe(true);
    expect(output.config_url).toBe("https://api.krynix.dev");
    expect(output.has_token).toBe(true);
    expect(output.token_expired).toBe(false);
  });

  test("reports configured but not authenticated when no credentials", () => {
    const result = runAuthStatus([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
    });

    expect(result.exitCode).toBe(0);
    const output = result.output as { configured: boolean; authenticated: boolean };
    expect(output.configured).toBe(true);
    expect(output.authenticated).toBe(false);
  });

  test("reports not configured when no config file", () => {
    const result = runAuthStatus([], {
      loadConfig: () => null,
      loadCredentials: () => null,
    });

    expect(result.exitCode).toBe(0);
    const output = result.output as { configured: boolean; config_url: null };
    expect(output.configured).toBe(false);
    expect(output.config_url).toBeNull();
  });

  test("reports expired token as not authenticated", () => {
    const expiredCreds: Credentials = {
      token: "jwt-old",
      expires_at: "2020-01-01T00:00:00Z",
    };
    const result = runAuthStatus([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => expiredCreds,
    });

    expect(result.exitCode).toBe(0);
    const output = result.output as { token_expired: boolean; authenticated: boolean };
    expect(output.token_expired).toBe(true);
    expect(output.authenticated).toBe(false);
  });

  test("reports api_key authentication", () => {
    const apiKeyCreds: Credentials = { api_key: "krynix-key-org-abc123" };
    const result = runAuthStatus([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => apiKeyCreds,
    });

    expect(result.exitCode).toBe(0);
    const output = result.output as {
      has_api_key: boolean;
      has_token: boolean;
      authenticated: boolean;
    };
    expect(output.has_api_key).toBe(true);
    expect(output.has_token).toBe(false);
    expect(output.authenticated).toBe(true);
  });

  test("api_key auth not affected by stale expires_at field", () => {
    const apiKeyCreds: Credentials = {
      api_key: "krynix-key-org-abc123",
      expires_at: "2020-01-01T00:00:00Z",
    };
    const result = runAuthStatus([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => apiKeyCreds,
    });

    expect(result.exitCode).toBe(0);
    const output = result.output as { authenticated: boolean; token_expired: boolean | null };
    expect(output.authenticated).toBe(true);
    expect(output.token_expired).toBeNull();
  });

  test("empty-string token is not authenticated", () => {
    const emptyCreds: Credentials = { token: "" };
    const result = runAuthStatus([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => emptyCreds,
    });

    expect(result.exitCode).toBe(0);
    const output = result.output as { authenticated: boolean; has_token: boolean };
    expect(output.has_token).toBe(false);
    expect(output.authenticated).toBe(false);
  });

  test("empty-string api_key is not authenticated", () => {
    const emptyCreds: Credentials = { api_key: "" };
    const result = runAuthStatus([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => emptyCreds,
    });

    expect(result.exitCode).toBe(0);
    const output = result.output as { authenticated: boolean; has_api_key: boolean };
    expect(output.has_api_key).toBe(false);
    expect(output.authenticated).toBe(false);
  });

  test("returns error on loadConfig failure", () => {
    const result = runAuthStatus([], {
      loadConfig: () => {
        throw new Error("bad config");
      },
      loadCredentials: () => null,
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("bad config");
  });
});

// ---------------------------------------------------------------------------
// Tests: runAuthLogout
// ---------------------------------------------------------------------------

describe("runAuthLogout", () => {
  test("clears credentials and reports success", () => {
    let cleared = false;
    const result = runAuthLogout([], {
      clearCredentials: () => {
        cleared = true;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(cleared).toBe(true);
    const output = result.output as { cleared: boolean; message: string };
    expect(output.cleared).toBe(true);
    expect(output.message).toContain("Credentials cleared");
  });

  test("returns error on clearCredentials failure", () => {
    const result = runAuthLogout([], {
      clearCredentials: () => {
        throw new Error("permission denied");
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("permission denied");
  });
});
