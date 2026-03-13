#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const BACKLOG_PATH = resolve(REPO_ROOT, "docs/20_development/phase1_backlog.md");
const MILESTONES_PATH = resolve(REPO_ROOT, "docs/20_development/phase1_milestones.md");
const CHECKPOINTS_PATH = resolve(REPO_ROOT, "docs/20_development/weekly_checkpoints.md");

const STATUS_VALUES = ["todo", "in_progress", "blocked", "done"];
const STATUS_LABELS = STATUS_VALUES.map((status) => `status:${status}`);

const LABEL_SPECS = [
  { name: "type:epic", color: "5319e7", description: "Epic-level planning issue" },
  { name: "type:task", color: "0e8a16", description: "Task-level execution issue" },
  { name: "status:todo", color: "d4c5f9", description: "Not started" },
  { name: "status:in_progress", color: "fbca04", description: "Work in progress" },
  { name: "status:blocked", color: "b60205", description: "Blocked by dependency or risk" },
  { name: "status:done", color: "0e8a16", description: "Completed" },
  { name: "agent:ready", color: "0052cc", description: "Eligible for agent delegation" },
  { name: "agent:in-progress", color: "fbca04", description: "Agent run in progress" },
  { name: "agent:failed", color: "d93f0b", description: "Agent run failed" },
  { name: "agent:done", color: "0e8a16", description: "Agent run completed" },
];

const EPIC_LABEL_COLORS = ["0052cc", "1d76db", "5319e7", "0366d6", "0e8a16"];
const MILESTONE_LABEL_COLOR = "bfd4f2";

function usage() {
  console.log(`Usage:
  node scripts/planning/orchestrator.mjs sync [--apply|--dry-run]
  node scripts/planning/orchestrator.mjs audit
  node scripts/planning/orchestrator.mjs delegate [--apply|--dry-run] [--max-parallel N] [--include-in-progress]
  node scripts/planning/orchestrator.mjs checkpoint [--apply|--dry-run]

Flags:
  --apply               Apply mutations (default is dry-run behavior)
  --dry-run             Explicit dry-run mode
  --max-parallel <N>    Maximum delegated issues per run (delegate command)
  --include-in-progress Also consider status:in_progress tasks for delegation retries
`);
}

