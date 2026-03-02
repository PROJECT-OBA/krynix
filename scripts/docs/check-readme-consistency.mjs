import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const readme = readFileSync(resolve(repoRoot, "README.md"), "utf8");
const canonical = readFileSync(
  resolve(repoRoot, "docs/10_architecture/platform_architecture_spec.md"),
  "utf8",
);

const markers = [
  "REPLAY_CURRENT_MODE=integrity_plus_baseline_diff",
  "KRYNIX_ROLE=trust_spine_not_full_platform",
  "KRYNIX_RUNTIME_ENFORCEMENT=external_runtime_controls_ci_postrun_in_oss",
];

const errors = [];
if (!readme.includes("docs/10_architecture/platform_architecture_spec.md")) {
  errors.push("README must link to canonical spec");
}

for (const marker of markers) {
  if (!readme.includes(marker)) {
    errors.push(`README missing marker: ${marker}`);
  }
  if (!canonical.includes(marker)) {
    errors.push(`Canonical spec missing marker: ${marker}`);
  }
}

if (errors.length > 0) {
  console.error("README/canonical consistency check failed:");
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}

console.log("README/canonical consistency check passed.");
