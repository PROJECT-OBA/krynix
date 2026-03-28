#!/bin/bash
# Auto-format TypeScript files after Edit/Write operations.
# Only formats .ts files within packages/*/src/ to match the project's Prettier scope.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty')

if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Only format TypeScript files in packages
if [[ "$FILE_PATH" == */packages/*/src/*.ts ]]; then
  npx prettier --write "$FILE_PATH" 2>/dev/null
fi

exit 0
