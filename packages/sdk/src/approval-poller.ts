/**
 * Approval polling for the `require-approval` verdict path.
 *
 * Flow:
 *
 *   verdict is require-approval
 *   → SDK calls `submitApproval()` on ingest with the policy_decision event
 *   → ingest returns an approval_id + initial status (`"pending"`)
 *   → SDK polls `getApproval(approval_id)` until status leaves `"pending"`
 *
 * Two modes (`@krynix/sdk`'s `ApprovalConfig.mode`):
 *
 * - `"soft"` (default) — poll for at most `timeoutMs`. On timeout,
 *   apply the matched rule's `on_timeout` (default `"deny"`).
 *   Recommended for production — never hangs the agent.
 * - `"hard"` — poll indefinitely. Caller-opt-in for human-in-the-loop
 *   workflows where the agent must wait.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { IngestClient } from "./ingest-client.js";
import type { ApprovalConfig } from "./types.js";
import { ApprovalDenied, ApprovalTimeout } from "./errors.js";

/**
 * Outcome of `waitForApproval` — covers the cases where the call
 * should still proceed.
 *
 * Denials don't appear here: `waitForApproval` throws `ApprovalDenied`
 * (human deny) or `ApprovalTimeout` (soft-timeout + `on_timeout: "deny"`)
 * instead of returning a deny outcome. Adapters using this type only
 * see resolutions that should result in forwarding the upstream call.
 *
 * - `approve` — human approved the request; forward.
 * - `timeout` — soft-timeout fired AND the rule's `on_timeout` was
 *   `"allow"`. Forward but record the timeout in the audit trail.
 *   The `onTimeout` field carries the resolved value so callers can
 *   surface it.
 */
export type ApprovalOutcome =
  | { action: "approve"; approvalId: string }
  | {
      action: "timeout";
      approvalId: string;
      /** Always `"allow"` in practice — `"deny"` paths throw `ApprovalTimeout` instead. */
      onTimeout: "allow";
    };

export interface ApprovalPollerOptions {
  /** The ingest client to poll through. Required — approval polling has no offline mode. */
  client: IngestClient;
  sessionId: string;
  /** Default config from `Krynix({ approval })`. */
  config: ApprovalConfig;
}

/**
 * Submits the approval row, then polls until resolved (or timeout in
 * soft mode). The caller passes the rule-level `onTimeout` so per-rule
 * overrides take precedence over the SDK default.
 *
 * Throws:
 *   - `ApprovalDenied` — human explicitly denied via the dashboard.
 *   - `ApprovalTimeout` — soft-block ran out and `onTimeout` resolves to `"deny"`.
 *
 * Resolves normally (caller forwards the call) when:
 *   - human approved, OR
 *   - soft-block timed out and `onTimeout` resolves to `"allow"`.
 */
export class ApprovalPoller {
  private readonly client: IngestClient;
  private readonly sessionId: string;
  private readonly mode: "soft" | "hard";
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPollIntervalMs: number;

  constructor(opts: ApprovalPollerOptions) {
    this.client = opts.client;
    this.sessionId = opts.sessionId;
    this.mode = opts.config.mode ?? "soft";
    this.timeoutMs = opts.config.timeoutMs ?? 30_000;
    this.pollIntervalMs = opts.config.pollIntervalMs ?? 500;
    this.maxPollIntervalMs = opts.config.maxPollIntervalMs ?? 5_000;
  }

