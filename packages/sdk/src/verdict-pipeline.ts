/**
 * The verdict pipeline — the SDK's core decision loop.
 *
 * Adapter-agnostic. Given a partial in-flight TraceEvent (built by an
 * adapter from the caller's request) and a Policy, returns a
 * structured `PipelineOutcome` describing what the adapter should do
 * next: forward, redact-then-forward, throw, or submit-for-approval.
 *
 * The pipeline does NOT itself emit ingest events or poll for
 * approvals — those side effects live in the adapter callsite so the
 * pipeline stays pure and unit-testable.
 *
 * Flow:
 *
 *   buildEvent → matchSingleEvent(event, policy) → branch on verdict
 *
 *   pass               → outcome: forward(originalBody)
 *   redact             → applyRedactions → outcome: forward(redactedBody) + applied[]
 *   fail               → outcome: deny(ruleId)
 *   require-approval   → outcome: requireApproval(ruleId, onTimeout)
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import {
  matchSingleEvent,
  type Policy,
  type Redaction,
  type SingleEventResult,
} from "@krynix/policy";
import type { PolicyDecisionRedaction } from "@krynix/core";
import { applyRedactions } from "./redact.js";
import type { RedactionMode } from "./types.js";

// ---------------------------------------------------------------------------
// Outcome types
// ---------------------------------------------------------------------------

/**
 * Structured warning emitted by the pipeline when a decision was technically
 * forwardable but something suspicious happened along the way. Always
 * non-fatal — the adapter still gets a usable `PipelineOutcome` — but
 * adapter authors are expected to surface these to operators (log,
 * counter, alert) rather than discard them.
 *
 * Added in `@krynix/sdk@0.1.0-alpha.2` to close the silent-failure mode
 * surfaced in krynix#56: a `redact` rule that matched but applied no
 * redactions (typo in the path, regex that didn't match, etc.) used to
 * downgrade silently to `verdict: pass` with no signal to the caller.
 */
export type PipelineWarning = {
  kind: "redaction_no_op";
  ruleId: string;
  paths: string[];
  reason: "no_directives" | "redaction_mode_off" | "path_or_pattern_no_match";
  /**
   * Human-readable explanation. Stable enough to be useful in logs;
   * not stable enough to switch on — switch on `reason` instead.
   */
  message: string;
};

/**
 * What the adapter should do after the pipeline runs.
 *
 * Discriminated union by `action` so the adapter switch is
 * exhaustive at the type level.
 */
export type PipelineOutcome =
  | {
      action: "forward";
      /** The request body to send upstream — same as the input on `pass`, redacted on `redact`. */
      body: unknown;
      /** Empty on `pass`; populated on `redact` (the audit-trail list to attach to the decision event). */
      appliedRedactions: PolicyDecisionRedaction[];
      verdict: "pass" | "redact";
      ruleId?: string;
      /**
       * Non-fatal warnings — see `PipelineWarning`. Absent when there are
       * none. Adapter authors SHOULD log these or surface them in their
       * observability layer; ignoring them turns silent-failure modes
       * like krynix#56 back on.
       */
      warnings?: PipelineWarning[];
    }
  | {
      action: "deny";
      ruleId: string;
      /** Human-readable reason from the matched rule. */
      message: string;
      verdict: "fail";
    }
  | {
      action: "require-approval";
      ruleId: string;
      message: string;
      verdict: "require-approval";
      /** What to do if the approval queue times out (soft-block). SDK default `"deny"` when absent. */
      onTimeout?: "allow" | "deny";
    };

/**
 * Run the pipeline. Pure function.
 *
 * @param event - The in-flight TraceEvent built by the adapter.
 * @param body - The original request body. Returned (or deep-cloned + redacted) on `forward`.
 * @param policy - The policy to evaluate against.
 * @param redactionMode - SDK redaction mode (from `ctx.redactionMode`). Defaults to `"regex"`
 *                       to keep the previous call-site behaviour. When `"off"`, a matched
 *                       `redact` rule is downgraded to a `pass` outcome — the original body
 *                       is forwarded and no redactions are applied. The matched `ruleId` is
 *                       still surfaced so adapters can record the rule fired but had no
 *                       effect on the outgoing call.
 */
