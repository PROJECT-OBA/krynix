#!/bin/bash
# Prevent Claude from editing files that should not be modified directly.
# Exit 0 = allow, Exit 2 = block (stderr sent as feedback to Claude).
# Fails open (allow + warn) when jq is missing or payload can't be parsed.

INPUT=$(cat)

# If jq is unavailable, fail open: warn and allow edits rather than blocking everything.
if ! command -v jq >/dev/null 2>&1; then
  echo "Warning: 'jq' not found; skipping protect-files checks." >&2
  exit 0
fi

# Extract target file path from the tool_input payload.
if ! FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty'); then
  echo "Warning: unable to parse tool_input JSON; skipping protect-files checks." >&2
  exit 0
fi

if [[ -z "$FILE_PATH" ]]; then
  echo "Warning: unable to determine target file path from tool_input; skipping protect-files checks." >&2
  exit 0
fi

# Patterns that should never be edited by Claude
PROTECTED_PATTERNS=(
  ".env"
  "pnpm-lock.yaml"
  ".github/workflows/"
  "package-lock.json"
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: '$FILE_PATH' matches protected pattern '$pattern'. Ask the user before modifying." >&2
    exit 2
  fi
done

exit 0
