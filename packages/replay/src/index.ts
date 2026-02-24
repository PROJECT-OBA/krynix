// @krynix/replay — public API
// This is the single entry point for the replay package.
// All public exports must go through this file.

export { validateGoldenTraces, type GoldenValidationResult } from "./golden-validator.js";
export { extractEnvelope } from "./envelope.js";
export { compareTraces } from "./comparator.js";
export {
  verifyTrace,
  verifyGoldenDir,
  regenerateTrace,
  regenerateGoldenDir,
} from "./replay-runner.js";

export {
  type DeterminismEnvelope,
  type FieldDiff,
  type DivergencePoint,
  type DivergenceReport,
  type ReplayResult,
  type ReplayOptions,
} from "./types.js";
