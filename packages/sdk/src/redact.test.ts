import { describe, test, expect } from "vitest";
import type { Redaction } from "@krynix/policy";
import { applyRedactions, resolveRedactionMode } from "./redact.js";

describe("resolveRedactionMode", () => {
  test("defaults to 'regex' when undefined", () => {
    expect(resolveRedactionMode(undefined)).toBe("regex");
    expect(resolveRedactionMode({})).toBe("regex");
  });

  test("accepts 'off' and 'regex'", () => {
    expect(resolveRedactionMode({ mode: "off" })).toBe("off");
    expect(resolveRedactionMode({ mode: "regex" })).toBe("regex");
  });

  test("throws on 'presidio' (deferred to v0.2)", () => {
    expect(() => resolveRedactionMode({ mode: "presidio" })).toThrow(/not yet implemented/);
  });
});

describe("applyRedactions — full-field replacement (no pattern)", () => {
  test("replaces a top-level string field", () => {
    const body = { secret: "hunter2", keep: "untouched" };
    const r: Redaction[] = [{ path: "secret" }];

    const { body: out, applied } = applyRedactions(body, r);

    expect(out).toEqual({ secret: "<REDACTED>", keep: "untouched" });
    expect(applied).toEqual([{ path: "secret", value_redacted: "<REDACTED>" }]);
    // Original untouched.
    expect(body.secret).toBe("hunter2");
  });

  test("respects custom `replacement`", () => {
    const body = { token: "abc" };
    const { body: out, applied } = applyRedactions(body, [
      { path: "token", replacement: "<TOKEN>" },
    ]);
    expect((out as { token: string }).token).toBe("<TOKEN>");
    expect(applied[0]?.value_redacted).toBe("<TOKEN>");
  });

  test("accepts empty replacement (delete the match)", () => {
    const body = { token: "abc" };
    const { body: out } = applyRedactions(body, [{ path: "token", replacement: "" }]);
    expect((out as { token: string }).token).toBe("");
  });

  test("nested path is resolved", () => {
    const body = { a: { b: { c: "secret" } } };
    const { body: out } = applyRedactions(body, [{ path: "a.b.c" }]);
    expect((out as { a: { b: { c: string } } }).a.b.c).toBe("<REDACTED>");
  });

  test("non-existent path is silently skipped (no throw, no audit entry)", () => {
    const body = { a: 1 };
    const { body: out, applied } = applyRedactions(body, [{ path: "nonexistent" }]);
    expect(out).toEqual({ a: 1 });
    expect(applied).toEqual([]);
  });

  test("non-string leaf values are skipped (don't opaquely replace numbers/objects)", () => {
    const body = { n: 42, o: { k: 1 } };
    const { body: out, applied } = applyRedactions(body, [{ path: "n" }, { path: "o" }]);
    expect(out).toEqual({ n: 42, o: { k: 1 } });
    expect(applied).toEqual([]);
  });
});

describe("applyRedactions — regex pattern", () => {
  test("replaces matches inside a string", () => {
    const body = { content: "email me at alice@example.com or bob@example.com" };
    const r: Redaction[] = [
      { path: "content", pattern: "[^\\s]+@[^\\s]+", replacement: "<EMAIL>" },
    ];

    const { body: out, applied } = applyRedactions(body, r);

    expect((out as { content: string }).content).toBe("email me at <EMAIL> or <EMAIL>");
    // One audit entry per matched leaf, not one per regex match — the
    // path is what's recorded.
    expect(applied).toEqual([{ path: "content", value_redacted: "<EMAIL>" }]);
  });

  test("regex with `g` semantics catches every occurrence in one leaf", () => {
    const body = { s: "aaa" };
    const { body: out } = applyRedactions(body, [{ path: "s", pattern: "a", replacement: "b" }]);
    expect((out as { s: string }).s).toBe("bbb");
  });

  test("regex with `u` flag accepts Unicode property escapes", () => {
    const body = { s: "Hello World" };
    // \p{L}+ matches runs of letters; needs `u` flag (which the
    // module attaches internally).
    const { body: out } = applyRedactions(body, [
      { path: "s", pattern: "\\p{L}+", replacement: "X" },
    ]);
    expect((out as { s: string }).s).toBe("X X");
  });
});

describe("applyRedactions — array spread `[*]`", () => {
  test("redacts every element of an array of strings", () => {
    const body = { tags: ["secret1", "secret2", "secret3"] };
    const { body: out, applied } = applyRedactions(body, [{ path: "tags[*]", replacement: "<X>" }]);
    expect((out as { tags: string[] }).tags).toEqual(["<X>", "<X>", "<X>"]);
    // One audit entry per element.
    expect(applied).toHaveLength(3);
    for (const a of applied) {
      expect(a.path).toBe("tags[*]");
      expect(a.value_redacted).toBe("<X>");
    }
  });

  test("redacts a string field on every element of an array of objects", () => {
    const body = {
      messages: [
        { role: "user", content: "first email: a@b.com" },
        { role: "assistant", content: "ack: a@b.com" },
        { role: "user", content: "no email here" },
      ],
    };
    const { body: out, applied } = applyRedactions(body, [
      { path: "messages[*].content", pattern: "[^\\s]+@[^\\s]+", replacement: "<EMAIL>" },
    ]);
    const messages = (out as { messages: { content: string }[] }).messages;
    expect(messages[0]?.content).toBe("first email: <EMAIL>");
    expect(messages[1]?.content).toBe("ack: <EMAIL>");
    expect(messages[2]?.content).toBe("no email here"); // no match → unchanged → no audit entry
    // Only the matched leaves produce audit entries.
    expect(applied).toHaveLength(2);
  });

  test("spread on a non-array is silently skipped (defensive)", () => {
    const body = { messages: "not an array" };
    const { body: out, applied } = applyRedactions(body, [{ path: "messages[*].content" }]);
    expect(out).toEqual(body); // unchanged structurally
    expect(applied).toEqual([]);
  });
});

describe("applyRedactions — audit trail records replacement, not original", () => {
  test("value_redacted is always the replacement string, never the original PII", () => {
    const body = { ssn: "123-45-6789" };
    const { applied } = applyRedactions(body, [{ path: "ssn", replacement: "<SSN>" }]);
    expect(applied).toEqual([{ path: "ssn", value_redacted: "<SSN>" }]);
    // The string "123-45-6789" must never appear in the audit trail.
    expect(applied[0]?.value_redacted).not.toContain("123");
  });
});
