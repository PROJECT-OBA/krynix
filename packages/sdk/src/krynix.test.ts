import { describe, test, expect, afterEach } from "vitest";
import type { Policy } from "@krynix/policy";
import { Krynix, NoAdapterError, type KrynixAdapter, type KrynixContext } from "./krynix.js";

const POLICY: Policy = {
  apiVersion: "krynix.dev/v1",
  kind: "Policy",
  metadata: { name: "t", version: "1.0.0", description: "t" },
  spec: { scope: { agents: ["*"], event_types: ["*"] }, rules: [] },
};

// ---------------------------------------------------------------------------
// Test cleanup — adapters are class-level state. Reset between tests by
// re-walking and removing the ones registered by the test.
// ---------------------------------------------------------------------------

const initialAdapterNames = new Set(Krynix.listAdapters());

afterEach(() => {
  // The Krynix class doesn't expose unregister; tests that register
  // adapters do so with unique names and the assertion that
  // `listAdapters()` includes the new name catches the side effect.
  // To keep tests independent we reach into the private array via a
  // controlled escape hatch — this only runs in test code.
  const arr = (Krynix as unknown as { adapters: { name: string }[] }).adapters;
  for (let i = arr.length - 1; i >= 0; i--) {
    const adapter = arr[i];
    if (adapter !== undefined && !initialAdapterNames.has(adapter.name)) arr.splice(i, 1);
  }
});

// ---------------------------------------------------------------------------

describe("Krynix — constructor validation", () => {
  test("rejects empty agentId", () => {
    expect(() => new Krynix({ policy: POLICY, agentId: "", sessionId: "s" })).toThrow(/agentId/);
  });

  test("rejects empty sessionId", () => {
    expect(() => new Krynix({ policy: POLICY, agentId: "a", sessionId: "" })).toThrow(/sessionId/);
  });

  test("rejects missing policy", () => {
    expect(
      () =>
        new Krynix({
          policy: undefined as unknown as Policy,
          agentId: "a",
          sessionId: "s",
        }),
    ).toThrow(/policy/);
  });

  test("rejects ingest.url without apiKey", () => {
    expect(
      () =>
        new Krynix({
          policy: POLICY,
          agentId: "a",
          sessionId: "s",
          ingest: { url: "https://api.example.com" },
        }),
    ).toThrow(/apiKey/);
  });

  test("rejects empty ingest.url", () => {
    expect(
      () =>
        new Krynix({
          policy: POLICY,
          agentId: "a",
          sessionId: "s",
          ingest: { url: "", apiKey: "k" },
        }),
    ).toThrow(/non-empty string/);
  });

  test("rejects ingest.url without an http(s) scheme", () => {
    expect(
      () =>
        new Krynix({
          policy: POLICY,
          agentId: "a",
          sessionId: "s",
          ingest: { url: "api.example.com", apiKey: "k" },
        }),
    ).toThrow(/must start with "http:\/\/" or "https:\/\/"/);
  });

  test("accepts a well-formed http URL", () => {
    expect(
      () =>
        new Krynix({
          policy: POLICY,
          agentId: "a",
          sessionId: "s",
          ingest: { url: "http://localhost:3100", apiKey: "k" },
        }),
    ).not.toThrow();
  });

  test("offline mode (no ingest.url) — approvalPoller is null, buffer accepts events as no-ops", () => {
    const krynix = new Krynix({ policy: POLICY, agentId: "a", sessionId: "s" });
    expect(krynix.ctx.approvalPoller).toBeNull();
    // buffer.enqueue is a no-op in offline mode — already covered in event-buffer.test.ts.
  });

  test("rejects redaction.mode === 'presidio' (deferred to v0.2)", () => {
    expect(
      () =>
        new Krynix({
          policy: POLICY,
          agentId: "a",
          sessionId: "s",
          redaction: { mode: "presidio" },
        }),
    ).toThrow(/not yet implemented/);
  });
});

describe("Krynix.wrap() — adapter registry", () => {
  test("throws NoAdapterError when no adapter is registered", () => {
    const krynix = new Krynix({ policy: POLICY, agentId: "a", sessionId: "s" });
    expect(() => krynix.wrap({} as object)).toThrow(NoAdapterError);
  });

  test("dispatches to the first matching registered adapter", () => {
    interface FakeClient {
      __fake: true;
    }
    interface OtherClient {
      __other: true;
    }
    let calledWith: KrynixContext | null = null;
    const fakeAdapter: KrynixAdapter<FakeClient> = {
      name: "fake",
      detect: (c): c is FakeClient =>
        typeof c === "object" && c !== null && (c as { __fake?: true }).__fake === true,
      wrap: (c, ctx) => {
        calledWith = ctx;
        return c;
      },
    };
    const otherAdapter: KrynixAdapter<OtherClient> = {
      name: "other",
      detect: (c): c is OtherClient =>
        typeof c === "object" && c !== null && (c as { __other?: true }).__other === true,
      wrap: (c) => c,
    };
    Krynix.registerAdapter(fakeAdapter);
    Krynix.registerAdapter(otherAdapter);

    const krynix = new Krynix({ policy: POLICY, agentId: "a", sessionId: "s" });
    const client: FakeClient = { __fake: true };
    const wrapped = krynix.wrap(client);

    expect(wrapped).toBe(client);
    // TS narrows the closure-captured `calledWith` back to `null` at this
    // point — the assignment in `wrap` happens through a callback the
    // compiler can't track. Cast explicitly after asserting it's not
    // null so we don't lean on a non-null assertion (forbidden by the
    // eslint rule).
    if (calledWith === null) throw new Error("expected adapter to have run");
    const ctx = calledWith as KrynixContext;
    expect(ctx.agentId).toBe("a");
    expect(ctx.sessionId).toBe("s");
    expect(ctx.policy).toBe(POLICY);
  });

  test("listAdapters reflects registration", () => {
    const before = Krynix.listAdapters().length;
    Krynix.registerAdapter({
      name: "listed",
      detect: (_c): _c is object => false,
      wrap: (c) => c,
    });
    expect(Krynix.listAdapters().length).toBe(before + 1);
    expect(Krynix.listAdapters()).toContain("listed");
  });
});

describe("Krynix.close()", () => {
  test("is idempotent (offline mode)", async () => {
    const krynix = new Krynix({ policy: POLICY, agentId: "a", sessionId: "s" });
    await krynix.close();
    await krynix.close();
    expect(true).toBe(true);
  });
});
