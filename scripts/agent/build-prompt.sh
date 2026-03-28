#!/usr/bin/env bash
# scripts/agent/build-prompt.sh
#
# Constructs the agent prompt by concatenating project context documents
# and the extracted issue content.
#
# Usage: ./build-prompt.sh <issue_dir> <output_file>
#   <issue_dir>   — directory produced by extract-issue.sh
#   <output_file>  — path to write the assembled prompt

set -euo pipefail

ISSUE_DIR="${1:?Usage: build-prompt.sh <issue_dir> <output_file>}"
OUTPUT_FILE="${2:?Usage: build-prompt.sh <issue_dir> <output_file>}"

REPO_ROOT="$(git rev-parse --show-toplevel)"

# --- Helper: append a file with a header separator ---
append_doc() {
  local label="$1"
  local file_path="$2"

  if [ -f "$file_path" ] && [ -s "$file_path" ]; then
    {
      echo ""
      echo "================================================================================"
      echo "=== ${label}"
      echo "================================================================================"
      echo ""
      cat "$file_path"
      echo ""
    } >> "$OUTPUT_FILE"
    echo "  Added: $label ($(wc -l < "$file_path" | tr -d ' ') lines)"
  else
    echo "  Skipped (empty/missing): $label"
  fi
}

# --- Start building the prompt ---
echo "Building agent prompt..."

# Clear output file
> "$OUTPUT_FILE"

# 1. Project context documents
echo "::group::Assembling project context"
append_doc "CLAUDE.md — Project Instructions" "$REPO_ROOT/CLAUDE.md"
append_doc ".claude/rules/architecture.md — Architecture Rules" "$REPO_ROOT/.claude/rules/architecture.md"
append_doc ".claude/rules/code-style.md — Code Style Guide" "$REPO_ROOT/.claude/rules/code-style.md"
append_doc ".claude/rules/testing.md — Testing Rules" "$REPO_ROOT/.claude/rules/testing.md"
append_doc ".claude/rules/claims.md — Truth Labeling" "$REPO_ROOT/.claude/rules/claims.md"
echo "::endgroup::"

# 2. Issue content
echo "::group::Assembling issue content"
ISSUE_TITLE=""
if [ -f "$ISSUE_DIR/issue-title.txt" ]; then
  ISSUE_TITLE=$(cat "$ISSUE_DIR/issue-title.txt")
fi

{
  echo ""
  echo "================================================================================"
  echo "=== TASK ASSIGNMENT"
  echo "================================================================================"
  echo ""
  echo "You are implementing the following task:"
  echo ""
  echo "## $ISSUE_TITLE"
  echo ""
} >> "$OUTPUT_FILE"

append_doc "Task Context" "$ISSUE_DIR/context.md"
append_doc "Task Scope" "$ISSUE_DIR/scope.md"
append_doc "Allowed Files" "$ISSUE_DIR/allowed-files.md"
append_doc "Out of Scope" "$ISSUE_DIR/out-of-scope.md"
append_doc "Acceptance Criteria" "$ISSUE_DIR/acceptance-criteria.md"
append_doc "Required Tests" "$ISSUE_DIR/required-tests.md"
echo "::endgroup::"

# 3. Strict enforcement instructions
echo "::group::Adding enforcement instructions"
{
  echo ""
  echo "================================================================================"
  echo "=== STRICT INSTRUCTIONS"
  echo "================================================================================"
  echo ""
  echo "IMPORTANT — Enforcement Rules:"
  echo ""
  echo "1. ONLY modify files listed in the 'Allowed Files' section above."
  echo "   The allowed files are:"
  echo ""
  if [ -f "$ISSUE_DIR/allowed-files.txt" ]; then
    while IFS= read -r f; do
      echo "     - $f"
    done < "$ISSUE_DIR/allowed-files.txt"
  fi
  echo ""
  echo "   Any modification to files NOT in this list will be rejected."
  echo ""
  echo "2. Implement ALL items in the 'Acceptance Criteria' section."
  echo ""
  echo "3. Write ALL tests listed in the 'Required Tests' section."
  echo ""
  echo "4. Do NOT modify anything listed in the 'Out of Scope' section."
  echo ""
  echo "5. After making changes, all verification commands must pass:"
  echo "     pnpm typecheck"
  echo "     pnpm lint"
  echo "     pnpm test"
  echo "     pnpm build"
  echo ""
  echo "6. Output the FULL contents of every file you create or modify."
  echo ""
  echo "7. Use Conventional Commits format for the commit message."
  echo "   Derive the type and scope from the task (e.g., feat(core), test(policy))."
  echo ""
  echo "8. Follow all conventions in .claude/rules/code-style.md: string unions for wire types,"
  echo "   pure functions by default, colocated tests, JSDoc on public APIs."
  echo ""
} >> "$OUTPUT_FILE"
echo "::endgroup::"

TOTAL_LINES=$(wc -l < "$OUTPUT_FILE" | tr -d ' ')
echo ""
echo "Prompt assembled: $OUTPUT_FILE ($TOTAL_LINES lines)"
