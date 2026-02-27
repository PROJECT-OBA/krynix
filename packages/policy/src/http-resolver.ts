/**
 * HTTP-based policy resolver for fetching policies from a remote registry.
 *
 * Creates a `PolicyResolver` that resolves `name@version` references by
 * fetching from an HTTP API endpoint with timeout and retry support.
 *
 * @module
 */

import type { Policy } from "./schema.js";
import type { PolicyResolver } from "./inheritance.js";
import { parsePolicy } from "./parser.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Configuration for the HTTP policy resolver. */
export interface HttpPolicyResolverOptions {
  /** Base URL of the policy registry API (e.g., `"https://cp.krynix.dev"`). */
  baseUrl: string;
  /** Authorization header value (e.g., `"Bearer token123"`). Optional. */
  authHeader?: string;
  /** Custom fetch implementation (for testing). Defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /** Request timeout in milliseconds. Default: 10_000 (10 seconds). */
  timeoutMs?: number;
  /** Maximum number of retry attempts on transient errors (5xx, network). Default: 2. */
  maxRetries?: number;
  /** Base delay between retries in milliseconds (doubled each attempt). Default: 500. */
  retryDelayMs?: number;
}

/** Default timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Default maximum retries. */
const DEFAULT_MAX_RETRIES = 2;

/** Default base retry delay in milliseconds. */
const DEFAULT_RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a `PolicyResolver` that fetches policies from an HTTP registry.
 *
 * Ref format: `"name@version"` (e.g., `"tool-safety@1.0.0"`).
 * Scoped names like `"@scope/name@1.0.0"` are supported via `lastIndexOf("@")`.
 *
 * Fetches `GET {baseUrl}/api/v1/policies/{name}/versions/{version}` and expects
 * a JSON response containing `{ yaml_content: string }`.
 *
 * Features:
 * - Timeout via AbortSignal (default 10s), covers both headers and body read
 * - Retry with exponential backoff on 5xx / network errors (default 2 retries)
 * - Identity validation: fetched policy metadata.name/version must match the ref
 *
 * @param options - Resolver configuration
 * @returns A PolicyResolver function
 */
export function createHttpPolicyResolver(options: HttpPolicyResolverOptions): PolicyResolver {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`Invalid timeoutMs: ${String(timeoutMs)}. Expected a positive number.`);
  }
  if (!Number.isFinite(maxRetries) || !Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError(
      `Invalid maxRetries: ${String(maxRetries)}. Expected a non-negative integer.`,
    );
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0) {
    throw new RangeError(
      `Invalid retryDelayMs: ${String(retryDelayMs)}. Expected a positive number.`,
    );
  }

  return async (ref: string): Promise<Policy> => {
    const { name, version } = parseRef(ref);

    const url = `${baseUrl}/api/v1/policies/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (options.authHeader !== undefined) {
      headers["Authorization"] = options.authHeader;
    }

    const policy = await fetchAndParse(fetchImpl, url, headers, ref, {
      timeoutMs,
      maxRetries,
      retryDelayMs,
    });

    // Validate that the fetched policy identity matches the requested ref.
    if (policy.metadata.name !== name || policy.metadata.version !== version) {
      throw new Error(
        `Policy identity mismatch for "${ref}": ` +
          `expected name="${name}" version="${version}", ` +
          `got name="${policy.metadata.name}" version="${policy.metadata.version}"`,
      );
    }

    return policy;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fetch, read body, parse JSON, and parse policy YAML — with timeout and retry.
 *
 * The AbortSignal timeout covers the entire lifecycle: TCP connect, TLS
 * handshake, headers, AND body read (response.json()). This prevents hangs
 * when a server sends headers but stalls the body.
 *
 * Retries on:
 * - Network errors (fetch throws)
 * - HTTP 5xx responses
 *
 * Does NOT retry on:
 * - HTTP 4xx (client errors like 404, 401 — these are permanent)
 * - Timeout (AbortError — treated as a hard failure)
 * - Parse errors (malformed JSON, invalid YAML — these are permanent)
 */
async function fetchAndParse(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  ref: string,
  config: { timeoutMs: number; maxRetries: number; retryDelayMs: number },
): Promise<Policy> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = config.retryDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    // Track whether we received an HTTP response (any status). Once we have
    // a response, errors from our own processing (4xx throw, JSON parse, YAML
    // parse, missing yaml_content) are permanent and must not be retried.
    // Only pre-response errors (network failures) are retryable.
    let receivedResponse = false;

    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      receivedResponse = true;

      // Don't retry client errors (4xx) — they're permanent
      if (response.status >= 400 && response.status < 500) {
        clearTimeout(timer);
        throw new Error(
          `Failed to fetch policy "${ref}": HTTP ${String(response.status)} ${response.statusText}`,
        );
      }

      if (!response.ok) {
        // 5xx — retryable; clear timer and reset flag before next attempt
        clearTimeout(timer);
        receivedResponse = false;
        lastError = new Error(
          `Failed to fetch policy "${ref}": HTTP ${String(response.status)} ${response.statusText}`,
        );
        continue;
      }

      // Read body while timeout is still active (covers stalled body)
      let data: Record<string, unknown>;
      try {
        data = (await response.json()) as Record<string, unknown>;
      } catch {
        clearTimeout(timer);
        throw new Error(`Failed to parse JSON response for policy "${ref}"`);
      }

      // Body consumed — no longer need the timeout
      clearTimeout(timer);

      if (typeof data["yaml_content"] !== "string" || data["yaml_content"] === "") {
        throw new Error(`Invalid response for policy "${ref}": missing yaml_content`);
      }

      return parsePolicy(data["yaml_content"] as string);
    } catch (err: unknown) {
      clearTimeout(timer);

      // AbortError from timeout — don't retry
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Failed to fetch policy "${ref}": request timed out after ${String(config.timeoutMs)}ms`,
        );
      }

      // If we received an HTTP response (any status code), all errors from
      // here are permanent: 4xx throws, JSON parse failure, missing yaml_content,
      // malformed YAML, policy validation — none will succeed on retry.
      if (receivedResponse) {
        throw err;
      }

      // Network / other fetch error — retryable
      const message = err instanceof Error ? err.message : String(err);
      lastError = new Error(`Failed to fetch policy "${ref}": ${message}`);
    }
  }

  // All retries exhausted
  throw lastError ?? new Error(`Failed to fetch policy "${ref}": unknown error`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a `name@version` reference string.
 *
 * Uses `lastIndexOf("@")` to handle scoped names like `@scope/name@1.0.0`.
 */
function parseRef(ref: string): { name: string; version: string } {
  const atIdx = ref.lastIndexOf("@");

  if (atIdx <= 0) {
    throw new Error(`Invalid policy reference "${ref}": expected "name@version" format`);
  }

  const name = ref.slice(0, atIdx);
  const version = ref.slice(atIdx + 1);

  if (name === "" || version === "") {
    throw new Error(`Invalid policy reference "${ref}": expected "name@version" format`);
  }

  return { name, version };
}
