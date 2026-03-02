import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const canonicalFiles = [
  "docs/10_architecture/platform_architecture_spec.md",
  "docs/10_architecture/architecture.md",
  "docs/10_architecture/determinism_spec.md",
  "docs/10_architecture/policy_spec.md",
];

const requiredHeaders = [
  "## Purpose",
  "## Where Used",
  "## Guarantees (Current)",
  "## Planned Guarantees (Future)",
  "## Non-Goals",
  "## Interfaces / Contracts",
  "## Operational Usage",
  "## Known Gaps And Roadmap",
];

const errors = [];
for (const rel of canonicalFiles) {
  const text = readFileSync(resolve(repoRoot, rel), "utf8");
  const lines = text.split(/\r?\n/);

  for (const header of requiredHeaders) {
    if (!text.includes(header)) {
      errors.push(`${rel}: missing required section '${header}'`);
    }
  }

  if (!text.includes("CURRENT")) {
    errors.push(`${rel}: missing CURRENT tag`);
  }
  if (!text.includes("PARTIAL")) {
    errors.push(`${rel}: missing PARTIAL tag`);
  }
  if (!text.includes("PLANNED")) {
    errors.push(`${rel}: missing PLANNED tag`);
  }

  // Enforce evidence references for every canonical CURRENT claim.
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes("[CURRENT]")) {
      continue;
    }

    const hasInlineEvidence = lines[i].includes("Evidence:");
    const next = lines[i + 1] ?? "";
    const hasNextLineEvidence = next.trimStart().startsWith("Evidence:");

    if (!hasInlineEvidence && !hasNextLineEvidence) {
      errors.push(
        `${rel}:${i + 1} CURRENT claim is missing required Evidence: reference on the same or next line`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Claim-status tag check failed:");
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log("Claim-status tag check passed.");
