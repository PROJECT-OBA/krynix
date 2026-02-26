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

export { TraceWriter } from "./trace-writer.js";

export { validateTraceEvent, validatePolicy, validateReport } from "./schema-validator.js";

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
