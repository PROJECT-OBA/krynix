/**
 * Thin HTTPS client for the Krynix data plane API.
 *
 * Used by `EventBuffer` to ship batches of TraceEvents and by
 * `ApprovalPoller` to submit / poll / inspect approval rows.
 *
 * Uses the global `fetch` (Node 20+ and browsers ship it; matches the
 * package's `engines.node: ">=20"`). No deps.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";

export interface IngestClientOptions {
  /** Base URL, e.g. `https://api.krynix.dev`. Trailing slashes are stripped. */
  url: string;
  /** Bearer token sent as `Authorization: Bearer <apiKey>`. */
  apiKey: string;
  /**
   * Per-request timeout in ms. Default 10_000 (10 s).
   * Applies to each HTTP call; the buffer / poller layer above retries.
   */
  timeoutMs?: number;
}

/** Result of submitting an approval row (matches ingest's contract). */
export interface ApprovalSubmitResult {
  approval_id: string;
  status: "pending" | "approved" | "denied" | "expired";
  created_at: string;
  expires_at: string;
}

export interface ApprovalStatusResult {
  approval_id: string;
  status: "pending" | "approved" | "denied" | "expired";
  resolved_at?: string;
  resolved_by?: string;
  resolved_action?: "approve" | "deny" | "approve_with_redact";
  notes?: string;
  redact_overrides?: unknown[];
}

/**
 * Minimal HTTP client. Methods throw on non-2xx responses; the caller
 * (buffer / poller) decides whether to retry.
 */
export class IngestClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(opts: IngestClientOptions) {
    // Strip trailing slashes once at construction so each request
    // doesn't have to.
    this.baseUrl = opts.url.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /**
   * POST a batch of events to `/v1/sessions/:id/events`.
   *
   * Ingest computes the hash chain server-side from the raw events,
   * so the SDK does NOT need to set `prev_hash` / `event_hash` /
   * `sequence_num`. Those fields are stripped before send to keep
   * the wire small and to make the contract explicit.
   */
  async submitEvents(sessionId: string, events: TraceEvent[]): Promise<void> {
    // Strip hash-chain fields — ingest assigns them.
    const stripped = events.map((e) => {
      const {
        prev_hash: _p,
        event_hash: _h,
        sequence_num: _s,
        ...rest
      } = e as unknown as Record<string, unknown> & {
        prev_hash: string;
        event_hash: string;
        sequence_num: number;
      };
      return rest;
    });
    await this.request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/events`, {
      events: stripped,
    });
  }

  /**
   * Submit a pending approval. Returns the approval_id the caller
   * polls.
   *
   * Body wraps the `policy_decision` event itself under the key
   * `policy_decision_event`. The event carries the verdict, matched
   * rule_id, and redactions context the human reviewer needs to act
   * on the request. The server-side contract is part of the Krynix
   * HTTP API.
   */
  async submitApproval(
    sessionId: string,
    policyDecisionEvent: TraceEvent,
  ): Promise<ApprovalSubmitResult> {
    return (await this.request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/approvals`, {
      policy_decision_event: policyDecisionEvent,
    })) as ApprovalSubmitResult;
  }

  /**
   * Poll the status of a pending approval.
   */
  async getApproval(sessionId: string, approvalId: string): Promise<ApprovalStatusResult> {
    return (await this.request(
      "GET",
      `/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`,
    )) as ApprovalStatusResult;
  }

  /**
   * Shared request helper. Adds bearer auth, JSON content type on
   * POSTs, and a per-request abort timer. Non-2xx → throws.
   */
  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
      };
      let payload: string | undefined;
      if (method === "POST" && body !== undefined) {
        headers["Content-Type"] = "application/json";
        payload = JSON.stringify(body);
      }
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`ingest ${method} ${path} → ${String(res.status)}: ${text}`);
      }
      // GET responses have a body; some POSTs (events submit) return
      // 200 with empty body. Tolerate both. Trim before parsing so a
      // trailing newline or whitespace-only payload (common from
      // proxies / load balancers) doesn't blow up `JSON.parse`.
      const text = await res.text();
      const trimmed = text.trim();
      return trimmed.length > 0 ? (JSON.parse(trimmed) as unknown) : undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}
