/**
 * CLI auth commands — `auth status`, `auth logout`, `auth login`, `auth create-key`.
 *
 * Pure functions that return structured results.
 *
 * @module
 */

import { loadConfig, type ControlPlaneConfig } from "./config.js";
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  isTokenExpired,
  type Credentials,
} from "./credentials.js";
import { getArg } from "./arg-parser.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from an auth command. */
export interface AuthResult {
  exitCode: number;
  output: AuthStatusOutput | AuthLogoutOutput | AuthLoginOutput | AuthCreateKeyOutput | null;
  error: string | null;
}

/** Output from `auth status`. */
export interface AuthStatusOutput {
  configured: boolean;
  authenticated: boolean;
  config_url: string | null;
  config_org_id: string | null;
  has_token: boolean;
  has_api_key: boolean;
  token_expired: boolean | null;
  expires_at: string | null;
}

/** Output from `auth logout`. */
export interface AuthLogoutOutput {
  cleared: boolean;
  message: string;
}

/** Output from `auth login`. */
export interface AuthLoginOutput {
  authenticated: boolean;
  email: string;
  expires_at: string | null;
}

/** Output from `auth create-key`. */
export interface AuthCreateKeyOutput {
  created: boolean;
  key_name: string | null;
  api_key_preview: string;
}

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

/** Injectable dependencies for auth commands (for testing). */
export interface AuthDeps {
  loadConfig: (path?: string) => ControlPlaneConfig | null;
  loadCredentials: (path?: string) => Credentials | null;
  clearCredentials: (path?: string) => void;
}

/** Injectable dependencies for auth login (for testing). */
export interface AuthLoginDeps {
  loadConfig: (path?: string) => ControlPlaneConfig | null;
  loadCredentials: (path?: string) => Credentials | null;
  saveCredentials: (creds: Credentials, path?: string) => void;
  fetchFn: typeof fetch;
  getEnv: (key: string) => string | undefined;
}

/** Injectable dependencies for auth create-key (for testing). */
export interface AuthCreateKeyDeps {
  loadConfig: (path?: string) => ControlPlaneConfig | null;
  loadCredentials: (path?: string) => Credentials | null;
  saveCredentials: (creds: Credentials, path?: string) => void;
  fetchFn: typeof fetch;
}

const defaultDeps: AuthDeps = {
  loadConfig,
  loadCredentials,
  clearCredentials,
};

const defaultLoginDeps: AuthLoginDeps = {
  loadConfig,
  loadCredentials,
  saveCredentials,
  fetchFn: globalThis.fetch,
  getEnv: (key: string) => process.env[key],
};

