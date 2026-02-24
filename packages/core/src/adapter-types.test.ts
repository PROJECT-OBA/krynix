import { describe, test, expectTypeOf } from "vitest";
import type { TraceAdapter, AdapterConfig } from "./adapter-types.js";
import type { TraceEvent } from "./types.js";

describe("TraceAdapter types", () => {
  test("valid TraceAdapter object satisfies the interface", () => {
    const adapter: TraceAdapter = {
      name: "test-adapter",
      version: "1.0.0",
      initialize: async (_config: AdapterConfig) => {},
      onEvent: (_event: unknown): TraceEvent | null => null,
      flush: async () => [],
      shutdown: async () => {},
    };

    expectTypeOf(adapter).toMatchTypeOf<TraceAdapter>();
  });

  test("AdapterConfig requires agentId, sessionId, replaySeed", () => {
    expectTypeOf<AdapterConfig>().toHaveProperty("agentId");
    expectTypeOf<AdapterConfig>().toHaveProperty("sessionId");
    expectTypeOf<AdapterConfig>().toHaveProperty("replaySeed");

    expectTypeOf<AdapterConfig["agentId"]>().toBeString();
    expectTypeOf<AdapterConfig["sessionId"]>().toBeString();
    expectTypeOf<AdapterConfig["replaySeed"]>().toBeNumber();
  });

  test("AdapterConfig options is optional", () => {
    const withoutOptions: AdapterConfig = {
      agentId: "agent-1",
      sessionId: "session-1",
      replaySeed: 42,
    };

    const withOptions: AdapterConfig = {
      agentId: "agent-1",
      sessionId: "session-1",
      replaySeed: 42,
      options: { verbose: true },
    };

    expectTypeOf(withoutOptions).toMatchTypeOf<AdapterConfig>();
    expectTypeOf(withOptions).toMatchTypeOf<AdapterConfig>();
  });
});
