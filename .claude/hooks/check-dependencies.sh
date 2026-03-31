#!/bin/bash
# Check for unauthorized dependency additions in package.json files.
# Runs as a PostToolUse hook on Edit/Write when package.json is modified.
# Warns about new dependencies but does not block (user may have approved).

INPUT=$(cat)

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

if ! FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty'); then
  exit 0
fi

# Only check package.json files
if [[ "$FILE_PATH" != *"package.json" ]]; then
  exit 0
fi

# Check if new dependencies were added by looking at git diff
if command -v git >/dev/null 2>&1; then
  ADDED_DEPS=$(git diff -- "$FILE_PATH" 2>/dev/null | grep "^+" | grep -E '"[^"]+": "[^"]+"' | grep -v "^+++" || true)
  if [[ -n "$ADDED_DEPS" ]]; then
    echo "Note: Dependencies were modified in $FILE_PATH. Ensure any new dependencies are justified:" >&2
    echo "$ADDED_DEPS" >&2
    echo "Run 'pnpm audit' or 'npm audit' to check for vulnerabilities." >&2
  fi
fi

exit 0