function parseArgs(argv) {
  const args = { apply: false, dryRun: true, maxParallel: 2, includeInProgress: false };
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i];
    if (part === "--apply") {
      args.apply = true;
      args.dryRun = false;
      continue;
    }
    if (part === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
      continue;
    }
    if (part === "--include-in-progress") {
      args.includeInProgress = true;
      continue;
    }
    if (part === "--max-parallel") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error("--max-parallel must be a positive integer");
      }
      args.maxParallel = value;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${part}`);
  }
  return args;
}

function run(cmd, cmdArgs, opts = {}) {
  const { allowFailure = false, env = {} } = opts;
  try {
    return execFileSync(cmd, cmdArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    const stderr = error.stderr?.toString()?.trim() ?? "";
    const stdout = error.stdout?.toString()?.trim() ?? "";
    const detail = [stderr, stdout].filter(Boolean).join("\n");
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
}

function runGhJson(args, opts = {}) {
  const output = run("gh", args, opts);
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`Failed to parse JSON from gh ${args.join(" ")}: ${String(error)}`);
  }
}

function ensureRequiredFiles() {
  for (const file of [BACKLOG_PATH, MILESTONES_PATH, CHECKPOINTS_PATH]) {
    if (!existsSync(file)) {
      throw new Error(`Required file not found: ${file}`);
    }
  }
}

function ensureGh() {
  run("gh", ["--version"]);
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) {
    // In GitHub Actions, GITHUB_TOKEN often cannot access the global /user endpoint.
    // Validate auth against the current repository instead of the account profile.
    run("gh", ["repo", "view", "--json", "nameWithOwner"]);
    return;
  }
  run("gh", ["auth", "status"], { allowFailure: false });
}

function parseMilestoneIndex(content) {
  const lines = content.split(/\r?\n/);
  const milestones = new Map();
  for (const line of lines) {
    if (!line.startsWith("| M")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const milestoneId = cells[0];
    const title = cells[1];
    if (!/^M\d+\.\d+$/.test(milestoneId)) continue;
    milestones.set(milestoneId, title);
  }
  return milestones;
}

function parseIssueCell(cell) {
  const match = cell.match(/#(\d+)/);
  if (!match) return null;
  return Number(match[1]);
}

function normalizeStatus(value) {
  if (!value) return "todo";
  const trimmed = value.trim();
  if (STATUS_VALUES.includes(trimmed)) return trimmed;
  return "todo";
}

function parseBacklog(content) {
  const lines = content.split(/\r?\n/);
  const tasks = [];

  let currentEpic = null;
  let currentMilestone = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const epicMatch = line.match(/^## Epic (E\d+):\s+(.+)$/);
    if (epicMatch) {
      currentEpic = {
        id: epicMatch[1],
        title: epicMatch[2].replace(/\s*\(`[^`]+`\)\s*$/, "").trim(),
      };
      continue;
    }

    const milestoneMatch = line.match(/^### Milestone (M\d+\.\d+):\s+(.+)$/);
    if (milestoneMatch) {
      currentMilestone = {
        id: milestoneMatch[1],
        title: milestoneMatch[2].trim(),
      };
      continue;
    }

    if (!line.startsWith("| PH1-")) continue;
    if (!currentEpic || !currentMilestone) {
      throw new Error(`Task row found outside epic/milestone context at line ${index + 1}`);
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 5) {
      throw new Error(`Malformed task row at line ${index + 1}`);
    }

    const [taskId, task, acceptanceCriteria, issueCell, statusCell] = cells;
    if (!/^PH1-E\d+-M\d+\.\d+-T\d+\.\d+$/.test(taskId)) {
      throw new Error(`Invalid task ID format at line ${index + 1}: ${taskId}`);
    }

    tasks.push({
      lineIndex: index,
      taskId,
      task,
      acceptanceCriteria,
      issueCell,
      issueNumber: parseIssueCell(issueCell),
      status: normalizeStatus(statusCell),
      epic: currentEpic,
      milestone: currentMilestone,
    });
  }

  return { lines, tasks };
}

function buildTaskIssueBody(task) {
  return [
    "## Context",
    `Canonical Phase 1 task imported from docs backlog (${task.taskId}).`,
    `- Epic: ${task.epic.id} - ${task.epic.title}`,
    `- Milestone: ${task.milestone.id} - ${task.milestone.title}`,
    "- Backlog source: docs/20_development/phase1_backlog.md",
    "",
    "## Scope",
    `- ${task.task}`,
    "",
    "## Allowed Files",
    "- TBD (maintainer must refine before agent delegation)",
    "",
    "## Acceptance Criteria",
    `- ${task.acceptanceCriteria}`,
    "",
    "## Required Tests",
    "- Define required tests before implementation begins.",
    "",
    "## Out of Scope",
    "- Changes outside this task's acceptance criteria.",
    "",
    "Depends On: none",
  ].join("\n");
}

function buildEpicIssueBody(epic) {
  return [
    "## Context",
    `Epic ${epic.id} generated from canonical Phase 1 backlog.`,
    "- Source: docs/20_development/phase1_backlog.md",
    "",
    "## Scope",
    `- Coordinate milestone and task execution for ${epic.title}.`,
    "",
    "## Acceptance Criteria",
    "- All linked task issues are completed and reviewed.",
    "",
    "## Out of Scope",
    "- Implementing child tasks directly in this epic issue.",
  ].join("\n");
}

function parseRepo() {
  const repo = runGhJson(["repo", "view", "--json", "nameWithOwner"]);
  if (!repo?.nameWithOwner) {
    throw new Error("Unable to resolve repository name via gh repo view");
  }
  return repo.nameWithOwner;
}

function listLabels() {
  return runGhJson(["label", "list", "--limit", "500", "--json", "name,color,description"]) ?? [];
}

function listIssues() {
  return (
    runGhJson([
      "issue",
      "list",
      "--state",
      "all",
      "--limit",
      "500",
      "--json",
      "number,title,body,state,url,labels,milestone",
    ]) ?? []
  );
}

