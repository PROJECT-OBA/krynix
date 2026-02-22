#!/usr/bin/env bash
# scripts/agent/enforce-allowed-files.sh
#
# Validates that only files listed in allowed-files.txt were modified.
# Compares git working tree changes against the allowed list.
#
# Usage: ./enforce-allowed-files.sh <allowed_files_txt>
# Exit code: 0 if compliant, 1 if violations found.

set -euo pipefail

ALLOWED_FILE="${1:?Usage: enforce-allowed-files.sh <allowed_files_txt>}"

if [ ! -f "$ALLOWED_FILE" ]; then
  echo "Error: allowed files list not found: $ALLOWED_FILE"
  exit 1
fi

echo "::group::Enforcing allowed files"

# Get list of changed files (staged + unstaged + untracked new files)
CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || true)
UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null || true)

ALL_CHANGES=$(echo -e "${CHANGED_FILES}\n${UNTRACKED}" | grep -v '^\s*$' | sort -u)

if [ -z "$ALL_CHANGES" ]; then
  echo "No files changed."
  echo "::endgroup::"
  exit 0
fi

echo "Changed files:"
echo "$ALL_CHANGES" | sed 's/^/  /'
echo ""

VIOLATIONS=""
VIOLATION_COUNT=0

while IFS= read -r changed_file; do
  [ -z "$changed_file" ] && continue

  IS_ALLOWED=false
  while IFS= read -r allowed_pattern; do
    [ -z "$allowed_pattern" ] && continue

    # Strip comments and whitespace
    allowed_pattern=$(echo "$allowed_pattern" | sed 's/#.*//' | sed 's/^[[:space:]]*//' | sed 's/[[:space:]]*$//')
    [ -z "$allowed_pattern" ] && continue

    # Exact match or pattern match (allowing parenthetical notes in allowed files)
    if [ "$changed_file" = "$allowed_pattern" ]; then
      IS_ALLOWED=true
      break
    fi

    # Handle "(export additions only)" style suffixed patterns — just compare the path part
    CLEAN_PATTERN=$(echo "$allowed_pattern" | sed 's/ *(.*)$//')
    if [ "$changed_file" = "$CLEAN_PATTERN" ]; then
      IS_ALLOWED=true
      break
    fi
  done < "$ALLOWED_FILE"

  if [ "$IS_ALLOWED" = false ]; then
    VIOLATIONS="${VIOLATIONS}  VIOLATION: ${changed_file}\n"
    VIOLATION_COUNT=$((VIOLATION_COUNT + 1))
  fi
done <<< "$ALL_CHANGES"

if [ "$VIOLATION_COUNT" -gt 0 ]; then
  echo "FAILED: $VIOLATION_COUNT file(s) modified outside allowed list:"
  echo ""
  echo -e "$VIOLATIONS"
  echo ""
  echo "Allowed files:"
  cat "$ALLOWED_FILE" | sed 's/^/  /'
  echo "::endgroup::"
  exit 1
else
  echo "PASSED: All changed files are within the allowed list."
  echo "::endgroup::"
  exit 0
fi
