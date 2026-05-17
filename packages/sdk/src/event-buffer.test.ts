import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { SCHEMA_VERSION, type TraceEvent } from "@krynix/core";
import { EventBuffer } from "./event-buffer.js";
import type { IngestClient } from "./ingest-client.js";

// ---------------------------------------------------------------------------
// Fake ingest client — records every submitEvents call, optionally throws.
// ---------------------------------------------------------------------------

interface SubmitCall {
  sessionId: string;
  count: number;
  attemptIndex: number;
}

function makeFakeClient(opts: { failFirstN?: number } = {}): {
  client: IngestClient;
  calls: SubmitCall[];
} {
  const calls: SubmitCall[] = [];
  let failuresLeft = opts.failFirstN ?? 0;
  let attempt = 0;
  const client: Partial<IngestClient> = {
    async submitEvents(sessionId, events) {
      const attemptIndex = attempt++;
      calls.push({ sessionId, count: events.length, attemptIndex });
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error(`simulated transport failure (attempt ${String(attemptIndex)})`);
      }
    },
    async submitApproval() {
      throw new Error("not used in buffer tests");
    },
    async getApproval() {
      throw new Error("not used in buffer tests");
    },
  };
  return { client: client as IngestClient, calls };
}

function makeEvent(seq: number): TraceEvent {
  return {
    event_id: `evt-${String(seq)}`,
    session_id: "sess-1",
    sequence_num: seq,
    timestamp: "2026-05-16T00:00:00.000Z",
    parent_id: null,
    agent_id: "a",
    event_type: "decision",
    payload: { action: "x", reasoning: "y" },
    redacted: false,
    prev_hash: "",
    event_hash: "",
    metadata: null,
    schema_version: SCHEMA_VERSION,
  } as unknown as TraceEvent;
}

// ---------------------------------------------------------------------------

describe("EventBuffer — offline mode (client === null)", () => {
  test("enqueue + close are no-ops when client is null", async () => {
    const buf = new EventBuffer({ client: null, sessionId: "s" });
    buf.enqueue(makeEvent(0));
    buf.enqueue(makeEvent(1));
    await buf.close();
    // No throw, no flush attempted — happy path.
    expect(true).toBe(true);
  });
});

describe("EventBuffer — batching", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("flushes when maxBatchSize is reached", async () => {
    const { client, calls } = makeFakeClient();
    const buf = new EventBuffer({
      client,
      sessionId: "s",
      maxBatchSize: 3,
      flushIntervalMs: 1_000_000, // effectively disabled
    });
    buf.enqueue(makeEvent(0));
    buf.enqueue(makeEvent(1));
    expect(calls).toHaveLength(0); // not yet at threshold

    buf.enqueue(makeEvent(2));
    // enqueue → void flush(); awaiting microtask queue is enough
    await vi.waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    expect(calls[0]).toEqual({ sessionId: "s", count: 3, attemptIndex: 0 });

    await buf.close();
  });

  test("flush() drains events enqueued while a previous batch was in flight", async () => {
    // Regression test for the round-2 race: flush() used to return
    // as soon as the in-flight promise resolved, even if new events
    // had arrived during the send. Now flush() loops until both
    // inFlight is null AND the queue is empty.
    let releaseFirstSend = (): void => undefined;
    const releaseFirstSendPromise = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    const calls: SubmitCall[] = [];
    let attempt = 0;
    const client: Partial<IngestClient> = {
      submitEvents: async (sessionId, events) => {
        const attemptIndex = attempt++;
        calls.push({ sessionId, count: events.length, attemptIndex });
        // Block the FIRST send until we explicitly release it, so we
        // can enqueue more events while it's in flight.
        if (attemptIndex === 0) {
          await releaseFirstSendPromise;
        }
      },
    };
    const buf = new EventBuffer({
      client: client as IngestClient,
      sessionId: "s",
      maxBatchSize: 1,
      flushIntervalMs: 1_000_000,
    });

    // Trigger the first batch (it'll hang waiting on the release promise).
    buf.enqueue(makeEvent(0));
    await vi.waitFor(() => {
      expect(calls.length).toBe(1);
    });

    // Enqueue more events while the first send is hanging.
    buf.enqueue(makeEvent(1));
    buf.enqueue(makeEvent(2));

    // Release the first send + call flush(). The single flush() must
    // drain the events that landed while the first batch was in flight
    // — that's the contract Copilot review on #53 round 2 flagged.
    releaseFirstSend();
    await buf.flush();

    // Three events total made it across. Batch shape varies (the
    // second + third may have been batched together since they both
    // arrived during the first send) but the total count is what the
    // drain contract guarantees.
    const totalEvents = calls.reduce((sum, c) => sum + c.count, 0);
    expect(totalEvents).toBe(3);

    await buf.close();
  });

  test("close() flushes pending events even if below maxBatchSize", async () => {
    const { client, calls } = makeFakeClient();
    const buf = new EventBuffer({
      client,
      sessionId: "s",
      maxBatchSize: 100,
      flushIntervalMs: 1_000_000,
    });
    buf.enqueue(makeEvent(0));
    buf.enqueue(makeEvent(1));

    await buf.close();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.count).toBe(2);
  });
});

describe("EventBuffer — retries", () => {
  // Inject `backoffMs: () => 0` so the retry suite completes instantly
  // without exercising the real 200/400/800 ms wall-clock delays. The
  // default backoff is still covered indirectly via the
  // `defaultBackoffMs` math — production behaviour is unchanged.
  test("retries transport failures and eventually succeeds", async () => {
    const { client, calls } = makeFakeClient({ failFirstN: 2 });
    const errors: unknown[] = [];
    const buf = new EventBuffer({
      client,
      sessionId: "s",
      maxBatchSize: 1,
      flushIntervalMs: 1_000_000,
      maxRetries: 3,
      backoffMs: () => 0,
      onError: (e) => errors.push(e),
    });

    buf.enqueue(makeEvent(0));
    await buf.close();

    // 3 calls total: 2 failures + 1 success.
    expect(calls).toHaveLength(3);
    // onError is only invoked on retry-exhaustion, not on individual retries.
    expect(errors).toHaveLength(0);
  });

  test("drops the batch after maxRetries+1 attempts and surfaces via onError", async () => {
    const { client, calls } = makeFakeClient({ failFirstN: 10 });
    const errors: unknown[] = [];
    const buf = new EventBuffer({
      client,
      sessionId: "s",
      maxBatchSize: 1,
      flushIntervalMs: 1_000_000,
      maxRetries: 2, // → 3 total attempts
      backoffMs: () => 0,
      onError: (e) => errors.push(e),
    });

    buf.enqueue(makeEvent(0));
    await buf.close();

    // 3 attempts, all failed; batch dropped; onError fired once.
    expect(calls).toHaveLength(3);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toMatch(/simulated transport failure/);
  });

  test("uses backoffMs(attempt) for every retry — verifies the injection point", async () => {
    const { client, calls } = makeFakeClient({ failFirstN: 2 });
    const backoffCalls: number[] = [];
    const buf = new EventBuffer({
      client,
      sessionId: "s",
      maxBatchSize: 1,
      flushIntervalMs: 1_000_000,
      maxRetries: 3,
      backoffMs: (attempt) => {
        backoffCalls.push(attempt);
        return 0;
      },
    });

    buf.enqueue(makeEvent(0));
    await buf.close();

    expect(calls).toHaveLength(3);
    // Backoff called twice — once before retry 2, once before retry 3.
    expect(backoffCalls).toEqual([1, 2]);
  });
});
