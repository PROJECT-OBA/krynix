/**
 * Error types raised by the SDK's verdict pipeline.
 *
 * All errors here propagate to the caller through the wrapped
 * client's normal call path — that path is always async (because
 * the wrapped SDKs return promises), so callers always `await`
 * a wrapped call and `catch` errors via a promise-rejection
 * handler / `try/await/catch`. Concretely:
 *
 * - `PolicyDenied` rejects on the wrapped call's promise as soon
 *   as the in-process verdict pipeline lands on `fail`. No network
 *   round-trip is involved — the verdict comes from
 *   `matchSingleEvent` in `@krynix/policy`.
 * - `ApprovalDenied` and `ApprovalTimeout` reject after one or more
 *   network polls against the ingest approval endpoint. They are
 *   inherently async — the caller can't catch them before
 *   awaiting.
 *
 * These are NOT `KrynixError` (which is the OSS-engine error class
 * for hash-chain / canonical-JSON failures) — runtime policy
 * errors are a distinct concern that consumers want to catch
 * separately from infrastructure errors.
 *
 * Naming: `Policy*` for policy verdicts, `Approval*` for the
 * require-approval polling path.
 *
 * @module
 */

/** Base class for SDK-thrown errors. Exists so consumers can `instanceof KrynixSdkError`. */
export class KrynixSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KrynixSdkError";
  }
}

/**
 * Thrown when a policy verdict is `"fail"` (matched a `deny` rule or
 * the `defaults.unmatched_action: "deny"` path fired).
 *
 * Carries the matched rule ID so the caller can disambiguate which
 * rule denied the call.
 */
export class PolicyDenied extends KrynixSdkError {
  readonly ruleId: string;

  constructor(message: string, ruleId: string) {
    super(message);
    this.name = "PolicyDenied";
    this.ruleId = ruleId;
  }
}

/**
 * Thrown when an approval request times out (soft-block mode) and the
 * rule's `on_timeout` is `"deny"` (or default — the SDK default for an
 * omitted `on_timeout` is `"deny"`).
 *
 * If `on_timeout` is `"allow"` the SDK forwards the call instead of
 * throwing.
 */
export class ApprovalTimeout extends KrynixSdkError {
  readonly ruleId: string;
  readonly approvalId: string;
  readonly timeoutMs: number;

  constructor(message: string, ruleId: string, approvalId: string, timeoutMs: number) {
    super(message);
    this.name = "ApprovalTimeout";
    this.ruleId = ruleId;
    this.approvalId = approvalId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown by the verdict pipeline when a rule returns `require-approval`
 * but the SDK has no way to resolve the approval — neither a hosted
 * `ApprovalPoller` (requires `ingest.url`) nor a local `approvalHandler`
 * callback is configured.
 *
 * Adapter authors get this error when the caller hits a `require-approval`
 * verdict in pure offline mode. The fix is one of:
 *
 *   - Configure `ingest.url` + `ingest.apiKey` to use the hosted approval
 *     queue (team pathway), or
 *   - Configure `approvalHandler` to handle approvals in-process (OSS
 *     pathway — useful for solo devs, CLI agents, single-team servers).
 *
 * Added in `@krynix/sdk@0.1.0-alpha.2`. Prior to alpha.2 the adapter
 * had to throw its own opaque error message.
 */
export class ApprovalUnavailable extends KrynixSdkError {
  readonly ruleId: string;

  constructor(message: string, ruleId: string) {
    super(message);
    this.name = "ApprovalUnavailable";
    this.ruleId = ruleId;
  }
}

/**
 * Thrown when an approval request is explicitly denied by a human via
 * the Krynix approval-review UI.
 */
export class ApprovalDenied extends KrynixSdkError {
  readonly ruleId: string;
  readonly approvalId: string;
  readonly resolvedBy?: string;
  readonly notes?: string;

  constructor(
    message: string,
    ruleId: string,
    approvalId: string,
    resolvedBy?: string,
    notes?: string,
  ) {
    super(message);
    this.name = "ApprovalDenied";
    this.ruleId = ruleId;
    this.approvalId = approvalId;
    this.resolvedBy = resolvedBy;
    this.notes = notes;
  }
}
