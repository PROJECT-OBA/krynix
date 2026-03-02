import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const glossaryPath = resolve(repoRoot, "docs/00_overview/glossary_platform.md");

if (!existsSync(glossaryPath)) {
  console.error("Missing glossary file: docs/00_overview/glossary_platform.md");
  process.exit(1);
}

const glossary = readFileSync(glossaryPath, "utf8");
const requiredTerms = [
  "## Input Layer",
  "## Runtime Layer",
  "## Output Layer",
  "## Guard",
  "## Decision",
  "## Provenance",
  "## Drift",
  "## Replay Mode",
];

const missingTerms = requiredTerms.filter((term) => !glossary.includes(term));
if (missingTerms.length > 0) {
  console.error("Missing required glossary terms:");
  for (const t of missingTerms) console.error(`- ${t}`);
  process.exit(1);
}

const canonicalFiles = [
  "README.md",
  "docs/10_architecture/platform_architecture_spec.md",
  "docs/10_architecture/architecture.md",
  "docs/10_architecture/determinism_spec.md",
  "docs/10_architecture/policy_spec.md",
];

const violations = [];
for (const rel of canonicalFiles) {
  const file = resolve(repoRoot, rel);
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (const [idx, line] of lines.entries()) {
    const lowered = line.toLowerCase();
    if (
      lowered.includes("deterministic re-execution") &&
      !line.includes("PLANNED") &&
      !lowered.includes("does not claim")
    ) {
      violations.push(`${rel}:${idx + 1} contains execution-replay claim without PLANNED tag`);
    }
  }
}

if (violations.length > 0) {
  console.error("Terminology consistency violations:");
  for (const v of violations) console.error(`- ${v}`);
  process.exit(1);
}

console.log("Terminology check passed.");