function listOpenPrs() {
  return runGhJson(["pr", "list", "--state", "open", "--limit", "500", "--json", "number,title,body"]) ?? [];
}

function listMilestones(repoNameWithOwner) {
  return (
    runGhJson([
      "api",
      `repos/${repoNameWithOwner}/milestones?state=all&per_page=100`,
      "-H",
      "Accept: application/vnd.github+json",
    ]) ?? []
  );
}

function ensureLabel(spec, existing, changes, apply) {
  const found = existing.find((label) => label.name === spec.name);
  if (!found) {
    changes.push(`label:create ${spec.name}`);
    if (apply) {
      run("gh", ["label", "create", spec.name, "--color", spec.color, "--description", spec.description]);
      existing.push({ ...spec });
    }
    return;
  }

  if (found.color !== spec.color || (found.description ?? "") !== spec.description) {
    changes.push(`label:update ${spec.name}`);
    if (apply) {
      run("gh", [
        "label",
        "edit",
        spec.name,
        "--color",
        spec.color,
        "--description",
        spec.description,
      ]);
      found.color = spec.color;
      found.description = spec.description;
    }
  }
}

function ensureMilestone(repo, milestoneTitle, existing, changes, apply) {
  let found = existing.find((milestone) => milestone.title === milestoneTitle);
  if (found) return found;

  changes.push(`milestone:create ${milestoneTitle}`);
  if (apply) {
    run("gh", [
      "api",
      "--method",
      "POST",
      `repos/${repo}/milestones`,
      "-f",
      `title=${milestoneTitle}`,
      "-H",
      "Accept: application/vnd.github+json",
    ]);
    found = listMilestones(repo).find((milestone) => milestone.title === milestoneTitle);
  }
  return found;
}

function issueStatusFromLabels(issue) {
  if (!issue) return "todo";
  if (issue.state === "CLOSED" || issue.state === "closed") return "done";

  const labelNames = new Set((issue.labels ?? []).map((label) => label.name));
  for (const status of ["blocked", "in_progress", "todo", "done"]) {
    if (labelNames.has(`status:${status}`)) {
      return status;
    }
  }
  return "todo";
}

function extractTaskIdFromIssueTitle(title) {
  const match = title.match(/^\[(PH1-E\d+-M\d+\.\d+-T\d+\.\d+|TASK-[0-9]+[a-z]*)\]\s+/i);
  if (!match) return null;
  return match[1].toUpperCase();
}

function ensureIssueLabels(issue, desiredLabels, mutableGroups, changes, apply) {
  const existing = new Set((issue.labels ?? []).map((label) => label.name));
  const desired = new Set(desiredLabels);

  const toAdd = [...desired].filter((name) => !existing.has(name));

  const toRemove = [];
  for (const label of existing) {
    if (desired.has(label)) continue;
    if (mutableGroups.some((group) => group.has(label))) {
      toRemove.push(label);
    }
  }

  if (toAdd.length === 0 && toRemove.length === 0) {
    return;
  }

  changes.push(`issue:${issue.number}:labels +${toAdd.join(",") || "none"} -${toRemove.join(",") || "none"}`);
  if (!apply) return;

  const cmd = ["issue", "edit", String(issue.number)];
  for (const label of toAdd) {
    cmd.push("--add-label", label);
  }
  for (const label of toRemove) {
    cmd.push("--remove-label", label);
  }
  run("gh", cmd);
}

function ensureIssueMilestone(issue, milestoneTitle, changes, apply) {
  const current = issue.milestone?.title ?? "";
  if (current === milestoneTitle) return;

  changes.push(`issue:${issue.number}:milestone ${current || "<none>"} -> ${milestoneTitle}`);
  if (!apply) return;

  run("gh", ["issue", "edit", String(issue.number), "--milestone", milestoneTitle]);
}

