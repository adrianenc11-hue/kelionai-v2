#!/usr/bin/env bash
# scripts/unlock-rules.sh
#
# Restores write permission to the enforcement files so the owner can make
# an authorized edit. After the edit, the owner must:
#   1. Run: node scripts/verify-rules-integrity.cjs --write (if RULES.md changed)
#   2. Commit all changes in a single PR that CODEOWNERS must approve.
#   3. Run: ./scripts/lock-rules.sh
#
# Running this script does NOT grant any authority — CODEOWNERS + branch
# protection are still the real gate.

set -euo pipefail

FILES=(
  'RULES.md'
  'RULES.sha256'
  '.augment/rules.md'
  'CODEOWNERS'
  'DELIVERY_CONTRACT.md'
  'scripts/verify-rules-integrity.cjs'
  'scripts/verify-agent-report.cjs'
  'scripts/lock-rules.ps1'
  'scripts/lock-rules.sh'
  '.github/workflows/rules-integrity.yml'
  '.github/workflows/acceptance.yml'
)

for f in "${FILES[@]}"; do
  [[ -f "$f" ]] && chmod 644 "$f" && echo "unlocked  $f"
done

if [[ -d e2e/acceptance ]]; then
  find e2e/acceptance -type f -exec chmod 644 {} \;
  echo "unlocked  e2e/acceptance/* (recursive, files only)"
fi

echo
echo "Enforcement files are writable now. Re-lock after your edit with ./scripts/lock-rules.sh."
