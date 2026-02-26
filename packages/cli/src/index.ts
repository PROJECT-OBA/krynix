// @krynix/cli — public API
// This is the single entry point for the cli package.
// All public exports must go through this file.

export { runEvaluate, type EvaluateResult, type AggregateOutput } from "./evaluate.js";
export { runReplay, type ReplayCommandResult } from "./replay.js";
export { runValidate, type ValidateResult, type PolicyFileResult } from "./validate.js";
export { runStats, type StatsResult } from "./stats.js";
export { runPolicyTest, type PolicyTestResult } from "./policy-test.js";
export { runExport, type ExportResult } from "./export.js";
export { runPolicyDiff, type PolicyDiffResult } from "./policy-diff.js";