function ensureTaskBodySections(issue, task, changes, apply) {
  const requiredSections = [
    "## Context",
    "## Scope",
    "## Allowed Files",
    "## Acceptance Criteria",
    "## Required Tests",
    "## Out of Scope",
  ];

  const body = (issue.body ?? "").trim();
  const missing = requiredSections.filter((section) => !body.includes(section));
  const missingDependsOn = !/Depends On:/i.test(body);

  if (missing.length === 0 && !missingDependsOn) {
    return;
  }

  changes.push(`issue:${issue.number}:body sections missing (${[...missing, ...(missingDependsOn ? ["Depends On"] : [])].join(", ")})`);
  if (!apply) return;

  const template = buildTaskIssueBody(task);
  const nextBody = body.length > 0 ? `${body}\n\n---\n\n${template}` : template;
  run("gh", ["issue", "edit", String(issue.number), "--body", nextBody]);
}

function updateBacklogLines(parsed, syncByTaskId) {
  const nextLines = [...parsed.lines];

  for (const task of parsed.tasks) {
    const sync = syncByTaskId.get(task.taskId);
    if (!sync) continue;

    const issueCell = sync.issueNumber ? `#${sync.issueNumber}` : task.issueCell;
    const statusCell = sync.status ?? task.status;

    const cells = [task.taskId, task.task, task.acceptanceCriteria, issueCell, statusCell];
    nextLines[task.lineIndex] = `| ${cells.join(" | ")} |`;
  }

  return nextLines.join("\n");
}

function summarizeDrift(drift) {
  if (drift.length === 0) {
    console.log("No drift detected.");
    return;
  }

  console.log("Drift detected:");
  for (const item of drift) {
    console.log(`- ${item}`);
  }
}

