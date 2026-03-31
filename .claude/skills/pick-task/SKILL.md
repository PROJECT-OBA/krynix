---
name: pick-task
description: Pick the next task from the GitHub project board for this repository
allowed-tools: Bash, Read
user-invocable: true
argument-hint: [optional label filter, e.g. "P0" or "bug"]
---

# Pick Next Task

Fetch and display available tasks from GitHub Issues for this repository.

## Steps

1. Determine the repo name from the current directory:
   ```bash
   REPO_NAME=$(basename $(git rev-parse --show-toplevel))
   ```

2. Fetch open issues labeled "ready" for this repo:
   ```bash
   gh issue list --repo PROJECT-OBA/$REPO_NAME --state open --label "ready" --json number,title,body,labels,assignees --limit 10
   ```

3. If a label filter was provided ($ARGUMENTS), add it:
   ```bash
   gh issue list --repo PROJECT-OBA/$REPO_NAME --state open --label "ready,$ARGUMENTS" --json number,title,body,labels,assignees --limit 10
   ```

4. Display the issues in a readable format:
   - Issue number and title
   - Priority label (P0/P1/P2)
   - Brief description (first 3 lines of body)

5. Ask the user which issue they want to work on.

6. When selected, assign it and mark in-progress:
   ```bash
   gh issue edit <number> --repo PROJECT-OBA/$REPO_NAME --add-label "in-progress" --remove-label "ready"
   ```

7. Create a feature branch for the issue:
   ```bash
   git checkout main && git pull && git checkout -b feat/issue-<number>-<short-description>
   ```

8. Display the full issue body so the user/agent has context to start working.
