/**
 * Local approval-handler API — the OSS counterpart to the hosted
 * `ApprovalPoller`.
 *
 * The hosted approval pathway (`ApprovalPoller`) submits a row to the
 * Krynix ingest server and polls the resolution endpoint. That requires
 * an ingest endpoint, which is a team / paid-tier surface.
 *
 * The `approvalHandler` callback resolves `require-approval` verdicts
 * **without** an ingest server. Same wire shape — `ApprovalDecision` —
 * different transport. Three built-in handlers ship:
 *
 *   - `denyAllApprovalHandler`     — deny-by-default, useful as a strict
 *                                    fallback when human review is
 *                                    unavailable
 *   - `cliPromptApprovalHandler`   — pause the agent, prompt on stdin,
 *                                    parse `y` / `n` (CLI agents, dev)
 *   - `webhookApprovalHandler`     — POST the approval event to a URL,
 *                                    await the resolution (server-side
 *                                    agents wired to existing approval
 *                                    flow)
 *
 * Bring-your-own is also fine: anything matching the `ApprovalHandler`
 * type works. The runtime will prefer a configured `ApprovalPoller`
 * over a configured `ApprovalHandler` if both are present — hosted
 * approvals carry audit trail + human-review UI, which the local path
 * doesn't.
 *
 * Added in `@krynix/sdk@0.1.0-alpha.2`. See krynix-internal strategic
 * review §1 for the design rationale.
 *
 * @module
 */

import type { TraceEvent } from "@krynix/core";
import type { Redaction } from "@krynix/policy";
import type { ApprovalOutcome, ApprovalPoller } from "./approval-poller.js";
import { ApprovalDenied, ApprovalUnavailable } from "./errors.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Event passed to a local `ApprovalHandler` callback. Carries everything
 * the handler needs to render a UI / send a webhook / decide deny.
 *
 * Mirrors the field set the hosted approval queue submits, minus the
 * ingest-specific bits (`approval_id`, `expires_at` — those don't apply
 * in-process).
 */
export interface ApprovalHandlerEvent {
  /** The session this approval belongs to. */
  readonly sessionId: string;
  /** The agent id from the SDK options. */
  readonly agentId: string;
  /** The matched policy rule id (e.g. `"approve-account-deletion"`). */
  readonly ruleId: string;
  /** Human-readable reason from the matched rule's `message` field. */
  readonly message: string;
  /** What `on_timeout` says on the rule (`"allow"` / `"deny"` / undefined → `"deny"`). */
  readonly onTimeout: "allow" | "deny" | undefined;
  /**
   * The original request body the SDK was about to forward. The handler
   * can inspect this to render diff UIs, but MUST NOT mutate it — the
   * `redactions` field on an `approve_with_redactions` decision is the
   * supported way to alter the body.
   */
  readonly body: unknown;
  /**
   * The full `policy_decision` event that triggered this approval.
   * Includes the rule match, redaction candidates, and request summary.
   * For handlers that need to construct an audit record.
   */
  readonly decisionEvent: TraceEvent;
}

/**
 * What the handler decided. Three actions; the adapter routes based on
 * `action`:
 *
 *   - `approve`                    — forward the original body
 *   - `approve_with_redactions`    — apply the given redactions to the
 *                                    body, then forward
 *   - `deny`                       — throw `ApprovalDenied` to the caller
 */
export type ApprovalDecision =
  | { readonly action: "approve" }
  | {
      readonly action: "approve_with_redactions";
      readonly redactions: readonly Redaction[];
    }
  | {
      readonly action: "deny";
      /** Surfaced on the thrown `ApprovalDenied.notes`. Optional. */
      readonly reason?: string;
    };

/**
 * Async function that resolves a `require-approval` verdict in-process.
 *
 * Implementations MAY throw — the verdict pipeline propagates exceptions
 * to the caller as a rejected promise. Throwing is the cleanest way to
 * signal "the human review path is broken" (vs a deny decision, which
 * is a deliberate refusal).
 */
export type ApprovalHandler = (event: ApprovalHandlerEvent) => Promise<ApprovalDecision>;

// ---------------------------------------------------------------------------
// Built-in handlers
// ---------------------------------------------------------------------------