function syncCommand(options) {
  ensureRequiredFiles();
  ensureGh();

  const backlogContent = readFileSync(BACKLOG_PATH, "utf8");
  const milestonesContent = readFileSync(MILESTONES_PATH, "utf8");

  const parsed = parseBacklog(backlogContent);
  const milestoneIndex = parseMilestoneIndex(milestonesContent);

  const repo = parseRepo();
  const drift = [];

  const labels = listLabels();

  const epicIds = [...new Set(parsed.tasks.map((task) => task.epic.id))].sort();
  const milestoneIds = [...new Set(parsed.tasks.map((task) => task.milestone.id))].sort();

  for (const spec of LABEL_SPECS) {
    ensureLabel(spec, labels, drift, options.apply);
  }

  epicIds.forEach((epicId, index) => {
    ensureLabel(
      {
        name: `epic:${epicId}`,
        color: EPIC_LABEL_COLORS[index % EPIC_LABEL_COLORS.length],
        description: `Tasks under ${epicId}`,
      },
      labels,
      drift,
      options.apply,
    );
  });

  milestoneIds.forEach((milestoneId) => {
    ensureLabel(
      {
        name: `milestone:${milestoneId}`,
        color: MILESTONE_LABEL_COLOR,
        description: `Tasks mapped to ${milestoneId}`,
      },
      labels,
      drift,
      options.apply,
    );
  });

  let milestones = listMilestones(repo);
  const milestoneTitleById = new Map();
  for (const milestoneId of milestoneIds) {
    const title = `${milestoneId} ${milestoneIndex.get(milestoneId) ?? milestoneId}`;
    milestoneTitleById.set(milestoneId, title);
    const ensured = ensureMilestone(repo, title, milestones, drift, options.apply);
    if (!ensured && options.apply) {
      milestones = listMilestones(repo);
    }
  }

  let issues = listIssues();
  const issueByNumber = new Map(issues.map((issue) => [issue.number, issue]));
  const issueByTitle = new Map(issues.map((issue) => [issue.title, issue]));

  const epicById = new Map();
  for (const epicId of epicIds) {
    const representativeTask = parsed.tasks.find((task) => task.epic.id === epicId);
    const epicTitle = `[${epicId}] ${representativeTask.epic.title}`;
    let epicIssue = issues.find(
      (issue) => issue.title === epicTitle || ((issue.labels ?? []).some((label) => label.name === "type:epic") && (issue.labels ?? []).some((label) => label.name === `epic:${epicId}`)),
    );

    if (!epicIssue) {
      drift.push(`issue:create epic ${epicTitle}`);
      if (options.apply) {
        const url = run("gh", [
          "issue",
          "create",
          "--title",
          epicTitle,
          "--body",
          buildEpicIssueBody(representativeTask.epic),
          "--label",
          "type:epic",
          "--label",
          `epic:${epicId}`,
        ]);
        const numberMatch = url.match(/\/(\d+)$/);
        if (!numberMatch) {
          throw new Error(`Unable to parse issue number from URL: ${url}`);
        }
        const created = runGhJson(["issue", "view", numberMatch[1], "--json", "number,title,body,state,url,labels,milestone"]);
        if (!created) {
          throw new Error(`Failed to fetch created epic issue for ${epicTitle}`);
        }
        issues.push(created);
        issueByNumber.set(created.number, created);
        issueByTitle.set(created.title, created);
        epicIssue = created;
      }
    }

    if (epicIssue) {
      ensureIssueLabels(
        epicIssue,
        ["type:epic", `epic:${epicId}`],
        [new Set(["type:epic", "type:task"]), new Set(epicIds.map((id) => `epic:${id}`))],
        drift,
        options.apply,
      );
      epicById.set(epicId, epicIssue);
    }
  }

  issues = listIssues();
  const refreshedIssueByNumber = new Map(issues.map((issue) => [issue.number, issue]));

  const mutableGroups = [
    new Set(["type:epic", "type:task"]),
    new Set(STATUS_LABELS),
    new Set(epicIds.map((id) => `epic:${id}`)),
    new Set(milestoneIds.map((id) => `milestone:${id}`)),
  ];

  const syncByTaskId = new Map();

  for (const task of parsed.tasks) {
    const expectedTitle = `[${task.taskId}] ${task.task}`;
    let issue = null;

    if (task.issueNumber) {
      issue = refreshedIssueByNumber.get(task.issueNumber) ?? null;
      if (!issue) {
        drift.push(`task:${task.taskId} references missing issue #${task.issueNumber}`);
      }
    }

    if (!issue) {
      issue = issues.find((candidate) => candidate.title === expectedTitle) ?? null;
    }

    if (!issue) {
      issue = issues.find((candidate) => extractTaskIdFromIssueTitle(candidate.title) === task.taskId) ?? null;
    }

    if (!issue) {
      drift.push(`issue:create task ${task.taskId}`);
      if (options.apply) {
        const milestoneTitle = milestoneTitleById.get(task.milestone.id);
        const url = run("gh", [
          "issue",
          "create",
          "--title",
          expectedTitle,
          "--body",
          buildTaskIssueBody(task),
          "--label",
          "type:task",
          "--label",
          `status:${task.status}`,
          "--label",
          `epic:${task.epic.id}`,
          "--label",
          `milestone:${task.milestone.id}`,
          "--milestone",
          milestoneTitle,
        ]);
        const numberMatch = url.match(/\/(\d+)$/);
        if (!numberMatch) {
          throw new Error(`Unable to parse issue number from URL: ${url}`);
        }
        issue = runGhJson([
          "issue",
          "view",
          numberMatch[1],
          "--json",
          "number,title,body,state,url,labels,milestone",
        ]);
        if (!issue) {
          throw new Error(`Failed to fetch created task issue for ${task.taskId}`);
        }
        issues.push(issue);
      }
    }

    if (!issue) {
      syncByTaskId.set(task.taskId, { issueNumber: task.issueNumber, status: task.status });
      continue;
    }

    const ghStatus = issueStatusFromLabels(issue);
    const effectiveStatus = ghStatus || task.status;

    if (issue.title !== expectedTitle) {
      drift.push(`issue:${issue.number}:title ${JSON.stringify(issue.title)} -> ${JSON.stringify(expectedTitle)}`);
      if (options.apply) {
        run("gh", ["issue", "edit", String(issue.number), "--title", expectedTitle]);
      }
    }

    ensureIssueLabels(
      issue,
      ["type:task", `status:${effectiveStatus}`, `epic:${task.epic.id}`, `milestone:${task.milestone.id}`],
      mutableGroups,
      drift,
      options.apply,
    );

    const milestoneTitle = milestoneTitleById.get(task.milestone.id);
    ensureIssueMilestone(issue, milestoneTitle, drift, options.apply);

    ensureTaskBodySections(issue, task, drift, options.apply);

    if (task.issueNumber !== issue.number) {
      drift.push(`task:${task.taskId}:issue ${task.issueCell} -> #${issue.number}`);
    }
    if (task.status !== effectiveStatus) {
      drift.push(`task:${task.taskId}:status ${task.status} -> ${effectiveStatus}`);
    }

    syncByTaskId.set(task.taskId, { issueNumber: issue.number, status: effectiveStatus });
  }

  const updatedBacklog = updateBacklogLines(parsed, syncByTaskId);
  if (updatedBacklog !== backlogContent) {
    drift.push("backlog:update issue/status columns");
    if (options.apply) {
      writeFileSync(BACKLOG_PATH, updatedBacklog);
    }
  }

  summarizeDrift(drift);
  if (options.apply) {
    console.log("sync apply complete.");
  }

  return drift;
}

