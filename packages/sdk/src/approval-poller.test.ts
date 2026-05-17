import { describe, test, expect } from "vitest";
import { SCHEMA_VERSION, type TraceEvent } from "@krynix/core";
import { ApprovalPoller } from "./approval-poller.js";
import { ApprovalDenied, ApprovalTimeout } from "./errors.js";
import type { ApprovalStatusResult, ApprovalSubmitResult, IngestClient } from "./ingest-client.js";

// ---------------------------------------------------------------------------
// Fake client — submit returns a fixed approval_id; getApproval reads from a
// preset queue of status responses (or throws if the queue runs out).
//
// Cast through `unknown` because `IngestClient` is a class with private
// fields (baseUrl/apiKey/timeoutMs/request) that block structural casts.
// ---------------------------------------------------------------------------

function makeFakeClient(
  initialStatus: ApprovalSubmitResult["status"] = "pending",
  pollResponses: ApprovalStatusResult[] = [],
): IngestClient {
  const approvalId = "appr-1";
  let pollIndex = 0;
  const stub = {
    submitEvents: async () => undefined,
    submitApproval: async (): Promise<ApprovalSubmitResult> => ({
      approval_id: approvalId,
      status: initialStatus,
      created_at: "2026-05-16T00:00:00.000Z",
      expires_at: "2026-05-16T00:00:30.000Z",
    }),
    getApproval: async (): Promise<ApprovalStatusResult> => {
      const r = pollResponses[pollIndex++];
      if (r === undefined) {
        throw new Error("ran out of preset poll responses");
      }
      return r;
    },
  };
  return stub as unknown as IngestClient;
}

function makeDecisionEvent(): TraceEvent {
  return {
    event_id: "evt-0",
    session_id: "s",
    sequence_num: 0,
    timestamp: "2026-05-16T00:00:00.000Z",
    parent_id: null,
    agent_id: "a",
    event_type: "decision",
    payload: {
      action: "require-approval",
      reasoning: "test",
      policy_decision: { verdict: "require-approval", rule_id: "r1", latency_ms: 1 },
    },
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION,
  } as unknown as TraceEvent;
}

// ---------------------------------------------------------------------------

describe("ApprovalPoller — terminal statuses on first poll", () => {
  test("approve → action: approve", async () => {
    const client = makeFakeClient("pending", [
      {
        approval_id: "appr-1",
        status: "approved",
        resolved_at: "2026-05-16T00:00:01.000Z",
        resolved_by: "alice",
        resolved_action: "approve",
      },
    ]);
    const poller = new ApprovalPoller({
      client,
      sessionId: "s",
      config: { mode: "soft", timeoutMs: 5_000, pollIntervalMs: 1 },
    });

    const outcome = await poller.waitForApproval(makeDecisionEvent(), "r1", "deny");
    expect(outcome.action).toBe("approve");
  });

  test("denied → throws ApprovalDenied", async () => {
    const client = makeFakeClient("pending", [
      {
        approval_id: "appr-1",
        status: "denied",
        resolved_at: "2026-05-16T00:00:01.000Z",
        resolved_by: "alice",
        resolved_action: "deny",
        notes: "not safe",
      },
    ]);
    const poller = new ApprovalPoller({
      client,
      sessionId: "s",
      config: { mode: "soft", timeoutMs: 5_000, pollIntervalMs: 1 },
    });

    await expect(poller.waitForApproval(makeDecisionEvent(), "r1", "deny")).rejects.toBeInstanceOf(
      ApprovalDenied,
    );
  });

  test("expired + onTimeout='deny' → throws ApprovalTimeout", async () => {
    const client = makeFakeClient("pending", [{ approval_id: "appr-1", status: "expired" }]);
    const poller = new ApprovalPoller({
      client,
      sessionId: "s",
      config: { mode: "soft", timeoutMs: 5_000, pollIntervalMs: 1 },
    });

    await expect(poller.waitForApproval(makeDecisionEvent(), "r1", "deny")).rejects.toBeInstanceOf(
      ApprovalTimeout,
    );
  });

  test("expired + onTimeout='allow' → action: timeout, onTimeout: allow", async () => {
    const client = makeFakeClient("pending", [{ approval_id: "appr-1", status: "expired" }]);
    const poller = new ApprovalPoller({
      client,
      sessionId: "s",
      config: { mode: "soft", timeoutMs: 5_000, pollIntervalMs: 1 },
    });

    const outcome = await poller.waitForApproval(makeDecisionEvent(), "r1", "allow");
    expect(outcome.action).toBe("timeout");
    if (outcome.action === "timeout") {
      expect(outcome.onTimeout).toBe("allow");
    }
  });
});