/**
 * Deny-by-default handler. Use this when the caller knows there is no
 * human reviewer available and any `require-approval` verdict should be
 * treated as a hard deny.
 *
 * Strictly safer than leaving `approvalHandler` undefined: with this
 * handler configured, the adapter gets a clean `ApprovalDenied` (which
 * downstream code can catch + classify) rather than an
 * `ApprovalUnavailable` (which signals a misconfiguration).
 */
export const denyAllApprovalHandler: ApprovalHandler = async (event) => {
  return {
    action: "deny",
    reason: `Auto-deny: no human reviewer configured (rule=${event.ruleId})`,
  };
};

/**
 * Build an approval handler that prompts on stdin. The agent process
 * pauses; an operator types one of:
 *
 *   `y` / `yes`   — approve
 *   `n` / `no`    — deny (generic reason)
 *   `r`           — deny + supply a custom reason on a follow-up line
 *
 * Any other input (including empty) is treated as a generic deny — same
 * as `n` — so an operator who walks away or hits Enter never accidentally
 * approves.
 *
 * Suitable for CLI agents, local dev, single-operator scripts. Not
 * suitable for headless servers — there is no terminal to prompt on.
 *
 * The implementation lazily imports `node:readline` so the module
 * still resolves cleanly in environments that don't have it
 * (browsers, edge runtimes); calling the returned handler in such an
 * environment throws.
 */
export function cliPromptApprovalHandler(): ApprovalHandler {
  return async (event) => {
    const readline = await import("node:readline");
    if (!process.stdin.isTTY) {
      // Refuse early — silent prompts that hang the agent are worse than
      // a loud throw. Tell the caller to use a different handler.
      throw new Error(
        "cliPromptApprovalHandler: stdin is not a TTY. Use webhookApprovalHandler or " +
          "denyAllApprovalHandler in non-interactive environments.",
      );
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const summary =
      `\n──── Krynix approval required ────\n` +
      `  rule:    ${event.ruleId}\n` +
      `  agent:   ${event.agentId}\n` +
      `  session: ${event.sessionId}\n` +
      `  reason:  ${event.message}\n` +
      `  on_timeout: ${event.onTimeout ?? "deny"} (informational)\n` +
      `  body:    ${safePreview(event.body, 200)}\n`;

    return new Promise<ApprovalDecision>((resolve) => {
      process.stdout.write(summary);
      rl.question("Approve? [y/N/r=deny-with-reason] ", (answer: string) => {
        const a = answer.trim().toLowerCase();
        if (a === "y" || a === "yes") {
          rl.close();
          resolve({ action: "approve" });
          return;
        }
        if (a === "r") {
          // Two-step deny: collect the reason on a follow-up line, then
          // resolve. Empty reason still produces a valid deny.
          rl.question("Reason: ", (reasonLine: string) => {
            rl.close();
            const reason = reasonLine.trim();
            resolve({
              action: "deny",
              reason:
                reason.length > 0 ? reason : "Operator denied at CLI prompt (no reason supplied)",
            });
          });
          return;
        }
        rl.close();
        resolve({
          action: "deny",
          reason: `Operator denied at CLI prompt (input=${JSON.stringify(answer)})`,
        });
      });
    });
  };
}

/**
 * Build an approval handler that POSTs the approval event to a URL and
 * awaits the resolution. The endpoint owns the human review UX — Slack
 * webhook, internal approval queue, Slack-bot bridge, anything.
 *
 * Request body shape:
 * ```json
 * {
 *   "session_id": "...",
 *   "agent_id": "...",
 *   "rule_id": "...",
 *   "message": "...",
 *   "on_timeout": "allow" | "deny" | null,
 *   "body": <original request body>
 * }
 * ```
 *
 * Expected response (HTTP 200, JSON):
 * ```json
 * { "action": "approve" }
 *   | { "action": "approve_with_redactions", "redactions": [...] }
 *   | { "action": "deny", "reason": "..." }
 * ```
 *
 * Non-200 responses, network errors, and malformed bodies all throw —
 * the caller gets the original `ApprovalHandler` semantic ("the review
 * path is broken").
 */
export function webhookApprovalHandler(opts: {
  url: string;
  headers?: Readonly<Record<string, string>>;
  /** Max time to wait for the webhook to respond. Defaults to 30 s. */
  timeoutMs?: number;
}): ApprovalHandler {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return async (event) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Two layers of safety so an awkwardly-shaped event.body doesn't
      // crash the handler with a generic stringify error:
      //   1. `jsonSafeReplacer` rewrites BigInt / function / symbol
      //      values inline into safe placeholders. JSON.stringify would
      //      otherwise throw on BigInt and silently drop functions/symbols.
      //   2. The outer try/catch catches everything else the replacer
      //      can't help with — circular references, getters that throw
      //      on access, etc. — and falls back to a placeholder body so
      //      the request still goes through.
      // Either way the webhook receives a valid JSON request and the
      // reviewer can triage from the placeholder.
      let requestBody: string;
      try {
        requestBody = JSON.stringify(
          {
            session_id: event.sessionId,
            agent_id: event.agentId,
            rule_id: event.ruleId,
            message: event.message,
            on_timeout: event.onTimeout ?? null,
            body: event.body,
          },
          jsonSafeReplacer,
        );
      } catch (err) {
        // Replacer didn't catch it (e.g. a getter that throws). Send
        // a placeholder body rather than crash the request entirely.
        const reason = err instanceof Error ? err.message : String(err);
        requestBody = JSON.stringify({
          session_id: event.sessionId,
          agent_id: event.agentId,
          rule_id: event.ruleId,
          message: event.message,
          on_timeout: event.onTimeout ?? null,
          body: `<unserialisable body: ${reason}>`,
        });
      }
      const res = await fetch(opts.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.headers ?? {}),
        },
        body: requestBody,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(
          `webhookApprovalHandler: ${opts.url} returned HTTP ${res.status} ${res.statusText}`,
        );
      }
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error(
          `webhookApprovalHandler: ${opts.url} returned non-JSON response (${truncate(text, 80)})`,
        );
      }
      return validateDecision(parsed, opts.url);
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------------------------------------------------------------------------
// Unified resolver — adapters call this; it picks the right transport.
// ---------------------------------------------------------------------------