function dependenciesFromBody(body) {
  const text = body ?? "";
  const line = text.match(/^Depends On:\s*(.+)$/im);
  if (!line) return [];
  const value = line[1].trim();
  if (value.toLowerCase() === "none") return [];
  const ids = value.match(/PH1-E\d+-M\d+\.\d+-T\d+\.\d+|TASK-[0-9]+[a-z]*/gi) ?? [];
  return ids.map((id) => id.toUpperCase());
}

function containsIssueReference(text, issueNumber) {
  const pattern = new RegExp(
    `(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNumber}\\b|#${issueNumber}\\b`,
    "i",
  );
  return pattern.test(text ?? "");
}

function delegateCommand(options) {
  ensureRequiredFiles();
  ensureGh();

  const backlog = parseBacklog(readFileSync(BACKLOG_PATH, "utf8"));
  const issues = listIssues();
  const issueByTaskId = new Map();

  for (const issue of issues) {
    const taskId = extractTaskIdFromIssueTitle(issue.title);
    if (taskId) {
      issueByTaskId.set(taskId, issue);
    }
  }

  const openPrs = listOpenPrs();

  const allowedStatusLabels = new Set(["status:todo"]);
  if (options.includeInProgress) {
    allowedStatusLabels.add("status:in_progress");
  }

  const candidates = [];
  for (const task of backlog.tasks) {
    const issue = issueByTaskId.get(task.taskId);
    if (!issue) continue;

    const labels = new Set((issue.labels ?? []).map((label) => label.name));
    if (!labels.has("type:task")) continue;
    if (!labels.has("agent:ready")) continue;
    if (![...allowedStatusLabels].some((label) => labels.has(label))) continue;

    if (issue.state === "CLOSED" || issue.state === "closed") continue;

    const deps = dependenciesFromBody(issue.body);
    let blockedByDependency = false;
    for (const depId of deps) {
      const depIssue = issueByTaskId.get(depId);
      if (!depIssue) {
        blockedByDependency = true;
        break;
      }
      const depStatus = issueStatusFromLabels(depIssue);
      const depClosed = depIssue.state === "CLOSED" || depIssue.state === "closed";
      if (!depClosed && depStatus !== "done") {
        blockedByDependency = true;
        break;
      }
    }
    if (blockedByDependency) continue;

    const hasOpenPr = openPrs.some(
      (pr) => containsIssueReference(pr.body, issue.number) || containsIssueReference(pr.title, issue.number),
    );
    if (hasOpenPr) continue;

    candidates.push({ task, issue });
  }

  const selected = candidates.slice(0, options.maxParallel);

  if (selected.length === 0) {
    console.log("No eligible issues found for delegation.");
    return [];
  }

  const changes = [];
  for (const item of selected) {
    const issueNumber = item.issue.number;
    const taskId = item.task.taskId;
    changes.push(`delegate issue #${issueNumber} (${taskId})`);

    if (!options.apply) {
      continue;
    }

    run("gh", [
      "workflow",
      "run",
      "agent-task.yml",
      "-f",
      `issue_number=${issueNumber}`,
      "-f",
      `task_id=${taskId}`,
      "-f",
      "dry_run=false",
    ]);

    run("gh", [
      "issue",
      "edit",
      String(issueNumber),
      "--remove-label",
      "agent:ready",
      "--add-label",
      "agent:in-progress",
      "--remove-label",
      "status:todo",
      "--add-label",
      "status:in_progress",
    ]);
  }

  if (options.apply) {
    console.log(`Delegated ${selected.length} issue(s).`);
  } else {
    console.log(`Dry-run candidates (${selected.length}):`);
    for (const item of selected) {
      console.log(`- #${item.issue.number} ${item.task.taskId} ${item.task.task}`);
    }
  }

  return changes;
}

