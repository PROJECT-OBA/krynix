#!/bin/bash
# Auto-format TypeScript files after Edit/Write operations.
# Only formats .ts files within packages/*/src/ to match the project's Prettier scope.

INPUT=$(cat)

# Require jq; if unavailable, fail open and exit cleanly.
if ! command -v jq >/dev/null 2>&1; then
  echo "[auto-format] jq not found; skipping auto-formatting hook." >&2
  exit 0
fi

# Safely extract the file path; on parse failure, exit cleanly.
if ! FILE_PATH=$(echo "$INPUT" | jq -er '.tool_input.file_path // .tool_input.filePath'); then
  exit 0
fi

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Only format TypeScript files in packages (matches any depth under src/)
if [[ "$FILE_PATH" == *.ts && "$FILE_PATH" == */packages/*/src/* ]]; then
  npx --no-install prettier --write "$FILE_PATH"
fi

exit 0
