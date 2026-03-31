#!/bin/bash
# Validate that commit messages follow Conventional Commits format.
# Runs as a PostToolUse hook on Bash tool when git commit is detected.
# Exit 0 = allow, Exit 2 = block with feedback.

INPUT=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

# Extract the command that was run
if ! COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty'); then
  exit 0
fi

# Only check git commit commands
if [[ "$COMMAND" != *"git commit"* ]]; then
  exit 0
fi

# Extract stdout to check if commit succeeded
if ! STDOUT=$(echo "$INPUT" | jq -r '.stdout // empty'); then
  exit 0
fi

# If the commit message is in the output, validate it
# Look for the commit message pattern in the output
if echo "$STDOUT" | grep -qE "^\[.+ [a-f0-9]+\]"; then
  # Commit succeeded — check if the message follows conventional commits
  COMMIT_MSG=$(git log -1 --format="%s" 2>/dev/null)
  if [[ -n "$COMMIT_MSG" ]]; then
    # Conventional Commits: type(scope): description
    if ! echo "$COMMIT_MSG" | grep -qE "^(feat|fix|docs|test|refactor|ci|chore)(\(.+\))?: .+"; then
      echo "Warning: Commit message '$COMMIT_MSG' does not follow Conventional Commits format." >&2
      echo "Expected: type(scope): description" >&2
      echo "Types: feat, fix, docs, test, refactor, ci, chore" >&2
      # Warning only — don't block (the commit already happened)
      exit 0
    fi
  fi
fi

exit 0
