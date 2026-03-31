---
name: done-task
description: Mark a task as done — close the GitHub issue and clean up labels
allowed-tools: Bash
user-invocable: true
argument-hint: [issue-number]
---

# Complete Task

Mark a GitHub issue as done and clean up project board state.

## Steps

1. Determine the repo name:
   ```bash
   REPO_NAME=$(basename $(git rev-parse --show-toplevel))
   ```

2. If no issue number provided ($ARGUMENTS is empty), try to detect from branch name:
   ```bash
   BRANCH=$(git branch --show-current)
   # Extract issue number from branch like feat/issue-42-description
   ```

3. Update labels and close the issue:
   ```bash
   gh issue edit $0 --repo PROJECT-OBA/$REPO_NAME --remove-label "in-progress" --remove-label "ready" --add-label "done"
   gh issue close $0 --repo PROJECT-OBA/$REPO_NAME
   ```

4. If there's an open PR for this branch, link it in a comment:
   ```bash
   PR_URL=$(gh pr list --repo PROJECT-OBA/$REPO_NAME --head $(git branch --show-current) --json url --jq '.[0].url')
   if [ -n "$PR_URL" ]; then
     gh issue comment $0 --repo PROJECT-OBA/$REPO_NAME --body "Completed in $PR_URL"
   fi
   ```

5. Confirm closure to the user with issue title and number.
