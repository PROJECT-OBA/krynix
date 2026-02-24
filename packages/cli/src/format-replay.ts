/**
 * Pure formatter for replay command output.
 *
 * Converts `ReplayResult` objects into human-readable lines for `--verbose` mode.
 * All functions are side-effect-free; the caller decides where to write the output.
 *
 * @module
 */

import type { ReplayResult, DivergenceReport, FieldDiff } from "@krynix/replay";

/**
 * Format a list of replay results into human-readable verbose lines.
 *
 * @returns Array of strings (one per line). Empty array if results is empty.
 */
export function formatReplayResults(results: ReplayResult[]): string[] {
  if (results.length === 0) {
    return ["No trace files found."];
  }

  const lines: string[] = [];

  for (const result of results) {
    lines.push(...formatSingleResult(result));
  }

  return lines;
}

function formatSingleResult(result: ReplayResult): string[] {
  const lines: string[] = [];

  switch (result.status) {
    case "pass":
      lines.push(formatPassResult(result));
      break;
    case "diverged":
      lines.push(...formatDivergedResult(result));
      break;
    case "error":
      lines.push(...formatErrorResult(result));
      break;
  }

  return lines;
}

function formatPassResult(result: ReplayResult): string {
  const eventCount = result.report?.totalEvents ?? 0;
  return `[PASS] ${result.file} — ${String(eventCount)} events, hash chain valid`;
}

function formatDivergedResult(result: ReplayResult): string[] {
  const lines: string[] = [];
  const report = result.report as DivergenceReport | undefined;

  if (report?.firstDivergence) {
    const div = report.firstDivergence;
    lines.push(`[DIVERGED] ${result.file} — diverged at event ${String(div.sequenceNum)}`);
    lines.push(`  expected: ${div.expected.eventType}`);
    lines.push(`  actual:   ${div.actual.eventType}`);

    if (div.diffs.length > 0) {
      lines.push("  diffs:");
      for (const diff of div.diffs) {
        lines.push(formatFieldDiff(diff));
      }
    }
  } else {
    lines.push(`[DIVERGED] ${result.file}`);
  }

  return lines;
}

function formatErrorResult(result: ReplayResult): string[] {
  const lines: string[] = [`[ERROR] ${result.file}`];

  if (result.validationErrors) {
    for (const err of result.validationErrors) {
      lines.push(`  ${err}`);
    }
  }

  return lines;
}

function formatFieldDiff(diff: FieldDiff): string {
  const expected = truncate(JSON.stringify(diff.expected), 200);
  const actual = truncate(JSON.stringify(diff.actual), 200);
  return `    ${diff.field}: expected ${expected}, got ${actual}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 3) + "...";
}