export function runPipeline(
  event: TraceEvent,
  body: unknown,
  policy: Policy,
  redactionMode: RedactionMode = "regex",
): PipelineOutcome {
  // `Krynix`'s constructor rejects `"presidio"` up front (via
  // `resolveRedactionMode`), so the SDK's own dispatch never lands
  // here with that mode. But `runPipeline` is also exported as a
  // public collaborator for third-party adapter authors. Guard
  // defensively so a direct caller doesn't silently fall through to
  // the regex path on `"presidio"` (which is what the previous
  // `redactionMode === "off"` special-case allowed). Same wording as
  // `resolveRedactionMode` so callers see a consistent error message
  // regardless of which entry point they hit.
  if (redactionMode === "presidio") {
    throw new Error(
      "Presidio-based redaction is not yet implemented in this @krynix/sdk release. " +
        "Use `redaction: { mode: 'regex' }` or `'off'`. Presidio integration is planned for v0.2.",
    );
  }

  const result: SingleEventResult = matchSingleEvent(event, policy);

  switch (result.verdict) {
    case "pass":
      return {
        action: "forward",
        body,
        appliedRedactions: [],
        verdict: "pass",
        ruleId: result.ruleId,
      };

    case "redact": {
      // Two downgrades to `pass` happen here, both important for
      // emitting valid `policy_decision` events downstream:
      //
      // 1. `redactionMode === "off"` — caller asked us not to mutate
      //    request bodies. Forward the original and record the rule
      //    match. Adapters MUST treat this as `verdict: "pass"` so
      //    the event passes the core schema (which requires
      //    `redactions: minItems 1` when verdict is `redact`).
      // 2. `applied.length === 0` — the rule directives didn't change
      //    anything (regex had no matches, path missing, non-string
      //    leaf). Forwarding a `verdict: "redact"` with an empty
      //    `redactions[]` would violate the same schema constraint
      //    and would be lying about what happened on the wire.
      //
      // `result.redactions` is normalised to `[]` by `matchSingleEvent`
      // (see evaluator.ts: `redactions: rule.redactions ?? []`). The
      // `?? []` here is a TypeScript narrowing aid only — the public
      // `SingleEventResult.redactions` is declared optional because
      // not every verdict branch carries it, and TS can't narrow
      // through a function-call result.
      const ruleId = result.ruleId ?? "__unknown__";

      if (redactionMode === "off") {
        return {
          action: "forward",
          body,
          appliedRedactions: [],
          verdict: "pass",
          ruleId,
          warnings: [
            {
              kind: "redaction_no_op",
              ruleId,
              paths: (result.redactions ?? []).map((r) => r.path),
              reason: "redaction_mode_off",
              message:
                "Rule matched action: redact but `redaction.mode` is `'off'`; forwarding the original body unmodified.",
            },
          ],
        };
      }
      const redactions: Redaction[] = result.redactions ?? [];
      // Short-circuit the no-directives case before allocating: a rule
      // matched `action: redact` with no `redactions[]` directives
      // (hand-built policies; the parser would reject this) means
      // there's nothing to apply. Skip the deep-clone + traversal
      // entirely. The other empty-applied case (regex ran but matched
      // nothing) still goes through `applyRedactions` because we need
      // its return value to know `applied.length === 0`.
      if (redactions.length === 0) {
        return {
          action: "forward",
          body,
          appliedRedactions: [],
          verdict: "pass",
          ruleId,
          warnings: [
            {
              kind: "redaction_no_op",
              ruleId,
              paths: [],
              reason: "no_directives",
              message:
                "Rule matched action: redact but carries no `redactions[]` directives; nothing to apply. Forwarding the original body.",
            },
          ],
        };
      }
      const { body: redactedBody, applied } = applyRedactions(body, redactions);
      if (applied.length === 0) {
        return {
          action: "forward",
          body,
          appliedRedactions: [],
          verdict: "pass",
          ruleId,
          warnings: [
            {
              kind: "redaction_no_op",
              ruleId,
              paths: redactions.map((r) => r.path),
              reason: "path_or_pattern_no_match",
              message:
                "Rule matched action: redact and supplied directives, but none applied (path did not resolve to a string, or regex did not match). Forwarding the ORIGINAL body unmodified — this likely indicates a policy bug.",
            },
          ],
        };
      }
      return {
        action: "forward",
        body: redactedBody,
        appliedRedactions: applied,
        verdict: "redact",
        ruleId,
      };
    }

    case "fail":
      return {
        action: "deny",
        ruleId: result.ruleId ?? "__unknown__",
        message: result.message ?? "policy denied",
        verdict: "fail",
      };

    case "require-approval":
      return {
        action: "require-approval",
        ruleId: result.ruleId ?? "__unknown__",
        message: result.message ?? "approval required",
        verdict: "require-approval",
        onTimeout: result.onTimeout,
      };
  }
}
