/**
 * CLI auth commands — `auth status` and `auth logout`.
 *
 * Pure functions that return structured results.
 * `auth login` and `auth create-key` are deferred (require HTTP client).
 *
 * @module
 */

import { loadConfig, type ControlPlaneConfig } from "./config.js";
import {
  loadCredentials,
  clearCredentials,
  isTokenExpired,
  type Credentials,
} from "./credentials.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Result from an auth command. */
export interface AuthResult {
  exitCode: number;
  output: AuthStatusOutput | AuthLogoutOutput | null;
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

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

/** Injectable dependencies for auth commands (for testing). */
export interface AuthDeps {
  loadConfig: (path?: string) => ControlPlaneConfig | null;
  loadCredentials: (path?: string) => Credentials | null;
  clearCredentials: (path?: string) => void;
}

const defaultDeps: AuthDeps = {
  loadConfig,
  loadCredentials,
  clearCredentials,
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