/**
 * Resolve a `require-approval` verdict using whichever transport the
 * caller configured: hosted `ApprovalPoller` if available, else the
 * local `ApprovalHandler`, else throw `ApprovalUnavailable`.
 *
 * The poller is preferred over the handler when both are configured —
 * hosted approvals come with the lens UI + audit trail + multi-human
 * review queue, which the local path doesn't.
 *
 * Return semantics (in all branches):
 * - resolves with `{ action: "approve" }` or
 *   `{ action: "approve_with_redactions", redactions }` → adapter
 *   forwards the call (applying redactions when present)
 * - throws `ApprovalDenied` → adapter propagates to the caller
 * - throws `ApprovalTimeout` → only from the poller; soft-block timeout
 *   that resolved to deny
 * - throws `ApprovalUnavailable` → neither transport is configured;
 *   caller must configure one
 *
 * @param params.poller - The hosted poller (or null in offline mode)
 * @param params.handler - The local handler (or null if not configured)
 * @param params.handlerEvent - Built by the adapter; passed to handler
 * @param params.policyDecisionEvent - The trace event; passed to poller
 * @param params.ruleId - Matched rule id
 * @param params.onTimeout - From the rule
 */
export async function resolveApproval(params: {
  poller: ApprovalPoller | null;
  handler: ApprovalHandler | null;
  handlerEvent: ApprovalHandlerEvent;
  policyDecisionEvent: TraceEvent;
  ruleId: string;
  onTimeout: "allow" | "deny" | undefined;
}): Promise<ResolvedApproval> {
  if (params.poller !== null) {
    const outcome: ApprovalOutcome = await params.poller.waitForApproval(
      params.policyDecisionEvent,
      params.ruleId,
      params.onTimeout,
    );
    return { action: "approve", source: "poller", pollerOutcome: outcome };
  }

  if (params.handler !== null) {
    const decision = await params.handler(params.handlerEvent);
    if (decision.action === "deny") {
      throw new ApprovalDenied(
        decision.reason ?? "approval denied by local handler",
        params.ruleId,
        // approvalId is poller-specific; surface a synthetic id so the
        // ApprovalDenied error remains structurally usable.
        "<local-handler>",
        undefined,
        decision.reason,
      );
    }
    if (decision.action === "approve_with_redactions") {
      return {
        action: "approve_with_redactions",
        source: "handler",
        redactions: [...decision.redactions],
      };
    }
    return { action: "approve", source: "handler" };
  }

  throw new ApprovalUnavailable(
    `Krynix: rule "${params.ruleId}" requires approval but no transport is configured. ` +
      `Set ingest.url + ingest.apiKey (hosted approval queue) or approvalHandler (local callback).`,
    params.ruleId,
  );
}

