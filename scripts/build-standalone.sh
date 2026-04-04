#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "Building all packages..."
pnpm build

STANDALONE="$REPO_ROOT/packages/cli/dist/standalone/main.cjs"

if [ ! -f "$STANDALONE" ]; then
  echo "ERROR: Standalone binary not found at $STANDALONE"
  exit 1
fi

mkdir -p "$REPO_ROOT/dist"
cp "$STANDALONE" "$REPO_ROOT/dist/krynix.cjs"
chmod +x "$REPO_ROOT/dist/krynix.cjs"

echo ""
echo "Standalone binary: dist/krynix.cjs"
echo "Run with: node dist/krynix.cjs --version"
node "$REPO_ROOT/dist/krynix.cjs" --version