function classifyTask(issue) {
  if (!issue) return "todo";
  return issueStatusFromLabels(issue);
}

function nextWeekNumber(content) {
  const matches = [...content.matchAll(/^## Week (\d+)/gm)];
  if (matches.length === 0) return 0;
  const max = Math.max(...matches.map((match) => Number(match[1])));
  return max + 1;
}

function checkpointCommand(options) {
  ensureRequiredFiles();
  ensureGh();

  const backlog = parseBacklog(readFileSync(BACKLOG_PATH, "utf8"));
  const checkpoints = readFileSync(CHECKPOINTS_PATH, "utf8");
  const issues = listIssues();

  const issueByTaskId = new Map();
  for (const issue of issues) {
    const taskId = extractTaskIdFromIssueTitle(issue.title);
    if (taskId) issueByTaskId.set(taskId, issue);
  }

  const grouped = {
    done: [],
    in_progress: [],
    blocked: [],
    todo: [],
  };

  for (const task of backlog.tasks) {
    const issue = issueByTaskId.get(task.taskId);
    const status = classifyTask(issue);
    grouped[status].push(task.taskId);
  }

  const week = nextWeekNumber(checkpoints);
  const date = new Date().toISOString().slice(0, 10);

  const lines = [];
  lines.push(`## Week ${week} (${date})`);
  lines.push("- Completed tasks:");
  if (grouped.done.length === 0) lines.push("  - none");
  else grouped.done.forEach((taskId) => lines.push(`  - ${taskId}`));

  lines.push("- In progress:");
  if (grouped.in_progress.length === 0) lines.push("  - none");
  else grouped.in_progress.forEach((taskId) => lines.push(`  - ${taskId}`));

  lines.push("- Blockers:");
  if (grouped.blocked.length === 0) lines.push("  - none");
  else grouped.blocked.forEach((taskId) => lines.push(`  - ${taskId}`));

  lines.push("- Risk changes:");
  lines.push("  - none");
  lines.push("- Scope changes:");
  lines.push("  - none");
  lines.push("- Decisions made:");
  lines.push("  - weekly status generated from GitHub task labels");
  lines.push("- Next week focus:");
  lines.push("  - continue delegating tasks labeled agent:ready");

  const entry = `${lines.join("\n")}\n`;

  if (options.apply) {
    const next = checkpoints.endsWith("\n")
      ? `${checkpoints}\n${entry}`
      : `${checkpoints}\n\n${entry}`;
    writeFileSync(CHECKPOINTS_PATH, next);
    console.log(`Checkpoint entry written for Week ${week}.`);
  } else {
    console.log(entry);
  }

  return entry;
}

function auditCommand() {
  const drift = syncCommand({ apply: false, dryRun: true });
  if (drift.length > 0) {
    console.error(`Audit failed with ${drift.length} drift item(s).`);
    process.exit(1);
  }
  console.log("Audit passed.");
}

function main() {
  const [, , command, ...rest] = process.argv;
  if (!command || command === "-h" || command === "--help") {
    usage();
    process.exit(0);
  }

  const options = parseArgs(rest);

  switch (command) {
    case "sync":
      syncCommand(options);
      break;
    case "audit":
      auditCommand();
      break;
    case "delegate":
      delegateCommand(options);
      break;
    case "checkpoint":
      checkpointCommand(options);
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main();
