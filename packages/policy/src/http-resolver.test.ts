import { describe, test, expect, vi } from "vitest";
import { createHttpPolicyResolver } from "./http-resolver.js";
import { resolvePolicy } from "./inheritance.js";
import { parsePolicy } from "./parser.js";
import type { Policy } from "./schema.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePolicyYaml(name: string, version: string): string {
  return `
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: ${name}
  version: "${version}"
  description: A test policy
spec:
  scope:
    agents: ["*"]
    event_types: ["*"]
  rules:
    - id: allow-all
      description: Allow all
      match:
        payload: []
      action: allow
      severity: info
      message: Allowed
`;
}

const VALID_POLICY_YAML = makePolicyYaml("test-policy", "1.0.0");

function makeFetchFn(
  status: number,
  body: Record<string, unknown> | null,
  statusText = "OK",
): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as Response);
}

function makeThrowingFetchFn(error: Error): typeof fetch {
  return vi.fn().mockRejectedValue(error);
}

// ---------------------------------------------------------------------------
// Tests — basic functionality
// ---------------------------------------------------------------------------

describe("createHttpPolicyResolver", () => {
  test("resolves a valid name@version reference", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    const policy = await resolver("test-policy@1.0.0");
    expect(policy.metadata.name).toBe("test-policy");
    expect(policy.metadata.version).toBe("1.0.0");
  });

  test("sends GET to correct URL with encoded name and version", async () => {
    const yaml = makePolicyYaml("my-policy", "2.0.0");
    const fetchFn = makeFetchFn(200, { yaml_content: yaml });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await resolver("my-policy@2.0.0");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://cp.krynix.dev/api/v1/policies/my-policy/versions/2.0.0",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("sends Authorization header when authHeader provided", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      authHeader: "Bearer tok123",
      fetchFn,
    });

    await resolver("test-policy@1.0.0");
    expect(fetchFn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok123" }),
      }),
    );
  });

  test("omits Authorization header when authHeader not provided", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await resolver("test-policy@1.0.0");
    const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
  });

  test("throws on HTTP 404 (policy not found)", async () => {
    const fetchFn = makeFetchFn(404, null, "Not Found");
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 0,
    });

    await expect(resolver("unknown@1.0.0")).rejects.toThrow("HTTP 404");
  });

  test("throws on HTTP 500 without retries", async () => {
    const fetchFn = makeFetchFn(500, null, "Internal Server Error");
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 0,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("HTTP 500");
  });

  test("throws on missing yaml_content in response", async () => {
    const fetchFn = makeFetchFn(200, { name: "test" });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("missing yaml_content");
  });

  test("throws on invalid ref: missing @ separator", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await expect(resolver("no-version")).rejects.toThrow('Invalid policy reference "no-version"');
  });

  test("throws on invalid ref: empty name (starts with @)", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await expect(resolver("@1.0.0")).rejects.toThrow("Invalid policy reference");
  });

  test("throws on invalid ref: empty version (ends with @)", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await expect(resolver("test@")).rejects.toThrow("Invalid policy reference");
  });

  test("handles scoped names with @ correctly (uses lastIndexOf)", async () => {
    const yaml = makePolicyYaml('"@scope/my-policy"', "1.0.0");
    const fetchFn = makeFetchFn(200, { yaml_content: yaml });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await resolver("@scope/my-policy@1.0.0");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://cp.krynix.dev/api/v1/policies/%40scope%2Fmy-policy/versions/1.0.0",
      expect.any(Object),
    );
  });

  test("throws on malformed YAML returned by registry", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: "not: valid: yaml: [" });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow();
  });

  test("throws on network error without retries", async () => {
    const fetchFn = makeThrowingFetchFn(new Error("network timeout"));
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 0,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("network timeout");
  });

  test("strips trailing slash from baseUrl", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev///",
      fetchFn,
    });

    await resolver("test-policy@1.0.0");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://cp.krynix.dev/api/v1/policies/test-policy/versions/1.0.0",
      expect.any(Object),
    );
  });

  test("passes custom fetchFn", async () => {
    const customFetch = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn: customFetch,
    });

    await resolver("test-policy@1.0.0");
    expect(customFetch).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Identity validation
  // -------------------------------------------------------------------------

  test("throws when fetched policy name does not match requested ref", async () => {
    const yaml = makePolicyYaml("wrong-name", "1.0.0");
    const fetchFn = makeFetchFn(200, { yaml_content: yaml });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await expect(resolver("expected-name@1.0.0")).rejects.toThrow("Policy identity mismatch");
  });

  test("throws when fetched policy version does not match requested ref", async () => {
    const yaml = makePolicyYaml("test-policy", "2.0.0");
    const fetchFn = makeFetchFn(200, { yaml_content: yaml });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("Policy identity mismatch");
  });

  test("passes when fetched policy identity matches requested ref", async () => {
    const yaml = makePolicyYaml("my-policy", "3.2.1");
    const fetchFn = makeFetchFn(200, { yaml_content: yaml });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    const policy = await resolver("my-policy@3.2.1");
    expect(policy.metadata.name).toBe("my-policy");
    expect(policy.metadata.version).toBe("3.2.1");
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  test("sends AbortSignal with fetch requests", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: VALID_POLICY_YAML });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      timeoutMs: 5000,
    });

    await resolver("test-policy@1.0.0");
    const callArgs = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
  });

  test("throws timeout error when fetch is aborted", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const fetchFn = makeThrowingFetchFn(abortError);
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      timeoutMs: 100,
      maxRetries: 0,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("request timed out");
  });

  // -------------------------------------------------------------------------
  // Retry
  // -------------------------------------------------------------------------

  test("retries on HTTP 500 and succeeds on later attempt", async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: () => Promise.resolve(null),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ yaml_content: VALID_POLICY_YAML }),
      });
    }) as unknown as typeof fetch;

    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 10, // Fast for tests
    });

    const policy = await resolver("test-policy@1.0.0");
    expect(policy.metadata.name).toBe("test-policy");
    expect(callCount).toBe(2);
  });

  test("retries on network error and succeeds on later attempt", async () => {
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("ECONNRESET"));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ yaml_content: VALID_POLICY_YAML }),
      });
    }) as unknown as typeof fetch;

    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    const policy = await resolver("test-policy@1.0.0");
    expect(policy.metadata.name).toBe("test-policy");
    expect(callCount).toBe(2);
  });

  test("does not retry on HTTP 404 (client error)", async () => {
    const fetchFn = makeFetchFn(404, null, "Not Found");
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    await expect(resolver("unknown@1.0.0")).rejects.toThrow("HTTP 404");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("does not retry on AbortError (timeout)", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    const fetchFn = makeThrowingFetchFn(abortError);
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("timed out");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("exhausts all retries on persistent 500", async () => {
    const fetchFn = makeFetchFn(500, null, "Internal Server Error");
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("HTTP 500");
    // 1 initial + 2 retries = 3 total
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Inheritance integration
  // -------------------------------------------------------------------------

  test("integrates with resolvePolicy for single-level inheritance", async () => {
    const parentYaml = makePolicyYaml("parent-policy", "1.0.0");
    const fetchFn = makeFetchFn(200, { yaml_content: parentYaml });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
    });

    const childPolicy: Policy = parsePolicy(`
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: child-policy
  version: "1.0.0"
  description: Child policy
  extends: "parent-policy@1.0.0"
spec:
  scope:
    agents: ["agent-1"]
    event_types: ["tool_call"]
  rules:
    - id: child-rule
      description: Child rule
      match:
        payload: []
      action: deny
      severity: error
      message: From child
`);

    const resolved = await resolvePolicy(childPolicy, resolver);
    // Child metadata wins
    expect(resolved.metadata.name).toBe("child-policy");
    // Child scope wins
    expect(resolved.spec.scope.agents).toEqual(["agent-1"]);
    // Rules: child first, then parent
    expect(resolved.spec.rules).toHaveLength(2);
    expect(resolved.spec.rules[0]?.id).toBe("child-rule");
    expect(resolved.spec.rules[1]?.id).toBe("allow-all");
    // extends is removed
    expect(resolved.metadata.extends).toBeUndefined();
  });

  test("throws on malformed JSON response body", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("Failed to parse JSON response");
  });

  // -------------------------------------------------------------------------
  // Permanent error classification (no retry)
  // -------------------------------------------------------------------------

  test("does not retry malformed JSON response (permanent error)", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn: fetchFn as unknown as typeof fetch,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow("Failed to parse JSON response");
    // Should not retry — only 1 fetch call
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("does not retry malformed YAML in yaml_content (permanent error)", async () => {
    const fetchFn = makeFetchFn(200, { yaml_content: "not: valid: yaml: [" });
    const resolver = createHttpPolicyResolver({
      baseUrl: "https://cp.krynix.dev",
      fetchFn,
      maxRetries: 2,
      retryDelayMs: 10,
    });

    await expect(resolver("test-policy@1.0.0")).rejects.toThrow();
    // Should not retry — only 1 fetch call
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Option validation
  // -------------------------------------------------------------------------

  test("throws RangeError for negative timeoutMs", () => {
    expect(() =>
      createHttpPolicyResolver({
        baseUrl: "https://cp.krynix.dev",
        timeoutMs: -1,
      }),
    ).toThrow(RangeError);
  });

  test("throws RangeError for zero timeoutMs", () => {
    expect(() =>
      createHttpPolicyResolver({
        baseUrl: "https://cp.krynix.dev",
        timeoutMs: 0,
      }),
    ).toThrow(RangeError);
  });

  test("throws RangeError for negative maxRetries", () => {
    expect(() =>
      createHttpPolicyResolver({
        baseUrl: "https://cp.krynix.dev",
        maxRetries: -1,
      }),
    ).toThrow(RangeError);
  });

  test("throws RangeError for non-integer maxRetries", () => {
    expect(() =>
      createHttpPolicyResolver({
        baseUrl: "https://cp.krynix.dev",
        maxRetries: 1.5,
      }),
    ).toThrow(RangeError);
  });

  test("throws RangeError for negative retryDelayMs", () => {
    expect(() =>
      createHttpPolicyResolver({
        baseUrl: "https://cp.krynix.dev",
        retryDelayMs: -100,
      }),
    ).toThrow(RangeError);
  });
});
