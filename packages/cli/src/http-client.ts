/**
 * HTTP client for Control Plane API communication.
 *
 * Uses native `fetch()` (Node.js 20+). All methods return structured
 * results — no unhandled throws.
 *
 * @module
 */

import { createHash } from "node:crypto";
import { readFile, writeFile as fsWriteFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { ControlPlaneConfig } from "./config.js";
import type { Credentials } from "./credentials.js";
import type { BundleManifest } from "@krynix/core";

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

/** Metadata for promoting a trace to golden status. */
export interface GoldenTraceMetadata {
  name: string;
  description?: string;
  labels?: Record<string, string>;
}

/** Filters for listing golden traces. */
export interface GoldenTraceFilters {
  name?: string;
  label?: string;
  limit?: number;
}

/** A golden trace entry from the CP registry. */
export interface GoldenTraceEntry {
  id: string;
  name: string;
  description: string;
  created_at: string;
  event_count: number;
  labels: Record<string, string>;
}

/** Control Plane HTTP client. */
export interface ControlPlaneClient {
  pushTrace(filePath: string): Promise<ApiResponse>;
  pushEvaluation(data: unknown): Promise<ApiResponse>;
  pushReplayReport(data: unknown): Promise<ApiResponse>;
  pullPolicies(options?: { labels?: string; since?: string }): Promise<ApiResponse>;
  pushPolicy(yamlContent: string, changelog?: string): Promise<ApiResponse>;
  pushComplianceBundle(bundleDir: string): Promise<ApiResponse<{ bundle_id: string }>>;
  promoteGoldenTrace(
    tracePath: string,
    metadata: GoldenTraceMetadata,
  ): Promise<ApiResponse<{ golden_trace_id: string }>>;
  listGoldenTraces(filters?: GoldenTraceFilters): Promise<ApiResponse<GoldenTraceEntry[]>>;
  pullGoldenTrace(
    goldenTraceId: string,
    outputPath: string,
  ): Promise<ApiResponse<{ path: string }>>;
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
      ...options.headers,
      ...(authValue !== "" ? { Authorization: authValue } : {}),
    };

    try {
      const response = await fetchFn(url, {
        method,
        headers,
        body: options.body,
      });

      let data: T | null = null;
      let jsonParseError = false;
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        try {
          data = (await response.json()) as T;
        } catch {
          jsonParseError = true;
          data = null;
        }
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

      // Content-Type promised JSON but body was malformed — report as error
      if (jsonParseError) {
        return {
          ok: false,
          status: response.status,
          data: null,
          error: "Invalid JSON in response body",
        };
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

    async pullPolicies(options?: { labels?: string; since?: string }): Promise<ApiResponse> {
      let path = "/api/v1/policies";
      const params: string[] = [];
      if (options?.labels !== undefined) {
        params.push(`labels=${encodeURIComponent(options.labels)}`);
      }
      if (options?.since !== undefined) {
        params.push(`since=${encodeURIComponent(options.since)}`);
      }
      if (params.length > 0) {
        path += `?${params.join("&")}`;
      }
      return apiRequest("GET", path);
    },

    async pushPolicy(yamlContent: string, changelog?: string): Promise<ApiResponse> {
      return apiRequest("POST", "/api/v1/policies", {
        body: JSON.stringify({ yaml_content: yamlContent, changelog }),
        headers: { "Content-Type": "application/json" },
      });
    },

    async pushComplianceBundle(bundleDir: string): Promise<ApiResponse<{ bundle_id: string }>> {
      // Read manifest
      let manifestRaw: string;
      try {
        manifestRaw = await readFile(join(bundleDir, "manifest.json"), "utf-8");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, data: null, error: `Manifest read error: ${message}` };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(manifestRaw);
      } catch {
        return { ok: false, status: 0, data: null, error: "Invalid manifest JSON" };
      }

      // Validate manifest shape (must be a non-null, non-array object)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, status: 0, data: null, error: "Invalid manifest: not a JSON object" };
      }

      const manifest = parsed as BundleManifest;

      // Validate manifest schema before accessing fields
      const rawArtifacts: unknown = manifest.artifacts ?? [];
      if (!Array.isArray(rawArtifacts)) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: "Invalid manifest: artifacts is not an array",
        };
      }
      for (const entry of rawArtifacts) {
        const p =
          typeof entry === "object" && entry !== null
            ? (entry as Record<string, unknown>).path
            : undefined;
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof p !== "string" ||
          p === "" ||
          p === "." ||
          p === "./" ||
          p.endsWith("/")
        ) {
          return {
            ok: false,
            status: 0,
            data: null,
            error: "Invalid manifest: artifact entry has missing or degenerate path",
          };
        }
      }

      // Read all artifacts, sorted lexicographically by path for determinism
      const artifacts = [...(rawArtifacts as BundleManifest["artifacts"])].sort((a, b) => {
        if (a.path === b.path) return 0;
        return a.path < b.path ? -1 : 1;
      });

      const resolvedBundleDir = resolve(bundleDir);
      let realBundleDir: string;
      try {
        realBundleDir = await realpath(bundleDir);
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          "code" in err &&
          (err as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          realBundleDir = resolvedBundleDir;
        } else {
          const message = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            status: 0,
            data: null,
            error: `Bundle directory resolution error: ${message}`,
          };
        }
      }
      const parts: Array<{ path: string; content: Buffer }> = [];

      for (const artifact of artifacts) {
        const fullPath = resolve(join(bundleDir, artifact.path));
        // Lexical path traversal guard (catches ".." components)
        if (!fullPath.startsWith(resolvedBundleDir + sep) && fullPath !== resolvedBundleDir) {
          return {
            ok: false,
            status: 0,
            data: null,
            error: `Path traversal detected: ${artifact.path}`,
          };
        }

        // Resolve real path to catch symlinked intermediate directories
        let realFullPath: string;
        try {
          realFullPath = await realpath(fullPath);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            status: 0,
            data: null,
            error: `Artifact read error (${artifact.path}): ${message}`,
          };
        }

        if (!realFullPath.startsWith(realBundleDir + sep) && realFullPath !== realBundleDir) {
          return {
            ok: false,
            status: 0,
            data: null,
            error: `Symbolic link detected: ${artifact.path}`,
          };
        }

        let content: Buffer;
        try {
          content = await readFile(realFullPath);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            status: 0,
            data: null,
            error: `Artifact read error (${artifact.path}): ${message}`,
          };
        }

        parts.push({ path: artifact.path, content });
      }

      // Build JSON payload with manifest + artifacts (base64-encoded)
      const payload = {
        manifest,
        artifacts: parts.map((p) => ({
          path: p.path,
          content_base64: p.content.toString("base64"),
        })),
      };

      // Compute digest from the serialized payload (reproducible by server)
      const payloadJson = JSON.stringify(payload);
      const bundleDigest = createHash("sha256").update(payloadJson, "utf-8").digest("hex");

      return apiRequest<{ bundle_id: string }>("POST", "/api/v1/compliance/bundles", {
        body: payloadJson,
        headers: {
          "Content-Type": "application/json",
          "X-Krynix-Bundle-Digest": `sha256:${bundleDigest}`,
        },
      });
    },

    async promoteGoldenTrace(
      tracePath: string,
      metadata: GoldenTraceMetadata,
    ): Promise<ApiResponse<{ golden_trace_id: string }>> {
      let content: Buffer;
      try {
        content = await readFile(tracePath);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, data: null, error: `File read error: ${message}` };
      }

      const digest = createHash("sha256").update(content).digest("hex");

      const payload = {
        trace_content_base64: content.toString("base64"),
        name: metadata.name,
        ...(metadata.description !== undefined ? { description: metadata.description } : {}),
        ...(metadata.labels !== undefined ? { labels: metadata.labels } : {}),
      };

      return apiRequest<{ golden_trace_id: string }>("POST", "/api/v1/golden-traces", {
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          "X-Krynix-Digest": `sha256:${digest}`,
        },
      });
    },

    async listGoldenTraces(filters?: GoldenTraceFilters): Promise<ApiResponse<GoldenTraceEntry[]>> {
      const params = new URLSearchParams();
      if (filters?.name !== undefined) params.set("name", filters.name);
      if (filters?.label !== undefined) params.set("label", filters.label);
      if (filters?.limit !== undefined) params.set("limit", String(filters.limit));
      const query = params.toString();
      const path = query !== "" ? `/api/v1/golden-traces?${query}` : "/api/v1/golden-traces";
      return apiRequest<GoldenTraceEntry[]>("GET", path);
    },

    async pullGoldenTrace(
      goldenTraceId: string,
      outputPath: string,
    ): Promise<ApiResponse<{ path: string }>> {
      const url = `${baseUrl}/api/v1/golden-traces/${encodeURIComponent(goldenTraceId)}/download`;
      const authValue = getAuthHeader();
      const headers: Record<string, string> = {
        ...(authValue !== "" ? { Authorization: authValue } : {}),
      };

      let response: Response;
      try {
        response = await fetchFn(url, { method: "GET", headers });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, data: null, error: `Network error: ${message}` };
      }

      if (!response.ok) {
        let errorMsg = `HTTP ${String(response.status)}`;
        const ct = response.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          try {
            const errData = (await response.json()) as Record<string, unknown>;
            if (typeof errData["message"] === "string") {
              errorMsg = errData["message"];
            }
          } catch {
            // Ignore JSON parse errors for error responses
          }
        }
        return { ok: false, status: response.status, data: null, error: errorMsg };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      try {
        await fsWriteFile(outputPath, buffer);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, data: null, error: `File write error: ${message}` };
      }
      return { ok: true, status: response.status, data: { path: outputPath }, error: null };
    },
  };
}