describe("ApprovalPoller — synchronous resolution at submit", () => {
  test("submit returns 'approved' directly → no polling", async () => {
    let polled = 0;
    const client = {
      submitEvents: async () => undefined,
      submitApproval: async (): Promise<ApprovalSubmitResult> => ({
        approval_id: "appr-1",
        status: "approved",
        created_at: "x",
        expires_at: "y",
      }),
      getApproval: async (): Promise<ApprovalStatusResult> => {
        polled++;
        throw new Error("should not be called");
      },
    };

    const poller = new ApprovalPoller({
      client: client as unknown as IngestClient,
      sessionId: "s",
      config: { mode: "soft", timeoutMs: 5_000, pollIntervalMs: 1 },
    });

    const outcome = await poller.waitForApproval(makeDecisionEvent(), "r1", "deny");
    expect(outcome.action).toBe("approve");
    expect(polled).toBe(0);
  });
});

describe("ApprovalPoller — soft-block client-side timeout", () => {
  test("never-resolving poll + onTimeout='deny' → throws ApprovalTimeout", async () => {
    const client = {
      submitEvents: async () => undefined,
      submitApproval: async (): Promise<ApprovalSubmitResult> => ({
        approval_id: "appr-1",
        status: "pending",
        created_at: "x",
        expires_at: "y",
      }),
      getApproval: async (): Promise<ApprovalStatusResult> => ({
        approval_id: "appr-1",
        status: "pending",
      }),
    };

    const poller = new ApprovalPoller({
      client: client as unknown as IngestClient,
      sessionId: "s",
      config: { mode: "soft", timeoutMs: 50, pollIntervalMs: 10, maxPollIntervalMs: 20 },
    });

    await expect(poller.waitForApproval(makeDecisionEvent(), "r1", "deny")).rejects.toBeInstanceOf(
      ApprovalTimeout,
    );
  });

  test("never-resolving poll + onTimeout='allow' → action: timeout, onTimeout: allow", async () => {
    const client = {
      submitEvents: async () => undefined,
      submitApproval: async (): Promise<ApprovalSubmitResult> => ({
        approval_id: "appr-1",
        status: "pending",
        created_at: "x",
        expires_at: "y",
      }),
      getApproval: async (): Promise<ApprovalStatusResult> => ({
        approval_id: "appr-1",
        status: "pending",
      }),
    };

    const poller = new ApprovalPoller({
      client: client as unknown as IngestClient,
      sessionId: "s",
      config: { mode: "soft", timeoutMs: 50, pollIntervalMs: 10, maxPollIntervalMs: 20 },
    });

    const outcome = await poller.waitForApproval(makeDecisionEvent(), "r1", "allow");
    expect(outcome.action).toBe("timeout");
    if (outcome.action === "timeout") {
      expect(outcome.onTimeout).toBe("allow");
    }
  });

  test("timeoutMs < pollIntervalMs — call returns near timeoutMs, not at the end of one poll", async () => {
    // Regression for the soft-mode timeout precision: before the
    // clamp, the loop slept the full `pollIntervalMs` before checking
    // elapsed, so a caller passing `timeoutMs: 30` with the default
    // `pollIntervalMs: 500` waited ~500 ms instead of the promised
    // ~30 ms. Lock the wall-clock guarantee in here so the next
    // regression fails fast.
    const client = {
      submitEvents: async () => undefined,
      submitApproval: async (): Promise<ApprovalSubmitResult> => ({
        approval_id: "appr-1",
        status: "pending",
        created_at: "x",
        expires_at: "y",
      }),
      getApproval: async (): Promise<ApprovalStatusResult> => ({
        approval_id: "appr-1",
        status: "pending",
      }),
    };

    const poller = new ApprovalPoller({
      client: client as unknown as IngestClient,
      sessionId: "s",
      // pollIntervalMs is 10× the timeoutMs.
      config: { mode: "soft", timeoutMs: 30, pollIntervalMs: 300, maxPollIntervalMs: 300 },
    });

    const start = Date.now();
    await expect(poller.waitForApproval(makeDecisionEvent(), "r1", "deny")).rejects.toBeInstanceOf(
      ApprovalTimeout,
    );
    const elapsed = Date.now() - start;
    // The previous (broken) implementation would take ~300 ms here.
    // Allow a generous 150 ms cap so CI timing jitter doesn't make
    // this flake, but still well below the broken 300 ms.
    expect(elapsed).toBeLessThan(150);
  });
});
