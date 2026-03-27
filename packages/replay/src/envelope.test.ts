import { describe, test, expect } from "vitest";
import { extractEnvelope } from "./envelope.js";
import { KrynixError, type TraceEvent } from "@krynix/core";

function makeSessionStart(context: Record<string, unknown>): TraceEvent {
  return {
    event_id: "e1",
    session_id: "s1",
    sequence_num: 0,
    timestamp: "2025-01-15T14:00:00.000Z",
    event_type: "lifecycle",
    parent_id: null,
    agent_id: "test-agent",
    payload: { action: "session_start", context },
    redacted: false,
    prev_hash: "",
    event_hash: "abc",
    metadata: null,
    schema_version: "1.0.0",
  } as TraceEvent;
}

function makeToolCall(): TraceEvent {
  return {
    event_id: "e2",
    session_id: "s1",
    sequence_num: 1,
    timestamp: "2025-01-15T14:00:01.000Z",
    event_type: "tool_call",
    parent_id: null,
    agent_id: "test-agent",
    payload: { tool_name: "file_read", arguments: { path: "/tmp" } },
    redacted: false,
    prev_hash: "abc",
    event_hash: "def",
    metadata: null,
    schema_version: "1.0.0",
  } as TraceEvent;
}

describe("extractEnvelope", () => {
  test("valid trace with full envelope extracts all fields", () => {
    const event = makeSessionStart({
      replay_seed: 42,
      agent_version: "0.1.0",
      dependencies: { lodash: "4.17.21" },
      environment: { node: "20.10.0", os: "linux" },
    });

    const envelope = extractEnvelope([event]);

    expect(envelope.replaySeed).toBe(42);
    expect(envelope.agentVersion).toBe("0.1.0");
    expect(envelope.dependencies).toEqual({ lodash: "4.17.21" });
    expect(envelope.environment).toEqual({ node: "20.10.0", os: "linux" });
  });

  test("trace with only replay_seed extracts seed, others undefined", () => {
    const event = makeSessionStart({ replay_seed: 99 });
    const envelope = extractEnvelope([event]);

    expect(envelope.replaySeed).toBe(99);
    expect(envelope.agentVersion).toBeUndefined();
    expect(envelope.dependencies).toBeUndefined();
    expect(envelope.environment).toBeUndefined();
  });

  test("empty trace throws INVALID_ENVELOPE", () => {
    expect(() => extractEnvelope([])).toThrow(KrynixError);
    try {
      extractEnvelope([]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_ENVELOPE");
    }
  });

  test("first event not lifecycle throws INVALID_ENVELOPE", () => {
    const tc = makeToolCall();
    expect(() => extractEnvelope([tc])).toThrow(KrynixError);
    try {
      extractEnvelope([tc]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_ENVELOPE");
    }
  });

  test("first event lifecycle but not session_start throws INVALID_ENVELOPE", () => {
    const event = {
      ...makeSessionStart({ replay_seed: 42 }),
      payload: { action: "session_end" },
    } as TraceEvent;

    expect(() => extractEnvelope([event])).toThrow(KrynixError);
    try {
      extractEnvelope([event]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_ENVELOPE");
    }
  });

  test("missing replay_seed throws INVALID_ENVELOPE", () => {
    const event = makeSessionStart({ agent_version: "0.1.0" });
    expect(() => extractEnvelope([event])).toThrow(KrynixError);
    try {
      extractEnvelope([event]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_ENVELOPE");
    }
  });

  test("replay_seed > MAX_SAFE_INTEGER throws INVALID_SEED", () => {
    const event = makeSessionStart({ replay_seed: Number.MAX_SAFE_INTEGER + 1 });
    expect(() => extractEnvelope([event])).toThrow(KrynixError);
    try {
      extractEnvelope([event]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });

  test("extra unknown fields in context are ignored", () => {
    const event = makeSessionStart({
      replay_seed: 42,
      unknown_field: "ignored",
      another: 123,
    });

    const envelope = extractEnvelope([event]);
    expect(envelope.replaySeed).toBe(42);
    expect(envelope).not.toHaveProperty("unknown_field");
    expect(envelope).not.toHaveProperty("another");
  });

  test("dependencies map extracted correctly", () => {
    const event = makeSessionStart({
      replay_seed: 42,
      dependencies: { lodash: "4.17.21", express: "4.18.2" },
    });

    const envelope = extractEnvelope([event]);
    expect(envelope.dependencies).toEqual({
      lodash: "4.17.21",
      express: "4.18.2",
    });
  });

  test("non-string dependency values are filtered out", () => {
    const event = makeSessionStart({
      replay_seed: 42,
      dependencies: { lodash: "4.17.21", bad_num: 123, bad_null: null, bad_obj: { nested: true } },
    });

    const envelope = extractEnvelope([event]);
    expect(envelope.dependencies).toEqual({ lodash: "4.17.21" });
  });

  test("non-string environment values are filtered out", () => {
    const event = makeSessionStart({
      replay_seed: 42,
      environment: { node: "20.10.0", bad_num: 42, bad_bool: true },
    });

    const envelope = extractEnvelope([event]);
    expect(envelope.environment).toEqual({ node: "20.10.0" });
  });

  test("all-non-string dependencies results in empty object", () => {
    const event = makeSessionStart({
      replay_seed: 42,
      dependencies: { a: 1, b: null, c: false },
    });

    const envelope = extractEnvelope([event]);
    expect(envelope.dependencies).toEqual({});
  });

  test("replay_seed of 0 throws INVALID_SEED", () => {
    const event = makeSessionStart({ replay_seed: 0 });
    expect(() => extractEnvelope([event])).toThrow(KrynixError);
    try {
      extractEnvelope([event]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });

  test("negative replay_seed throws INVALID_SEED", () => {
    const event = makeSessionStart({ replay_seed: -5 });
    expect(() => extractEnvelope([event])).toThrow(KrynixError);
    try {
      extractEnvelope([event]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });

  test("fractional replay_seed throws INVALID_SEED", () => {
    const event = makeSessionStart({ replay_seed: 3.14 });
    expect(() => extractEnvelope([event])).toThrow(KrynixError);
    try {
      extractEnvelope([event]);
    } catch (e) {
      expect((e as KrynixError).code).toBe("INVALID_SEED");
    }
  });
});
