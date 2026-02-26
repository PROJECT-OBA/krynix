import { describe, test, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
