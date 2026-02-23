import { describe, test, expect } from "vitest";
import { createHash } from "node:crypto";
import { redact } from "./redaction.js";
import { makeToolCall } from "./test-helpers.js";
import type { TraceEvent, ToolCallPayload } from "./types.js";

/** Compute the expected redaction token for a value. */
function expectedToken(value: string): string {
  const hash = createHash("sha256").update(value).digest("hex");
  return `[REDACTED:${hash.slice(0, 8)}]`;
}

/** Safely extract ToolCallPayload from a redacted TraceEvent. */
function toolPayload(event: TraceEvent): ToolCallPayload {
  return event.payload as unknown as ToolCallPayload;
}

describe("redact", () => {
  test("redacts api_key field", () => {
    const event = makeToolCall(0, {
      tool_name: "http_request",
      arguments: { api_key: "sk-abc123secret", url: "https://example.com" },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["api_key"]).toBe(expectedToken("sk-abc123secret"));
    expect(args["url"]).toBe("https://example.com");
    expect(result.redacted).toBe(true);
  });

  test("redacts db_password field", () => {
    const event = makeToolCall(0, {
      tool_name: "db_connect",
      arguments: { db_password: "supersecret", host: "localhost" },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["db_password"]).toBe(expectedToken("supersecret"));
    expect(args["host"]).toBe("localhost");
  });

  test("redacts auth_token field", () => {
    const event = makeToolCall(0, {
      tool_name: "authenticate",
      arguments: { auth_token: "bearer-xyz" },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["auth_token"]).toBe(expectedToken("bearer-xyz"));
  });

  test("redacts nested fields (arguments.aws_secret)", () => {
    const event = makeToolCall(0, {
      tool_name: "s3_upload",
      arguments: { credentials: { aws_secret: "AKIA-secret-value" }, bucket: "my-bucket" },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    const creds = args["credentials"] as Record<string, unknown>;
    expect(creds["aws_secret"]).toBe(expectedToken("AKIA-secret-value"));
    expect(args["bucket"]).toBe("my-bucket");
  });

  test("does not redact safe fields (tool_name, path)", () => {
    const event = makeToolCall(0, {
      tool_name: "file_read",
      arguments: { path: "/etc/passwd" },
    });
    const result = redact(event);

    expect(toolPayload(result).tool_name).toBe("file_read");
    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["path"]).toBe("/etc/passwd");
    expect(result.redacted).toBe(false);
  });

  test("produces deterministic placeholder (same value → same token)", () => {
    const event1 = makeToolCall(0, {
      tool_name: "a",
      arguments: { api_key: "same-secret" },
    });
    const event2 = makeToolCall(1, {
      tool_name: "b",
      arguments: { api_key: "same-secret" },
    });
    const r1 = redact(event1);
    const r2 = redact(event2);

    const args1 = toolPayload(r1).arguments as Record<string, unknown>;
    const args2 = toolPayload(r2).arguments as Record<string, unknown>;
    expect(args1["api_key"]).toBe(args2["api_key"]);
  });

  test("redacts multiple fields in one payload", () => {
    const event = makeToolCall(0, {
      tool_name: "multi",
      arguments: { api_key: "key1", api_secret: "sec1", path: "/safe" },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["api_key"]).toBe(expectedToken("key1"));
    expect(args["api_secret"]).toBe(expectedToken("sec1"));
    expect(args["path"]).toBe("/safe");
    expect(result.redacted).toBe(true);
  });

  test("is case insensitive (API_KEY and api_key both match)", () => {
    const event = makeToolCall(0, {
      tool_name: "test",
      arguments: { API_KEY: "upper", Api_Secret: "mixed" },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["API_KEY"]).toBe(expectedToken("upper"));
    expect(args["Api_Secret"]).toBe(expectedToken("mixed"));
  });

  test("does not redact non-string values matching key pattern", () => {
    const event = makeToolCall(0, {
      tool_name: "test",
      arguments: { api_key: 12345 },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["api_key"]).toBe(12345);
    expect(result.redacted).toBe(false);
  });

  test("returns a new object (does not mutate the original)", () => {
    const event = makeToolCall(0, {
      tool_name: "test",
      arguments: { api_key: "secret" },
    });
    const result = redact(event);

    expect(result).not.toBe(event);
    const origArgs = toolPayload(event).arguments as Record<string, unknown>;
    expect(origArgs["api_key"]).toBe("secret");
  });

  test("login_credential pattern matches", () => {
    const event = makeToolCall(0, {
      tool_name: "test",
      arguments: { login_credential: "cred-value" },
    });
    const result = redact(event);

    const args = toolPayload(result).arguments as Record<string, unknown>;
    expect(args["login_credential"]).toBe(expectedToken("cred-value"));
  });
});
