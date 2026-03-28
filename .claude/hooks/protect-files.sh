#!/bin/bash
# Prevent Claude from editing files that should not be modified directly.
# Exit 0 = allow, Exit 2 = block (stderr sent as feedback to Claude).

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [[ -z "$FILE_PATH" ]]; then
  echo "Blocked: unable to determine target file path from tool_input (expected file_path or filePath)." >&2
  exit 2
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
