import { describe, test, expectTypeOf } from "vitest";
import type { DivergenceReport, ReplayResult, DivergencePoint } from "./types.js";

describe("Replay types", () => {
  test("DivergenceReport with status pass compiles", () => {
    const report: DivergenceReport = {
      status: "pass",
      totalEvents: 10,
      eventsBeforeDivergence: 10,
    };

    expectTypeOf(report).toMatchTypeOf<DivergenceReport>();
  });

  test("DivergenceReport with status diverged and firstDivergence compiles", () => {
    const report: DivergenceReport = {
      status: "diverged",
      firstDivergence: {
        sequenceNum: 5,
        expected: { eventType: "tool_call", payload: { tool_name: "file_read" } },
        actual: { eventType: "decision", payload: { action: "write_file" } },
        diffs: [
          {
            field: "event_type",
            expected: "tool_call",
            actual: "decision",
          },
        ],
      },
      totalEvents: 10,
      eventsBeforeDivergence: 5,
    };

    expectTypeOf(report).toMatchTypeOf<DivergenceReport>();
    expectTypeOf(report.firstDivergence).toMatchTypeOf<DivergencePoint | undefined>();
  });

  test("ReplayResult with all status variants compiles", () => {
    const passResult: ReplayResult = {
      file: "test.trace.jsonl",
      status: "pass",
      report: {
        status: "pass",
        totalEvents: 5,
        eventsBeforeDivergence: 5,
      },
    };

    const divergedResult: ReplayResult = {
      file: "test.trace.jsonl",
      status: "diverged",
      report: {
        status: "diverged",
        firstDivergence: {
          sequenceNum: 2,
          expected: { eventType: "tool_call", payload: {} },
          actual: { eventType: "error", payload: {} },
          diffs: [],
        },
        totalEvents: 5,
        eventsBeforeDivergence: 2,
      },
    };

    const errorResult: ReplayResult = {
      file: "test.trace.jsonl",
      status: "error",
      validationErrors: ["Hash chain broken at event 3"],
    };

    expectTypeOf(passResult).toMatchTypeOf<ReplayResult>();
    expectTypeOf(divergedResult).toMatchTypeOf<ReplayResult>();
    expectTypeOf(errorResult).toMatchTypeOf<ReplayResult>();
  });
});