const defaultCreateKeyDeps: AuthCreateKeyDeps = {
  loadConfig,
  loadCredentials,
  saveCredentials,
  fetchFn: globalThis.fetch,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show current authentication status.
 *
 * Reports whether config and credentials are present, token expiry, etc.
 */
export function runAuthStatus(_args: string[], deps: Partial<AuthDeps> = {}): AuthResult {
  const d = { ...defaultDeps, ...deps };

  try {
    const config = d.loadConfig();
    const creds = d.loadCredentials();

    const hasToken = typeof creds?.token === "string" && creds.token !== "";
    const hasApiKey = typeof creds?.api_key === "string" && creds.api_key !== "";
    const hasCredentials = creds !== null && (hasToken || hasApiKey);
    // Token expiry only applies when authenticating via token
    const tokenExpired = hasToken && creds !== null ? isTokenExpired(creds) : null;
    // API key auth is not affected by token expiry
    const authenticated = hasApiKey ? hasCredentials : hasCredentials && tokenExpired !== true;

    const output: AuthStatusOutput = {
      configured: config !== null,
      authenticated,
      config_url: config?.url ?? null,
      config_org_id: config?.org_id ?? null,
      has_token: hasToken,
      has_api_key: hasApiKey,
      token_expired: tokenExpired,
      expires_at: creds?.expires_at ?? null,
    };

    return { exitCode: 0, output, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: message };
  }
}

/**
 * Clear stored credentials (logout).
 */
export function runAuthLogout(_args: string[], deps: Partial<AuthDeps> = {}): AuthResult {
  const d = { ...defaultDeps, ...deps };

  try {
    d.clearCredentials();
    const output: AuthLogoutOutput = {
      cleared: true,
      message: "Credentials cleared.",
    };
    return { exitCode: 0, output, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: message };
  }
}

/**
 * Authenticate with the Control Plane via email/password.
 *
 * POST `/api/v1/auth/token` with `{email, password}`.
 * Stores token + expires_at on success, preserving any existing api_key.
 */
export async function runAuthLogin(
  args: string[],
  deps: Partial<AuthLoginDeps> = {},
): Promise<AuthResult> {
  const d = { ...defaultLoginDeps, ...deps };

  const emailArg = getArg(args, "--email");
  const passwordArg = getArg(args, "--password");

  const email = emailArg ?? d.getEnv("KRYNIX_EMAIL");
  const password = passwordArg ?? d.getEnv("KRYNIX_PASSWORD");

  if (email === undefined || email === "") {
    return {
      exitCode: 1,
      output: null,
      error: "Missing email. Provide --email or set KRYNIX_EMAIL environment variable.",
    };
  }

  if (password === undefined || password === "") {
    return {
      exitCode: 1,
      output: null,
      error: "Missing password. Provide --password or set KRYNIX_PASSWORD environment variable.",
    };
  }

  const config = d.loadConfig();
  if (config === null) {
    return {
      exitCode: 1,
      output: null,
      error:
        "Control Plane not configured. Create ~/.krynix/config.yaml with control_plane.url and control_plane.org_id.",
    };
  }

  const baseUrl = config.url.replace(/\/+$/, "");

  try {
    const response = await d.fetchFn(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const serverMessage =
        data !== null && typeof data["message"] === "string"
          ? data["message"]
          : `HTTP ${String(response.status)}`;
      return { exitCode: 1, output: null, error: `Login failed: ${serverMessage}` };
    }

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (data === null) {
      return { exitCode: 1, output: null, error: "Login failed: invalid JSON response" };
    }
    const token = typeof data["token"] === "string" ? data["token"] : undefined;
    const expiresAt = typeof data["expires_at"] === "string" ? data["expires_at"] : undefined;

    if (token === undefined) {
      return { exitCode: 1, output: null, error: "Login failed: no token in response" };
    }

    // Preserve existing api_key when saving new token
    const existing = d.loadCredentials();
    d.saveCredentials({
      ...(existing?.api_key !== undefined ? { api_key: existing.api_key } : {}),
      token,
      ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
    });

    const output: AuthLoginOutput = {
      authenticated: true,
      email,
      expires_at: expiresAt ?? null,
    };

    return { exitCode: 0, output, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: message };
  }
}

/**
 * Create an API key via the Control Plane.
 *
 * POST `/api/v1/auth/api-keys` with `{name}` (requires existing auth).
 * Stores api_key on success, preserving any existing token.
 */
export async function runAuthCreateKey(
  args: string[],
  deps: Partial<AuthCreateKeyDeps> = {},
): Promise<AuthResult> {
  const d = { ...defaultCreateKeyDeps, ...deps };

  const keyName = getArg(args, "--name");

  const config = d.loadConfig();
  if (config === null) {
    return {
      exitCode: 1,
      output: null,
      error:
        "Control Plane not configured. Create ~/.krynix/config.yaml with control_plane.url and control_plane.org_id.",
    };
  }

  const creds = d.loadCredentials();
  if (creds === null || (!creds.token && !creds.api_key)) {
    return {
      exitCode: 1,
      output: null,
      error: "Not authenticated. Run 'krynix auth login' or set up an API key.",
    };
  }

  if (creds.token && isTokenExpired(creds)) {
    return {
      exitCode: 1,
      output: null,
      error: "Token has expired. Run 'krynix auth login' to refresh.",
    };
  }

  const baseUrl = config.url.replace(/\/+$/, "");
  const authValue =
    typeof creds.token === "string" && creds.token !== ""
      ? `Bearer ${creds.token}`
      : typeof creds.api_key === "string" && creds.api_key !== ""
        ? `Bearer ${creds.api_key}`
        : "";

  try {
    const response = await d.fetchFn(`${baseUrl}/api/v1/auth/api-keys`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authValue !== "" ? { Authorization: authValue } : {}),
      },
      body: JSON.stringify(keyName !== undefined ? { name: keyName } : {}),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const serverMessage =
        data !== null && typeof data["message"] === "string"
          ? data["message"]
          : `HTTP ${String(response.status)}`;
      return { exitCode: 1, output: null, error: `Create key failed: ${serverMessage}` };
    }

    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (data === null) {
      return {
        exitCode: 1,
        output: null,
        error: "Create key failed: invalid JSON response",
      };
    }
    const apiKey = typeof data["api_key"] === "string" ? data["api_key"] : undefined;

    if (apiKey === undefined) {
      return { exitCode: 1, output: null, error: "Create key failed: no api_key in response" };
    }

    // Preserve existing token when saving new api_key
    d.saveCredentials({
      ...(creds.token !== undefined ? { token: creds.token } : {}),
      ...(creds.expires_at !== undefined ? { expires_at: creds.expires_at } : {}),
      api_key: apiKey,
    });

    const output: AuthCreateKeyOutput = {
      created: true,
      key_name: keyName ?? null,
      api_key_preview: apiKey.length > 8 ? `${apiKey.slice(0, 8)}...` : apiKey,
    };

    return { exitCode: 0, output, error: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, output: null, error: message };
  }
}
