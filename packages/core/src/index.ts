// @krynix/core — public API
// This is the single entry point for the core package.
// All public exports must go through this file.

export {
  // Constants
  SCHEMA_VERSION,
  // String union types
  type EventType,
  type ApprovalStatus,
  type FinishReason,
  type LifecycleAction,
  // Payload interfaces
  type ToolCallPayload,
  type ToolResultPayload,
  type LlmRequestPayload,
  type LlmResponsePayload,
  type LlmUsage,
  type DecisionPayload,
  type ObservationPayload,
  type ErrorPayload,
  type LifecyclePayload,
  // Payload map
  type PayloadMap,
  // TraceEvent types
  type TraceEventBase,
  type TraceEvent,
  // Shared result types
  type ValidationResult,
} from "./types.js";

export { KrynixError } from "./errors.js";

export { canonicalize } from "./canonical-json.js";

export { redact, redactWithPatterns, type RedactionPattern } from "./redaction.js";

export { readTrace } from "./trace-reader.js";

export { computeHashChain, validateHashChain } from "./hash-chain.js";

export {
  generateSigningKeypair,
  signHashChain,
  verifyHashChainSignature,
  type SigningKeypair,
} from "./signing.js";

export { TraceWriter, type TraceWriterOptions } from "./trace-writer.js";

export {
  validateTraceEvent,
  validatePolicy,
  validateReport,
  traceEventSchema,
  policySchema,
  reportSchema,
} from "./schema-validator.js";

export { SeededRandom } from "./seeded-random.js";

export { type TraceAdapter, type AdapterConfig } from "./adapter-types.js";

export {
  startSession,
  recordEvent,
  endSession,
  destroySession,
  getActiveSessions,
  type SessionConfig,
  type Session,
  type PartialTraceEvent,
} from "./session.js";

export { computeTraceStats, type TraceStats } from "./trace-stats.js";

export {
  convertToOtlp,
  type OtlpExportData,
  type OtlpSpan,
  type OtlpAttribute,
  type OtlpAttributeValue,
  type OtlpStatus,
  type OtlpScope,
} from "./otlp-export.js";

export { StreamingHashValidator } from "./streaming-validator.js";

export {
  generateComplianceBundle,
  writeComplianceBundleToDir,
  type ComplianceBundleOptions,
  type TraceInput,
  type BundleArtifact,
  type BundleManifest,
  type ComplianceBundle,
} from "./compliance-bundle.js";

export { filterTraceEvents, matchFieldGlob, type TraceFilterCriteria } from "./trace-filter.js";

export {
  runEvaluationPipeline,
  evaluateTrace,
  type EvaluationPipelineOptions,
  type EvaluationPipelineResult,
  type EvaluationPipelineDeps,
  type PipelineEvalResult,
  type PipelineReplayResult,
  type PipelinePolicyResult,
} from "./evaluation-pipeline.js";

export {
  detectEnvironment,
  mergeEnvironmentContext,
  type EnvironmentContext,
} from "./environment.js";

export {
  verifyComplianceBundle,
  type BundleVerificationResult,
  type BundleVerificationError,
} from "./bundle-verifier.js";

export { validatePayload } from "./payload-validator.js";
