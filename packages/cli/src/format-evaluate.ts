/**
 * Human-readable text formatter for evaluate command output.
 *
 * @module
 */

import type { AggregateOutput } from "./evaluate.js";

/**
 * Format evaluation output as human-readable text.
 *
 * @param output - Aggregate evaluation output
 * @returns Multi-line text string
 */
export function formatEvaluateText(output: AggregateOutput): string {
  const lines: string[] = [];

  for (const { policyName, result } of output.policyResults) {
    const verdictUpper = result.verdict.toUpperCase();
    lines.push(`Policy: ${policyName}`);
    lines.push(`Verdict: ${verdictUpper} (exit code ${String(result.exitCode)})`);

    if (result.violations.length > 0) {
      lines.push("");
      lines.push(`Violations (${String(result.violations.length)}):`);

      for (const v of result.violations) {
        const idx = String(v.eventIndex).padStart(4, " ");
        lines.push(`  ${idx}  [${v.severity}]  ${v.ruleId}: ${v.message}`);
      }
    }

    if (result.warnings.length > 0) {
      lines.push("");
      lines.push("Warnings:");
      for (const w of result.warnings) {
        const prefix = w.ruleId !== undefined ? `${w.code} (${w.ruleId})` : w.code;
        lines.push(`  - [${prefix}] ${w.message}`);
      }
    }

    lines.push("");
  }

  // Summary line
  const totalViolations = output.policyResults.reduce(
    (sum, r) => sum + r.result.violations.length,
    0,
  );
  const verdictUpper = output.verdict.toUpperCase();
  lines.push(
    `Result: ${verdictUpper} — ${String(output.policyResults.length)} ${output.policyResults.length === 1 ? "policy" : "policies"}, ${String(totalViolations)} ${totalViolations === 1 ? "violation" : "violations"}`,
  );

  return lines.join("\n");
}
