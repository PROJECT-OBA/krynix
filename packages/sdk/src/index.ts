// @krynix/sdk — public API
// This is the single entry point for the SDK package.
// All public exports must go through this file.

export { Krynix, NoAdapterError, type KrynixContext, type KrynixAdapter } from "./krynix.js";

export type {
  ApprovalConfig,
  ApprovalMode,
  IngestConfig,
  KrynixOptions,
  RedactionConfig,
  RedactionMode,
} from "./types.js";

export {
  ApprovalDenied,
  ApprovalTimeout,
  ApprovalUnavailable,
  KrynixSdkError,
  PolicyDenied,
} from "./errors.js";

export {
  cliPromptApprovalHandler,
  denyAllApprovalHandler,
  resolveApproval,
  webhookApprovalHandler,
  type ApprovalDecision,
  type ApprovalHandler,
  type ApprovalHandlerEvent,
  type ResolvedApproval,
} from "./approval-handler.js";

// Pipeline + collaborators are exported for advanced adapter authors
// who want to compose them differently (e.g. a third-party adapter
// for Cohere or Mistral). The shipped OpenAI / Anthropic / LangChain
// adapters use these too.

export { runPipeline, type PipelineOutcome, type PipelineWarning } from "./verdict-pipeline.js";

export { applyRedactions, type AppliedRedactions } from "./redact.js";

export {
  IngestClient,
  type IngestClientOptions,
  type ApprovalSubmitResult,
  type ApprovalStatusResult,
} from "./ingest-client.js";

export { EventBuffer, type EventBufferOptions } from "./event-buffer.js";

export {
  ApprovalPoller,
  type ApprovalOutcome,
  type ApprovalPollerOptions,
} from "./approval-poller.js";
