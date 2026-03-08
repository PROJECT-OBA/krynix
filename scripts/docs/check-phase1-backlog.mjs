import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();

const requiredFiles = [
  "docs/10_architecture/phase1_implementation_contract.md",
  "docs/10_architecture/policy_baseline_phase1.md",
  "docs/20_development/runbook_ide_sidecar.md",
  "docs/20_development/runbook_runtime_adapter.md",
  "docs/20_development/runbook_ci_gate_template.md",
  "docs/20_development/phase1_backlog.md",
  "docs/20_development/phase1_milestones.md",
  "docs/20_development/weekly_checkpoints.md",
];

const errors = [];
for (const rel of requiredFiles) {
  if (!existsSync(resolve(repoRoot, rel))) {
    errors.push(`Missing required file: ${rel}`);
  }
}

const backlogPath = resolve(repoRoot, "docs/20_development/phase1_backlog.md");
const milestonesPath = resolve(repoRoot, "docs/20_development/phase1_milestones.md");
const checkpointsPath = resolve(repoRoot, "docs/20_development/weekly_checkpoints.md");

if (existsSync(backlogPath)) {
  const backlog = readFileSync(backlogPath, "utf8");

  const requiredEpics = [
    "## Epic E1: Sidecar Core",
    "## Epic E2: Command Shim Layer",
    "## Epic E3: IDE Sidecar Integration",
    "## Epic E4: CI Trust Gates + Governance",
    "## Epic E5: Runtime Adapter Expansion",
  ];

  for (const epic of requiredEpics) {
    if (!backlog.includes(epic)) {
      errors.push(`Backlog missing required section: ${epic}`);
    }
  }

  const taskIdMatches = backlog.match(/PH1-E\d+-M\d+\.\d+-T\d+\.\d+/g) ?? [];
  if (taskIdMatches.length < 20) {
    errors.push("Backlog appears incomplete: expected at least 20 Phase 1 task IDs");
  }

  if (!backlog.includes("| Task ID | Task | Acceptance Criteria | Issue | Status |")) {
    errors.push("Backlog table must include Acceptance Criteria and Issue columns");
  }

  if (!backlog.includes("## GitHub Issue Mirroring Rules")) {
    errors.push("Backlog missing GitHub issue mirroring rules section");
  }
}

if (existsSync(milestonesPath)) {
  const milestones = readFileSync(milestonesPath, "utf8");
  if (!milestones.includes("| Milestone | Title | Target Outcome | Depends On |")) {
    errors.push("Milestones file missing required milestone dependency table");
  }
}

if (existsSync(checkpointsPath)) {
  const checkpoints = readFileSync(checkpointsPath, "utf8");
  if (!checkpoints.includes("## Week 0")) {
    errors.push("Weekly checkpoints file missing Week 0 baseline entry");
  }
}

if (errors.length > 0) {
  console.error("Phase 1 backlog docs check failed:");
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log("Phase 1 backlog docs check passed.");