/**
 * Discriminated result from `resolveApproval`. Adapter authors switch on
 * `action`. The `source` tag tells the adapter which transport produced
 * the result (useful for logging and for the audit-trail event).
 */
export type ResolvedApproval =
  | {
      action: "approve";
      source: "poller";
      pollerOutcome: ApprovalOutcome;
    }
  | { action: "approve"; source: "handler" }
  | { action: "approve_with_redactions"; source: "handler"; redactions: Redaction[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Render an arbitrary `unknown` body as a short, safe preview string for
 * operator-facing output (CLI prompts, logs). Never throws — circular
 * structures, BigInt, and other JSON.stringify hazards fall back to a
 * placeholder so the calling prompt remains usable. `ApprovalHandlerEvent.body`
 * is typed `unknown`, so the prompt can't make any assumption about the
 * shape it receives.
 */
function safePreview(value: unknown, max: number): string {
  try {
    const s = JSON.stringify(value, jsonSafeReplacer);
    if (typeof s !== "string") {
      // JSON.stringify returns undefined for `undefined` / functions /
      // symbols at the root. Render those visibly instead of empty.
      return `<${typeof value}>`;
    }
    return truncate(s, max);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return `<unserialisable body: ${truncate(reason, 80)}>`;
  }
}

/**
 * JSON.stringify replacer that handles a few common hazards without
 * throwing. The remaining cases (custom non-enumerable getters that
 * throw on access, etc.) are caught by the surrounding try/catch in
 * `safePreview`.
 */
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "function") return `<function ${value.name || "anonymous"}>`;
  if (typeof value === "symbol") return value.toString();
  return value;
}

/**
 * Validate a webhook response against the `ApprovalDecision` shape.
 * Returns a strongly-typed `ApprovalDecision` or throws with a precise
 * error message. Validates each redaction item — a malformed redaction
 * (missing `path`, non-string fields) would otherwise crash the
 * downstream `applyRedactions` pipeline or, worse, silently no-op.
 */
function validateDecision(parsed: unknown, url: string): ApprovalDecision {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`webhookApprovalHandler: ${url} returned non-object body`);
  }
  const obj = parsed as Record<string, unknown>;
  const action = obj["action"];
  if (action === "approve") return { action: "approve" };
  if (action === "deny") {
    const reason = typeof obj["reason"] === "string" ? (obj["reason"] as string) : undefined;
    return { action: "deny", reason };
  }
  if (action === "approve_with_redactions") {
    const redactions = obj["redactions"];
    if (!Array.isArray(redactions)) {
      throw new Error(
        `webhookApprovalHandler: ${url} returned action=approve_with_redactions but redactions is not an array`,
      );
    }
    return {
      action: "approve_with_redactions",
      redactions: redactions.map((r, i) => validateRedaction(r, i, url)),
    };
  }
  throw new Error(
    `webhookApprovalHandler: ${url} returned unknown action ${JSON.stringify(action)}`,
  );
}

/**
 * Validate one redaction directive from a webhook response. Throws with
 * the offending field path so the operator can identify which redaction
 * failed validation.
 */
function validateRedaction(raw: unknown, index: number, url: string): Redaction {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(
      `webhookApprovalHandler: ${url} redactions[${index}] is not an object (got ${typeof raw})`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const path = obj["path"];
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(
      `webhookApprovalHandler: ${url} redactions[${index}].path must be a non-empty string`,
    );
  }
  const out: Redaction = { path };
  if (obj["pattern"] !== undefined) {
    if (typeof obj["pattern"] !== "string") {
      throw new Error(
        `webhookApprovalHandler: ${url} redactions[${index}].pattern must be a string when present`,
      );
    }
    out.pattern = obj["pattern"] as string;
  }
  if (obj["replacement"] !== undefined) {
    if (typeof obj["replacement"] !== "string") {
      throw new Error(
        `webhookApprovalHandler: ${url} redactions[${index}].replacement must be a string when present`,
      );
    }
    out.replacement = obj["replacement"] as string;
  }
  return out;
}
