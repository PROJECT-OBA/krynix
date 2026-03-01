import { describe, test, expect } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createControlPlaneClient } from "./http-client.js";
import type { ControlPlaneConfig } from "./config.js";
import type { Credentials } from "./credentials.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: ControlPlaneConfig = {
  url: "https://cp.example.com",
  org_id: "org-1",
  policy_sync: false,
  fail_on_push_error: false,
};

const TEST_CREDS: Credentials = {
  token: "test-token-123",
};

function mockFetch(
  status: number,
  body: unknown = {},
  contentType = "application/json",
): typeof fetch {
  return (async (_url: string | URL | Request, _init?: RequestInit) => {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map([["content-type", contentType]]) as unknown as Headers,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createControlPlaneClient", () => {
  test("returns a client with all expected methods", () => {
    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, mockFetch(200));
    expect(typeof client.pushTrace).toBe("function");
    expect(typeof client.pushEvaluation).toBe("function");
    expect(typeof client.pushReplayReport).toBe("function");
    expect(typeof client.pullPolicies).toBe("function");
    expect(typeof client.pushPolicy).toBe("function");
  });
});

describe("pushEvaluation", () => {
  test("sends POST with Bearer token and JSON body", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const spy: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({ id: "eval-1" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    const result = await client.pushEvaluation({ verdict: "pass" });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(capturedUrl).toBe("https://cp.example.com/api/v1/evaluations");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-token-123",
    );
    expect((capturedInit?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  test("returns structured error on HTTP 422", async () => {
    const client = createControlPlaneClient(
      TEST_CONFIG,
      TEST_CREDS,
      mockFetch(422, { message: "Validation failed" }),
    );

    const result = await client.pushEvaluation({ verdict: "pass" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toBe("Validation failed");
  });

  test("returns error when HTTP 200 but JSON body is malformed", async () => {
    const badJsonFetch: typeof fetch = (async () => {
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => {
          throw new SyntaxError("Unexpected token");
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, badJsonFetch);
    const result = await client.pushEvaluation({ verdict: "pass" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(200);
    expect(result.error).toBe("Invalid JSON in response body");
    expect(result.data).toBeNull();
  });
});

describe("pushReplayReport", () => {
  test("sends POST to /api/v1/replays", async () => {
    let capturedUrl = "";

    const spy: typeof fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    await client.pushReplayReport({ matches: true });

    expect(capturedUrl).toBe("https://cp.example.com/api/v1/replays");
  });
});

describe("pullPolicies", () => {
  test("sends GET to /api/v1/policies", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const spy: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => [],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    const result = await client.pullPolicies();

    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe("https://cp.example.com/api/v1/policies");
    expect(capturedInit?.method).toBe("GET");
  });

  test("appends labels as query parameter", async () => {
    let capturedUrl = "";

    const spy: typeof fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => [],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    await client.pullPolicies({ labels: "env:prod" });

    expect(capturedUrl).toContain("labels=");
    expect(capturedUrl).toContain("env%3Aprod");
  });

  test("appends since as query parameter", async () => {
    let capturedUrl = "";

    const spy: typeof fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => [],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    await client.pullPolicies({ since: "2025-06-01T00:00:00Z" });

    expect(capturedUrl).toContain("since=");
    expect(capturedUrl).toContain("2025-06-01");
  });
});

describe("pushPolicy", () => {
  test("sends POST with yaml content and changelog", async () => {
    let capturedBody = "";

    const spy: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 201,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({ name: "test-policy", version: "1.0.0" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    const result = await client.pushPolicy(
      "apiVersion: krynix.dev/v1\nkind: Policy",
      "Initial release",
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(parsed["yaml_content"]).toContain("apiVersion");
    expect(parsed["changelog"]).toBe("Initial release");
  });
});

describe("auth header", () => {
  test("uses api_key when token is not set", async () => {
    let capturedHeaders: Record<string, string> = {};

    const spy: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, { api_key: "key-abc" }, spy);
    await client.pushEvaluation({});

    expect(capturedHeaders["Authorization"]).toBe("Bearer key-abc");
  });

  test("prefers token over api_key", async () => {
    let capturedHeaders: Record<string, string> = {};

    const spy: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, { token: "tok-1", api_key: "key-2" }, spy);
    await client.pushEvaluation({});

    expect(capturedHeaders["Authorization"]).toBe("Bearer tok-1");
  });
});

describe("network errors", () => {
  test("returns structured error on network failure", async () => {
    const failFetch: typeof fetch = (async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, failFetch);
    const result = await client.pushEvaluation({});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("Network error");
    expect(result.error).toContain("Connection refused");
  });
});

describe("trailing slash normalization", () => {
  test("trailing slash in config URL is stripped", async () => {
    let capturedUrl = "";

    const spy: typeof fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(
      { ...TEST_CONFIG, url: "https://cp.example.com/" },
      TEST_CREDS,
      spy,
    );
    await client.pushEvaluation({});

    expect(capturedUrl).toBe("https://cp.example.com/api/v1/evaluations");
  });
});

describe("pushTrace", () => {
  test("reads file, sends with SHA-256 digest header", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-httpclient-"));
    try {
      const traceContent = '{"event_id":"evt-1","session_id":"sess-1"}\n';
      const tracePath = join(tmpDir, "trace.jsonl");
      await writeFile(tracePath, traceContent, "utf-8");

      const expectedDigest = createHash("sha256").update(Buffer.from(traceContent)).digest("hex");

      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};
      let capturedBody: string | Buffer | undefined;

      const spy: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers as Record<string, string>;
        capturedBody = init?.body as string | Buffer | undefined;
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
          json: async () => ({ id: "trace-1" }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
      const result = await client.pushTrace(tracePath);

      expect(result.ok).toBe(true);
      expect(capturedUrl).toBe("https://cp.example.com/api/v1/traces");
      expect(capturedHeaders["Content-Type"]).toBe("application/octet-stream");
      expect(capturedHeaders["X-Krynix-Digest"]).toBe(`sha256:${expectedDigest}`);
      expect(capturedHeaders["Authorization"]).toBe("Bearer test-token-123");
      // Body is sent as raw Buffer — verify byte content matches
      expect(Buffer.isBuffer(capturedBody)).toBe(true);
      expect((capturedBody as Buffer).toString("utf-8")).toBe(traceContent);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns structured error on non-existent file", async () => {
    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, mockFetch(200));
    const result = await client.pushTrace("/nonexistent/trace.jsonl");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("File read error");
    expect(result.error).toContain("ENOENT");
  });
});

describe("pushComplianceBundle", () => {
  test("sends POST with X-Krynix-Bundle-Digest header", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-httpclient-bundle-"));
    try {
      const manifestContent = JSON.stringify({
        manifest_version: "1.0.0",
        export_id: "export-1",
        org_id: "",
        generated_at: "2025-01-01T00:00:00Z",
        generated_by: "krynix-cli",
        krynix_engine_version: "1.0.0",
        trace_count: 0,
        artifacts: [],
        redaction_notice: "",
        integrity_note: "",
      });
      await writeFile(join(tmpDir, "manifest.json"), manifestContent, "utf-8");

      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};

      const spy: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers as Record<string, string>;
        return {
          ok: true,
          status: 201,
          headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
          json: async () => ({ bundle_id: "bundle-123" }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
      const result = await client.pushComplianceBundle(tmpDir);

      expect(result.ok).toBe(true);
      expect(capturedUrl).toBe("https://cp.example.com/api/v1/compliance/bundles");
      expect(capturedHeaders["X-Krynix-Bundle-Digest"]).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(capturedHeaders["Content-Type"]).toBe("application/json");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("deterministic part ordering — artifacts sorted lexicographically", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-httpclient-bundle-"));
    try {
      await mkdir(join(tmpDir, "traces"), { recursive: true });
      await mkdir(join(tmpDir, "stats"), { recursive: true });

      const traceContent = "trace content\n";
      const statsContent = '{"event_count": 3}\n';

      await writeFile(join(tmpDir, "traces", "sess-1.trace.jsonl"), traceContent, "utf-8");
      await writeFile(join(tmpDir, "stats", "sess-1.stats.json"), statsContent, "utf-8");

      const traceDigest = createHash("sha256").update(traceContent, "utf-8").digest("hex");
      const statsDigest = createHash("sha256").update(statsContent, "utf-8").digest("hex");

      const manifestContent = JSON.stringify({
        manifest_version: "1.0.0",
        export_id: "export-1",
        org_id: "",
        generated_at: "2025-01-01T00:00:00Z",
        generated_by: "krynix-cli",
        krynix_engine_version: "1.0.0",
        trace_count: 1,
        artifacts: [
          { path: "traces/sess-1.trace.jsonl", type: "trace", digest: `sha256:${traceDigest}` },
          { path: "stats/sess-1.stats.json", type: "stats", digest: `sha256:${statsDigest}` },
        ],
        redaction_notice: "",
        integrity_note: "",
      });
      await writeFile(join(tmpDir, "manifest.json"), manifestContent, "utf-8");

      let capturedBody = "";

      const spy: typeof fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          status: 201,
          headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
          json: async () => ({ bundle_id: "bundle-456" }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
      await client.pushComplianceBundle(tmpDir);

      const parsed = JSON.parse(capturedBody) as {
        artifacts: Array<{ path: string }>;
      };
      // Artifacts should be sorted lexicographically: stats before traces
      expect(parsed.artifacts[0]?.path).toBe("stats/sess-1.stats.json");
      expect(parsed.artifacts[1]?.path).toBe("traces/sess-1.trace.jsonl");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns error when manifest is missing", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-httpclient-bundle-"));
    try {
      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, mockFetch(200));
      const result = await client.pushComplianceBundle(tmpDir);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Manifest read error");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns structured error for non-array artifacts", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-httpclient-bundle-"));
    try {
      await writeFile(
        join(tmpDir, "manifest.json"),
        JSON.stringify({ manifest_version: "1.0.0", artifacts: "bad" }),
        "utf-8",
      );
      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, mockFetch(200));
      const result = await client.pushComplianceBundle(tmpDir);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("artifacts is not an array");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns structured error for artifact missing string path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-httpclient-bundle-"));
    try {
      await writeFile(
        join(tmpDir, "manifest.json"),
        JSON.stringify({ manifest_version: "1.0.0", artifacts: [{ path: 42 }] }),
        "utf-8",
      );
      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, mockFetch(200));
      const result = await client.pushComplianceBundle(tmpDir);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("artifact entry has missing or degenerate path");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns structured error for degenerate artifact path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-httpclient-bundle-"));
    try {
      await writeFile(
        join(tmpDir, "manifest.json"),
        JSON.stringify({
          manifest_version: "1.0.0",
          artifacts: [{ path: "", type: "trace", digest: "sha256:abc" }],
        }),
        "utf-8",
      );
      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, mockFetch(200));
      const result = await client.pushComplianceBundle(tmpDir);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("artifact entry has missing or degenerate path");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("promoteGoldenTrace", () => {
  test("sends POST with digest header and metadata", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-golden-http-"));
    try {
      const tracePath = join(tmpDir, "test.trace.jsonl");
      await writeFile(tracePath, '{"events":"data"}\n', "utf-8");

      let capturedUrl = "";
      let capturedBody = "";
      let capturedHeaders: Record<string, string> = {};

      const spy: typeof fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = init?.body as string;
        capturedHeaders = init?.headers as Record<string, string>;
        return {
          ok: true,
          status: 201,
          headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
          json: async () => ({ golden_trace_id: "gt-1" }),
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
      const result = await client.promoteGoldenTrace(tracePath, {
        name: "baseline",
        description: "Main workflow",
        labels: { env: "prod" },
      });

      expect(result.ok).toBe(true);
      expect(capturedUrl).toBe("https://cp.example.com/api/v1/golden-traces");
      expect(capturedHeaders["X-Krynix-Digest"]).toMatch(/^sha256:[a-f0-9]{64}$/);
      const body = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(body["name"]).toBe("baseline");
      expect(body["description"]).toBe("Main workflow");
      expect(body["labels"]).toEqual({ env: "prod" });
      expect(typeof body["trace_content_base64"]).toBe("string");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns error on non-existent trace file", async () => {
    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, mockFetch(200));
    const result = await client.promoteGoldenTrace("/nonexistent/file", { name: "test" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("File read error");
  });
});

describe("listGoldenTraces", () => {
  test("sends GET with filters as query params", async () => {
    let capturedUrl = "";

    const spy: typeof fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => [],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    await client.listGoldenTraces({ name: "base", label: "env=prod", limit: 10 });

    expect(capturedUrl).toContain("/api/v1/golden-traces?");
    expect(capturedUrl).toContain("name=base");
    expect(capturedUrl).toContain("label=env%3Dprod");
    expect(capturedUrl).toContain("limit=10");
  });

  test("sends GET without query params when no filters", async () => {
    let capturedUrl = "";

    const spy: typeof fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => [],
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    await client.listGoldenTraces();

    expect(capturedUrl).toBe("https://cp.example.com/api/v1/golden-traces");
  });
});

describe("pullGoldenTrace", () => {
  test("downloads trace to output path", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "krynix-golden-pull-"));
    try {
      const outPath = join(tmpDir, "golden.trace.jsonl");
      const traceContent = '{"event":"data"}\n';

      const spy: typeof fetch = (async (url: string | URL | Request) => {
        const urlStr = String(url);
        expect(urlStr).toBe("https://cp.example.com/api/v1/golden-traces/gt-123/download");
        return {
          ok: true,
          status: 200,
          headers: new Map([["content-type", "application/octet-stream"]]) as unknown as Headers,
          arrayBuffer: async () => new TextEncoder().encode(traceContent).buffer,
        } as unknown as Response;
      }) as unknown as typeof fetch;

      const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
      const result = await client.pullGoldenTrace("gt-123", outPath);

      expect(result.ok).toBe(true);
      expect(result.data?.path).toBe(outPath);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("returns network error when fetch throws", async () => {
    const failFetch: typeof fetch = (async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, failFetch);
    const result = await client.pullGoldenTrace("gt-123", "/tmp/out");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("Network error");
    expect(result.error).toContain("Connection refused");
  });

  test("returns file write error when output path is invalid", async () => {
    const spy: typeof fetch = (async () => {
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "application/octet-stream"]]) as unknown as Headers,
        arrayBuffer: async () => new TextEncoder().encode("data").buffer,
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    const result = await client.pullGoldenTrace("gt-123", "/nonexistent-dir/deep/file.jsonl");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("File write error");
    expect(result.error).toContain("ENOENT");
  });

  test("returns structured error on 404", async () => {
    const spy: typeof fetch = (async () => {
      return {
        ok: false,
        status: 404,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        json: async () => ({ message: "Golden trace not found" }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = createControlPlaneClient(TEST_CONFIG, TEST_CREDS, spy);
    const result = await client.pullGoldenTrace("gt-nonexistent", "/tmp/out");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain("not found");
  });
});
