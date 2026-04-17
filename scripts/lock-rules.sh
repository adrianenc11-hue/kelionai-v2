#!/usr/bin/env bash
# scripts/lock-rules.sh
#
# Sets the rule-enforcement files to read-only at the Unix filesystem
# level (chmod 444). Run this ONCE, as the owner, after committing
# RULES.md and related files. Any subsequent agent attempt to modify
# these files via normal tooling will fail with EACCES.
#
# Usage:
#   chmod +x scripts/lock-rules.sh
#   ./scripts/lock-rules.sh
#
# To unlock for an authorized edit, run ./scripts/unlock-rules.sh.

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

missing=()
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || missing+=("$f")
done
if (( ${#missing[@]} > 0 )); then
  echo "Cannot lock: missing files:" >&2
  for f in "${missing[@]}"; do echo "  $f" >&2; done
  exit 2
fi

for f in "${FILES[@]}"; do
  chmod 444 "$f"
  echo "locked  $f"
done

# Lock every file inside e2e/acceptance but keep the dir writable so new
# scripts can still be added via PR.
if [[ -d e2e/acceptance ]]; then
  find e2e/acceptance -type f -exec chmod 444 {} \;
  echo "locked  e2e/acceptance/* (recursive, files only)"
fi

echo
echo "All enforcement files are now read-only on disk."
echo "Any tool that tries to modify them will receive EACCES."
echo "To unlock for an authorized edit, run ./scripts/unlock-rules.sh."