  /**
   * Submit the approval and wait for a resolution.
   *
   * @param policyDecisionEvent - The `decision`-typed TraceEvent with `policy_decision` set
   *                              (built by the verdict pipeline upstream). The human reviewer
   *                              is what a human reviewer sees in the approval queue.
   * @param ruleId - Used in the thrown `ApprovalDenied` / `ApprovalTimeout` error.
   * @param ruleOnTimeout - The matched rule's `on_timeout` field (`"allow"`, `"deny"`, or
   *                       undefined → SDK default `"deny"`).
   * @returns The outcome the caller acts on.
   */
  async waitForApproval(
    policyDecisionEvent: TraceEvent,
    ruleId: string,
    ruleOnTimeout: "allow" | "deny" | undefined,
  ): Promise<ApprovalOutcome> {
    const submitted = await this.client.submitApproval(this.sessionId, policyDecisionEvent);
    const approvalId = submitted.approval_id;

    // Edge case: ingest can resolve synchronously (e.g. a fast
    // auto-approve rule on the server side). Handle it before
    // entering the poll loop.
    if (submitted.status !== "pending") {
      return this.outcomeFromTerminal(approvalId, submitted.status, ruleOnTimeout, ruleId);
    }

    const start = Date.now();
    let interval = this.pollIntervalMs;

    while (true) {
      // Sleep first — submitApproval just returned, no point hammering
      // ingest immediately.
      await sleep(interval);

      const elapsed = Date.now() - start;
      if (this.mode === "soft" && elapsed >= this.timeoutMs) {
        const onTimeout = ruleOnTimeout ?? "deny";
        if (onTimeout === "deny") {
          throw new ApprovalTimeout(
            `approval ${approvalId} for rule '${ruleId}' timed out after ${String(this.timeoutMs)} ms (on_timeout: deny)`,
            ruleId,
            approvalId,
            this.timeoutMs,
          );
        }
        return { action: "timeout", approvalId, onTimeout };
      }

      let status;
      try {
        status = await this.client.getApproval(this.sessionId, approvalId);
      } catch {
        // Transient ingest failure — back off and retry. The
        // soft-block timeout still applies (it's wall-clock).
        interval = Math.min(interval * 2, this.maxPollIntervalMs);
        continue;
      }

      if (status.status === "pending") {
        // Exponential backoff capped at `maxPollIntervalMs` — interval
        // doubles after every still-pending response starting from the
        // first poll, then plateaus once the cap is hit. The cap (default
        // 5 s) keeps the wall-clock-driven `timeoutMs` budget honest:
        // unbounded growth would let a long timeoutMs sit idle most of
        // its budget.
        interval = Math.min(interval * 2, this.maxPollIntervalMs);
        continue;
      }

      return this.outcomeFromTerminal(
        approvalId,
        status.status,
        ruleOnTimeout,
        ruleId,
        status.resolved_by,
        status.notes,
      );
    }
  }

  private outcomeFromTerminal(
    approvalId: string,
    status: "approved" | "denied" | "expired" | "pending",
    ruleOnTimeout: "allow" | "deny" | undefined,
    ruleId: string,
    resolvedBy?: string,
    notes?: string,
  ): ApprovalOutcome {
    switch (status) {
      case "approved":
        return { action: "approve", approvalId };
      case "denied":
        throw new ApprovalDenied(
          `approval ${approvalId} for rule '${ruleId}' was denied`,
          ruleId,
          approvalId,
          resolvedBy,
          notes,
        );
      case "expired": {
        // Server-side timeout. Treat like a local soft-block timeout —
        // apply `on_timeout` semantics so the SDK behaviour is
        // consistent regardless of whose clock won.
        const onTimeout = ruleOnTimeout ?? "deny";
        if (onTimeout === "deny") {
          throw new ApprovalTimeout(
            `approval ${approvalId} for rule '${ruleId}' expired on the server (on_timeout: deny)`,
            ruleId,
            approvalId,
            this.timeoutMs,
          );
        }
        return { action: "timeout", approvalId, onTimeout };
      }
      case "pending":
        // Shouldn't reach here from a terminal call — but treat as a
        // safety net. Force a soft-timeout error so we don't return a
        // bogus "approve" to the adapter.
        throw new ApprovalTimeout(
          `approval ${approvalId} for rule '${ruleId}' returned pending unexpectedly`,
          ruleId,
          approvalId,
          this.timeoutMs,
        );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
