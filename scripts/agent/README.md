# Agent PR Bot — Scripts

Shell scripts powering the `Agent Task` GitHub Actions workflow (`.github/workflows/agent-task.yml`). These scripts extract issue data, build agent prompts, enforce file-change boundaries, and create pull requests.

## Architecture

```
workflow_dispatch (issue_number, task_id, dry_run)
  │
  ├─ extract-issue.sh    → Parse GitHub issue into structured sections
  ├─ build-prompt.sh     → Assemble agent prompt from docs + issue
  ├─ [agent stub]        → Placeholder for agent execution
  ├─ enforce-allowed-files.sh → Verify only permitted files changed
  └─ create-pr.sh        → Branch, commit, push, open PR
```

## Scripts

### extract-issue.sh

Fetches a GitHub issue via `gh` and splits the body into individual section files.

```bash
./scripts/agent/extract-issue.sh <issue_number> <output_dir>
```

**Inputs:**
- `issue_number` — GitHub issue number
- `output_dir` — directory to write extracted files

**Outputs (in output_dir):**
- `issue-title.txt` — issue title
- `issue-body.md` — full issue body
- `allowed-files.md` — raw "Allowed Files" section
- `allowed-files.txt` — one file path per line (parsed from markdown list)
- `acceptance-criteria.md` — raw "Acceptance Criteria" section
- `required-tests.md` — raw "Required Tests" section
- `out-of-scope.md` — raw "Out of Scope" section
- `context.md` — raw "Context" section
- `scope.md` — raw "Scope" section

**Requires:** `gh` CLI authenticated, `jq`.

### build-prompt.sh

Concatenates project context documents and issue content into a single prompt file.

```bash
./scripts/agent/build-prompt.sh <issue_dir> <output_file>
```

**Inputs:**
- `issue_dir` — directory produced by `extract-issue.sh`
- `output_file` — path to write the assembled prompt

**Documents included (in order):**
1. `CLAUDE.md`
2. `.claude/rules/architecture.md`
3. `.claude/rules/code-style.md`
4. `.claude/rules/testing.md`
5. `.claude/rules/claims.md`
6. Issue content (context, scope, allowed files, criteria, tests)
7. Strict enforcement instructions (allowed-files list, verification commands)

### enforce-allowed-files.sh

Compares `git` working tree changes against the allowed files list and fails if any unauthorized file was modified.

```bash
./scripts/agent/enforce-allowed-files.sh <allowed_files_txt>
```

**Inputs:**
- `allowed_files_txt` — path to the `allowed-files.txt` produced by extraction

**Exit codes:**
- `0` — all changes within allowed list
- `1` — one or more violations detected

### create-pr.sh

Creates a feature branch, commits all staged changes, pushes to origin, and opens a pull request via `gh`.

```bash
./scripts/agent/create-pr.sh <issue_number> <task_id> <issue_dir> <logs_dir>
```

**Inputs:**
- `issue_number` — GitHub issue number
- `task_id` — task identifier (e.g., `PH1-E1-M1.1-T1.1` or legacy `TASK-001`)
- `issue_dir` — directory with `issue-title.txt`
- `logs_dir` — directory with `check-results.txt`

**Behavior:**
- Branch name: `agent/<issue_number>-<task_id>`
- Commit message: conventional commit derived from task title
- PR body includes: summary, files changed, verification results
- PR links to the issue via `closes #<issue_number>`

**Requires:** `gh` CLI with `contents:write` and `pull-requests:write` permissions.

## Workflow Usage

### Manual Trigger (GitHub UI)

1. Go to **Actions** → **Agent Task**
2. Click **Run workflow**
3. Fill in:
   - `issue_number`: the GitHub issue to implement (required)
   - `task_id`: e.g., `PH1-E1-M1.1-T1.1` (optional; auto-detected from issue title)
   - `dry_run`: `true` to build prompt + run checks without creating a PR

### Manual Trigger (CLI)

```bash
# Dry run — build prompt and run checks only
gh workflow run agent-task.yml \
  -f issue_number=7 \
  -f task_id=PH1-E1-M1.1-T1.1 \
  -f dry_run=true

# Full run — create PR if checks pass
gh workflow run agent-task.yml \
  -f issue_number=7 \
  -f task_id=PH1-E1-M1.1-T1.1 \
  -f dry_run=false
```

### Artifacts

Every run uploads three artifacts (retained 30 days):

| Artifact | Contents |
|---|---|
| `agent-prompt-<N>` | The assembled `prompt.txt` |
| `agent-logs-<N>` | Check logs (`typecheck.log`, `lint.log`, `test.log`, `build.log`, `check-results.txt`) |
| `agent-issue-<N>` | Extracted issue sections |

## Current Limitations

- **Agent stub:** The "agent execution" step is a placeholder that echoes the prompt. No LLM API is called.
- **No auto-trigger:** Workflow requires manual `workflow_dispatch`. Automatic triggers (on issue label, on comment) are future work.
- **CODEOWNERS not enforced:** `.github/CODEOWNERS` contains recommended reviewers but branch protection rules are not yet configured.

## Security

- Workflow uses least-privilege `GITHUB_TOKEN` permissions: `contents:write`, `issues:read`, `pull-requests:write`.
- Agent never pushes to `main` — always creates a feature branch.
- Allowed-files enforcement runs before PR creation to prevent unauthorized modifications.
- All changes require human review via PR before merge.
