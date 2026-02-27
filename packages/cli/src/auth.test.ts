import { describe, test, expect } from "vitest";
import { runAuthStatus, runAuthLogout, runAuthLogin, runAuthCreateKey } from "./auth.js";
import type { ControlPlaneConfig } from "./config.js";
import type { Credentials } from "./credentials.js";
import type { AuthLoginOutput, AuthCreateKeyOutput } from "./auth.js";

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

// ---------------------------------------------------------------------------
// Helpers — mock fetch
// ---------------------------------------------------------------------------

function mockFetchOk(body: Record<string, unknown>): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;
}

function mockFetchError(status: number, body?: Record<string, unknown>): typeof fetch {
  return (() =>
    Promise.resolve({
      ok: false,
      status,
      json: () =>
        body !== undefined ? Promise.resolve(body) : Promise.reject(new Error("no body")),
    })) as unknown as typeof fetch;
}

function mockFetchThrow(message: string): typeof fetch {
  return (() => Promise.reject(new Error(message))) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Tests: runAuthLogin
// ---------------------------------------------------------------------------

describe("runAuthLogin", () => {
  test("errors when email is missing from both args and env", async () => {
    const result = await runAuthLogin(["--password", "secret"], {
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("email");
    expect(result.error).toContain("KRYNIX_EMAIL");
  });

  test("errors when password is missing", async () => {
    const result = await runAuthLogin(["--email", "user@test.com"], {
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("password");
    expect(result.error).toContain("KRYNIX_PASSWORD");
  });

  test("accepts email/password from env vars", async () => {
    let savedCreds: Credentials | null = null;
    const result = await runAuthLogin([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: (c: Credentials) => {
        savedCreds = c;
      },
      getEnv: (key: string) => {
        if (key === "KRYNIX_EMAIL") return "env@test.com";
        if (key === "KRYNIX_PASSWORD") return "env-pass";
        return undefined;
      },
      fetchFn: mockFetchOk({ token: "jwt-new", expires_at: "2099-12-31T00:00:00Z" }),
    });
    expect(result.exitCode).toBe(0);
    expect(savedCreds).not.toBeNull();
  });

  test("prefers flag over env var", async () => {
    let capturedBody: string | undefined;
    const fakeFetch = ((url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: "jwt-new", expires_at: "2099-12-31T00:00:00Z" }),
      });
    }) as unknown as typeof fetch;

    await runAuthLogin(["--email", "flag@test.com", "--password", "flag-pass"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {},
      getEnv: (key: string) => {
        if (key === "KRYNIX_EMAIL") return "env@test.com";
        if (key === "KRYNIX_PASSWORD") return "env-pass";
        return undefined;
      },
      fetchFn: fakeFetch,
    });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody as string);
    expect(parsed.email).toBe("flag@test.com");
    expect(parsed.password).toBe("flag-pass");
  });

  test("errors when config is not configured", async () => {
    const result = await runAuthLogin(["--email", "user@test.com", "--password", "pass"], {
      loadConfig: () => null,
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Control Plane not configured");
  });

  test("sends POST to /api/v1/auth/token with correct body", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    const fakeFetch = ((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: "jwt-abc", expires_at: "2099-12-31T00:00:00Z" }),
      });
    }) as unknown as typeof fetch;

    await runAuthLogin(["--email", "user@test.com", "--password", "secret"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {},
      fetchFn: fakeFetch,
      getEnv: () => undefined,
    });

    expect(capturedUrl).toBe("https://api.krynix.dev/api/v1/auth/token");
    const parsed = JSON.parse(capturedBody as string);
    expect(parsed.email).toBe("user@test.com");
    expect(parsed.password).toBe("secret");
  });

  test("saves credentials on success", async () => {
    let savedCreds: Credentials | null = null;
    await runAuthLogin(["--email", "user@test.com", "--password", "pass"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: (c: Credentials) => {
        savedCreds = c;
      },
      fetchFn: mockFetchOk({ token: "jwt-new", expires_at: "2099-12-31T00:00:00Z" }),
      getEnv: () => undefined,
    });
    expect(savedCreds).not.toBeNull();
    const sc = savedCreds as unknown as Credentials;
    expect(sc.token).toBe("jwt-new");
    expect(sc.expires_at).toBe("2099-12-31T00:00:00Z");
  });

  test("preserves existing api_key when saving token", async () => {
    let savedCreds: Credentials | null = null;
    await runAuthLogin(["--email", "user@test.com", "--password", "pass"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => ({ api_key: "existing-key" }),
      saveCredentials: (c: Credentials) => {
        savedCreds = c;
      },
      fetchFn: mockFetchOk({ token: "jwt-new", expires_at: "2099-12-31T00:00:00Z" }),
      getEnv: () => undefined,
    });
    const sc = savedCreds as unknown as Credentials;
    expect(sc.api_key).toBe("existing-key");
    expect(sc.token).toBe("jwt-new");
  });

  test("returns AuthLoginOutput on success", async () => {
    const result = await runAuthLogin(["--email", "user@test.com", "--password", "pass"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {},
      fetchFn: mockFetchOk({ token: "jwt-abc", expires_at: "2099-12-31T00:00:00Z" }),
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(0);
    const output = result.output as AuthLoginOutput;
    expect(output.authenticated).toBe(true);
    expect(output.email).toBe("user@test.com");
    expect(output.expires_at).toBe("2099-12-31T00:00:00Z");
  });

  test("returns error on HTTP 401", async () => {
    const result = await runAuthLogin(["--email", "user@test.com", "--password", "wrong"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {},
      fetchFn: mockFetchError(401, { message: "Invalid credentials" }),
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Login failed");
    expect(result.error).toContain("Invalid credentials");
  });

  test("returns error on network failure", async () => {
    const result = await runAuthLogin(["--email", "user@test.com", "--password", "pass"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {},
      fetchFn: mockFetchThrow("Connection refused"),
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Connection refused");
  });

  test("does not save credentials on failure", async () => {
    let saved = false;
    await runAuthLogin(["--email", "user@test.com", "--password", "wrong"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {
        saved = true;
      },
      fetchFn: mockFetchError(401, { message: "Bad" }),
      getEnv: () => undefined,
    });
    expect(saved).toBe(false);
  });

  test("handles response without token", async () => {
    const result = await runAuthLogin(["--email", "user@test.com", "--password", "pass"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {},
      fetchFn: mockFetchOk({ some_other_field: "value" }),
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("no token");
  });

  test("returns error on malformed JSON in success response", async () => {
    const badJsonFetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      })) as unknown as typeof fetch;

    const result = await runAuthLogin(["--email", "user@test.com", "--password", "pass"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
      saveCredentials: () => {},
      fetchFn: badJsonFetch,
      getEnv: () => undefined,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("invalid JSON response");
  });
});

// ---------------------------------------------------------------------------
// Tests: runAuthCreateKey
// ---------------------------------------------------------------------------

describe("runAuthCreateKey", () => {
  test("errors when not authenticated", async () => {
    const result = await runAuthCreateKey([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => null,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Not authenticated");
  });

  test("errors when config is not configured", async () => {
    const result = await runAuthCreateKey([], {
      loadConfig: () => null,
      loadCredentials: () => mockCreds,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Control Plane not configured");
  });

  test("errors when token is expired", async () => {
    const expiredCreds: Credentials = {
      token: "jwt-old",
      expires_at: "2020-01-01T00:00:00Z",
    };
    const result = await runAuthCreateKey([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => expiredCreds,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("expired");
  });

  test("sends POST to /api/v1/auth/api-keys with name", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    const fakeFetch = ((url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ api_key: "krynix-key-org-abc123def456" }),
      });
    }) as unknown as typeof fetch;

    await runAuthCreateKey(["--name", "my-key"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
      saveCredentials: () => {},
      fetchFn: fakeFetch,
    });

    expect(capturedUrl).toBe("https://api.krynix.dev/api/v1/auth/api-keys");
    const parsed = JSON.parse(capturedBody as string);
    expect(parsed.name).toBe("my-key");
  });

  test("sends POST without name when --name omitted", async () => {
    let capturedBody: string | undefined;
    const fakeFetch = ((url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ api_key: "krynix-key-org-abc123def456" }),
      });
    }) as unknown as typeof fetch;

    await runAuthCreateKey([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
      saveCredentials: () => {},
      fetchFn: fakeFetch,
    });

    const parsed = JSON.parse(capturedBody as string);
    expect(parsed.name).toBeUndefined();
  });

  test("saves api_key on success, preserving existing token", async () => {
    let savedCreds: Credentials | null = null;
    await runAuthCreateKey(["--name", "my-key"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
      saveCredentials: (c: Credentials) => {
        savedCreds = c;
      },
      fetchFn: mockFetchOk({ api_key: "krynix-key-org-abc123def456" }),
    });
    expect(savedCreds).not.toBeNull();
    const sc = savedCreds as unknown as Credentials;
    expect(sc.api_key).toBe("krynix-key-org-abc123def456");
    expect(sc.token).toBe("jwt-abc");
  });

  test("returns AuthCreateKeyOutput on success", async () => {
    const result = await runAuthCreateKey(["--name", "my-key"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
      saveCredentials: () => {},
      fetchFn: mockFetchOk({ api_key: "krynix-key-org-abc123def456" }),
    });
    expect(result.exitCode).toBe(0);
    const output = result.output as AuthCreateKeyOutput;
    expect(output.created).toBe(true);
    expect(output.key_name).toBe("my-key");
    expect(output.api_key_preview).toBe("krynix-k...");
  });

  test("sends Authorization header with Bearer token", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fakeFetch = ((url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ api_key: "krynix-key-org-abc123def456" }),
      });
    }) as unknown as typeof fetch;

    await runAuthCreateKey([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
      saveCredentials: () => {},
      fetchFn: fakeFetch,
    });

    expect(capturedHeaders).toBeDefined();
    const headers = capturedHeaders as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer jwt-abc");
  });

  test("returns error on HTTP 403", async () => {
    const result = await runAuthCreateKey([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
      saveCredentials: () => {},
      fetchFn: mockFetchError(403, { message: "Forbidden" }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("Create key failed");
    expect(result.error).toContain("Forbidden");
  });

  test("uses api_key for auth when no token present", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const apiKeyCreds: Credentials = { api_key: "krynix-existing-key" };
    const fakeFetch = ((url: string, init: RequestInit) => {
      capturedHeaders = init.headers as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ api_key: "krynix-new-key-abc123" }),
      });
    }) as unknown as typeof fetch;

    await runAuthCreateKey([], {
      loadConfig: () => mockConfig,
      loadCredentials: () => apiKeyCreds,
      saveCredentials: () => {},
      fetchFn: fakeFetch,
    });

    const authHeaders = capturedHeaders as Record<string, string>;
    expect(authHeaders["Authorization"]).toBe("Bearer krynix-existing-key");
  });

  test("returns error on malformed JSON in success response", async () => {
    const badJsonFetch = (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("Unexpected token")),
      })) as unknown as typeof fetch;

    const result = await runAuthCreateKey(["--name", "my-key"], {
      loadConfig: () => mockConfig,
      loadCredentials: () => mockCreds,
      saveCredentials: () => {},
      fetchFn: badJsonFetch,
    });
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain("invalid JSON response");
  });
});
