/**
 * HTTP client for Control Plane API communication.
 *
 * Uses native `fetch()` (Node.js 20+). All methods return structured
 * results — no unhandled throws.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ControlPlaneConfig } from "./config.js";
import type { Credentials } from "./credentials.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Response from a Control Plane API call. */
export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

/** Control Plane HTTP client. */
export interface ControlPlaneClient {
  pushTrace(filePath: string): Promise<ApiResponse>;
  pushEvaluation(data: unknown): Promise<ApiResponse>;
  pushReplayReport(data: unknown): Promise<ApiResponse>;
  pullPolicies(options?: { labels?: string }): Promise<ApiResponse>;
  pushPolicy(yamlContent: string, changelog?: string): Promise<ApiResponse>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a Control Plane HTTP client.
 *
 * Org scoping is derived from the authentication token/API key on the
 * server side — `config.org_id` is not sent as a header or URL prefix.
 * It is used elsewhere (e.g., compliance bundles) for manifest metadata.
 *
 * @param config - Control Plane configuration (URL, org_id)
 * @param credentials - Authentication credentials (token or API key)
 * @param fetchFn - Optional fetch implementation (for testing)
 */
export function createControlPlaneClient(
  config: ControlPlaneConfig,
  credentials: Credentials,
  fetchFn: typeof fetch = globalThis.fetch,
): ControlPlaneClient {
  const baseUrl = config.url.replace(/\/$/, "");

  function getAuthHeader(): string {
    if (typeof credentials.token === "string" && credentials.token !== "") {
      return `Bearer ${credentials.token}`;
    }
    if (typeof credentials.api_key === "string" && credentials.api_key !== "") {
      return `Bearer ${credentials.api_key}`;
    }
    return "";
  }

  async function apiRequest<T>(
    method: string,
    path: string,
    options: {
      body?: string | Buffer;
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResponse<T>> {
    const url = `${baseUrl}${path}`;
    const authValue = getAuthHeader();
    const headers: Record<string, string> = {
      ...(authValue !== "" ? { Authorization: authValue } : {}),
      ...options.headers,
    };

    try {
      const response = await fetchFn(url, {
        method,
        headers,
        body: options.body,
      });

      let data: T | null = null;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        data = (await response.json()) as T;
      }

      if (!response.ok) {
        const errorMessage =
          data !== null &&
          typeof data === "object" &&
          "message" in (data as Record<string, unknown>)
            ? String((data as Record<string, unknown>)["message"])
            : `HTTP ${String(response.status)}`;
        return { ok: false, status: response.status, data, error: errorMessage };
      }

      return { ok: true, status: response.status, data, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 0, data: null, error: `Network error: ${message}` };
    }
  }

  return {
    async pushTrace(filePath: string): Promise<ApiResponse> {
      let content: Buffer;
      try {
        content = await readFile(filePath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, data: null, error: `File read error: ${message}` };
      }
      const digest = createHash("sha256").update(content).digest("hex");

      return apiRequest("POST", "/api/v1/traces", {
        body: content,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Krynix-Digest": `sha256:${digest}`,
        },
      });
    },

    async pushEvaluation(data: unknown): Promise<ApiResponse> {
      return apiRequest("POST", "/api/v1/evaluations", {
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      });
    },

    async pushReplayReport(data: unknown): Promise<ApiResponse> {
      return apiRequest("POST", "/api/v1/replays", {
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      });
    },

    async pullPolicies(options?: { labels?: string }): Promise<ApiResponse> {
      let path = "/api/v1/policies";
      if (options?.labels !== undefined) {
        path += `?labels=${encodeURIComponent(options.labels)}`;
      }
      return apiRequest("GET", path);
    },

    async pushPolicy(yamlContent: string, changelog?: string): Promise<ApiResponse> {
      return apiRequest("POST", "/api/v1/policies", {
        body: JSON.stringify({ yaml_content: yamlContent, changelog }),
        headers: { "Content-Type": "application/json" },
      });
    },
  };
}
