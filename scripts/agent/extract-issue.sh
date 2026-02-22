#!/usr/bin/env bash
# scripts/agent/extract-issue.sh
#
# Fetches a GitHub issue by number and extracts structured sections:
#   - Allowed Files
#   - Acceptance Criteria
#   - Required Tests
#   - Full issue body
#
# Usage: ./extract-issue.sh <issue_number> <output_dir>
# Requires: gh CLI authenticated with repo read access.

set -euo pipefail

ISSUE_NUMBER="${1:?Usage: extract-issue.sh <issue_number> <output_dir>}"
OUTPUT_DIR="${2:?Usage: extract-issue.sh <issue_number> <output_dir>}"

mkdir -p "$OUTPUT_DIR"

echo "::group::Fetching issue #${ISSUE_NUMBER}"

# Fetch issue title and body as JSON
ISSUE_JSON=$(gh issue view "$ISSUE_NUMBER" --json title,body,labels,milestone)

ISSUE_TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
ISSUE_BODY=$(echo "$ISSUE_JSON" | jq -r '.body')

echo "Issue title: $ISSUE_TITLE"
echo "$ISSUE_BODY" > "$OUTPUT_DIR/issue-body.md"
echo "$ISSUE_TITLE" > "$OUTPUT_DIR/issue-title.txt"

echo "::endgroup::"

# --- Section extraction ---
# Uses awk to extract content between markdown ## headers.
# Matches headers like "## Allowed Files", "## Acceptance Criteria", etc.
extract_section() {
  local section_name="$1"
  local input_file="$2"
  local output_file="$3"

  # Extract everything between "## <section_name>" and the next "## " header (or EOF).
  awk -v section="$section_name" '
    BEGIN { found=0 }
    /^## / {
      if (found) exit
      # Case-insensitive match on the section header
      header = $0
      gsub(/^## */, "", header)
      if (tolower(header) == tolower(section)) { found=1; next }
    }
    found { print }
  ' "$input_file" > "$output_file"

  # Trim leading/trailing blank lines
  if [ -s "$output_file" ]; then
    sed -i.bak '/./,$!d' "$output_file" && rm -f "$output_file.bak"
    echo "  Extracted: $section_name ($(wc -l < "$output_file" | tr -d ' ') lines)"
  else
    echo "  Warning: section '$section_name' not found in issue body"
  fi
}

echo "::group::Extracting structured sections"
extract_section "Allowed Files" "$OUTPUT_DIR/issue-body.md" "$OUTPUT_DIR/allowed-files.md"
extract_section "Acceptance Criteria" "$OUTPUT_DIR/issue-body.md" "$OUTPUT_DIR/acceptance-criteria.md"
extract_section "Required Tests" "$OUTPUT_DIR/issue-body.md" "$OUTPUT_DIR/required-tests.md"
extract_section "Out of Scope" "$OUTPUT_DIR/issue-body.md" "$OUTPUT_DIR/out-of-scope.md"
extract_section "Context" "$OUTPUT_DIR/issue-body.md" "$OUTPUT_DIR/context.md"
extract_section "Scope" "$OUTPUT_DIR/issue-body.md" "$OUTPUT_DIR/scope.md"
echo "::endgroup::"

# --- Extract allowed file paths as a flat list ---
# Parse the "Allowed Files" section: lines starting with "- " followed by a backtick-wrapped path
# or bare path.
echo "::group::Parsing allowed file list"
if [ -s "$OUTPUT_DIR/allowed-files.md" ]; then
  grep -E '^\s*-\s+' "$OUTPUT_DIR/allowed-files.md" \
    | sed 's/^\s*-\s*//' \
    | sed 's/`//g' \
    | sed 's/ *(.*$//' \
    | sed 's/\s*$//' \
    | grep -v '^\s*$' \
    > "$OUTPUT_DIR/allowed-files.txt" || true
  echo "Allowed files ($(wc -l < "$OUTPUT_DIR/allowed-files.txt" | tr -d ' ') entries):"
  cat "$OUTPUT_DIR/allowed-files.txt"
else
  touch "$OUTPUT_DIR/allowed-files.txt"
  echo "No allowed files extracted."
fi
echo "::endgroup::"

echo "Extraction complete. Output in: $OUTPUT_DIR"
