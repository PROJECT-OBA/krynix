#!/usr/bin/env bash
# Simulates a consumer installing and using the standalone Krynix binary.
# Run from any directory — tests that the binary works outside the monorepo.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINARY="$REPO_ROOT/packages/cli/dist/standalone/main.cjs"

if [ ! -f "$BINARY" ]; then
  echo "ERROR: Build first with 'pnpm build'"
  exit 1
fi

# Create an isolated temp directory (simulates consumer project)
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

echo "=== Consumer e2e test ==="
echo "Working directory: $WORKDIR"
echo ""

# Copy binary
cp "$BINARY" "$WORKDIR/krynix"
chmod +x "$WORKDIR/krynix"

# Test 1: Version
echo "--- Test 1: --version ---"
node "$WORKDIR/krynix" --version
echo "PASS"

# Test 2: Help
echo "--- Test 2: --help ---"
node "$WORKDIR/krynix" --help > /dev/null
echo "PASS"

# Test 3: Validate a policy
echo "--- Test 3: validate policy ---"
cat > "$WORKDIR/test.policy.yaml" << 'POLICY'
apiVersion: krynix.dev/v1
kind: Policy
metadata:
  name: test-policy
  version: "1.0"
  description: Test policy
spec:
  scope:
    agents: ["*"]
    event_types: ["tool_call"]
  rules:
    - id: block-shell
      description: Deny shell
      match:
        event_type: tool_call
        payload:
          - field: tool_name
            operator: eq
            value: shell_exec
      action: deny
      severity: error
      message: "No shell"
POLICY
node "$WORKDIR/krynix" validate --policy "$WORKDIR/test.policy.yaml"
echo "PASS"

# Test 4: Evaluate a trace against a policy
echo "--- Test 4: evaluate trace ---"
cp "$REPO_ROOT/test/golden/minimal.trace.jsonl" "$WORKDIR/trace.jsonl"
node "$WORKDIR/krynix" evaluate --trace "$WORKDIR/trace.jsonl" --policy "$WORKDIR/test.policy.yaml"
echo "PASS"

# Test 5: Replay verify
echo "--- Test 5: replay --verify ---"
node "$WORKDIR/krynix" replay --verify --trace "$WORKDIR/trace.jsonl"
echo "PASS"

# Test 6: Stats
echo "--- Test 6: stats ---"
node "$WORKDIR/krynix" stats --trace "$WORKDIR/trace.jsonl" > /dev/null
echo "PASS"

# Test 7: Export
echo "--- Test 7: export ---"
node "$WORKDIR/krynix" export --trace "$WORKDIR/trace.jsonl" --format otlp-json > /dev/null
echo "PASS"

echo ""
echo "=== All consumer e2e tests passed ==="
