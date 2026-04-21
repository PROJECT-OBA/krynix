// @krynix/cli — public API
// This is the single entry point for the cli package.
// All public exports must go through this file.

export {
  runEvaluate,
  type EvaluateResult,
  type AggregateOutput,
  type OutputFormat,
} from "./evaluate.js";
export { formatEvaluateText } from "./format-evaluate.js";
export { runReplay, type ReplayCommandResult, type CompareCommandResult } from "./replay.js";
export { runValidate, type ValidateResult, type PolicyFileResult } from "./validate.js";
export { runStats, type StatsResult } from "./stats.js";
export { runPolicyTest, type PolicyTestResult } from "./policy-test.js";
export { runExport, type ExportResult } from "./export.js";
export { runPolicyDiff, type PolicyDiffResult } from "./policy-diff.js";
export { runComplianceExport, type ComplianceExportResult } from "./compliance.js";
export {
  runComplianceVerify,
  type ComplianceVerifyResult,
  type ComplianceVerifyDeps,
} from "./compliance-verify.js";
export { loadConfig, parseConfigYaml, type ControlPlaneConfig } from "./config.js";
export {
  loadCredentials,
  saveCredentials,
  clearCredentials,
  isTokenExpired,
  type Credentials,
} from "./credentials.js";
export {
  runAuthStatus,
  runAuthLogout,
  runAuthLogin,
  runAuthCreateKey,
  type AuthResult,
  type AuthStatusOutput,
  type AuthLogoutOutput,
  type AuthLoginOutput,
  type AuthCreateKeyOutput,
  type AuthDeps,
  type AuthLoginDeps,
  type AuthCreateKeyDeps,
} from "./auth.js";
export {
  createControlPlaneClient,
  type ControlPlaneClient,
  type ApiResponse,
  type GoldenTraceMetadata,
  type GoldenTraceFilters,
  type GoldenTraceEntry,
} from "./http-client.js";
export { runPush, type PushResult, type PushOutput, type PushArtifactResult } from "./push.js";
export { runPolicyPull, type PolicyPullResult, type PolicyPullOutput } from "./policy-pull.js";
export { runPolicyPush, type PolicyPushResult, type PolicyPushOutput } from "./policy-push.js";
export {
  runGoldenPromote,
  runGoldenList,
  runGoldenPull,
  type GoldenResult,
  type GoldenDeps,
} from "./golden.js";
export { runDiff, type DiffResult } from "./diff.js";
export { runSign, type SignResult, runKeygen, type KeygenResult } from "./sign.js";
export { parseEnvFlags, buildEnvironmentContext } from "./env-flags.js";
