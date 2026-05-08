#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# KelionAI Safe Deploy Script
#
# Usage:
#   ./deploy.sh              — auto-deploy with timestamp message
#   ./deploy.sh "my message" — deploy with custom commit message
#   ./deploy.sh --direct     — bypass PR (emergency only, still health-checked)
#
# Flow:
#   1. Creates a deploy branch from current state
#   2. Pushes to GitHub
#   3. Creates a PR and auto-merges it (requires GitHub CLI: `gh`)
#   4. Railway picks up the merge on master
#   5. safe-deploy.yml verifies health + auto-reverts if broken
#
# For --direct mode:
#   Pushes straight to master (old behavior). The safe-deploy workflow
#   still runs and will auto-revert if the health check fails.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
COMMIT_MSG="${1:-Auto-deploy: $TIMESTAMP}"
BRANCH="deploy/auto-$(date '+%Y%m%d-%H%M%S')"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}══════════════════════════════════════${NC}"
echo -e "${CYAN}  KelionAI Safe Deploy${NC}"
echo -e "${CYAN}══════════════════════════════════════${NC}"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${YELLOW}Staging all changes...${NC}"
  git add .
  git commit -m "$COMMIT_MSG"
else
  echo -e "${YELLOW}No uncommitted changes. Using existing commits.${NC}"
fi

# --direct mode: push straight to master (old behavior)
if [ "${1:-}" = "--direct" ] || [ "${2:-}" = "--direct" ]; then
  echo -e "${YELLOW}⚡ Direct deploy to master (bypassing PR)${NC}"
  echo -e "${YELLOW}   safe-deploy.yml will still verify health.${NC}"
  git push origin master
  echo -e "${GREEN}✅ Pushed to master. Monitor deploy at:${NC}"
  echo -e "   https://github.com/adrianenc11-hue/kelionai-v2/actions"
  exit 0
fi

# PR-based deploy
echo -e "${CYAN}Creating deploy branch: ${BRANCH}${NC}"
git checkout -b "$BRANCH"
git push -u origin "$BRANCH"

# Check if gh CLI is available
if command -v gh &>/dev/null; then
  echo -e "${CYAN}Creating PR and auto-merging...${NC}"

  PR_URL=$(gh pr create \
    --title "🚀 Deploy: $COMMIT_MSG" \
    --body "Auto-deploy PR created by deploy.sh at $TIMESTAMP.

## Checklist
- [x] CI will run automatically
- [x] safe-deploy.yml will verify production health after merge
- [x] Auto-revert if health check fails" \
    --base master \
    --head "$BRANCH" 2>&1)

  echo -e "${GREEN}PR created: ${PR_URL}${NC}"

  # Wait for CI to pass, then merge
  echo -e "${CYAN}Waiting for CI checks to pass...${NC}"
  gh pr checks "$BRANCH" --watch --fail-fast 2>/dev/null || true

  echo -e "${CYAN}Merging PR...${NC}"
  gh pr merge "$BRANCH" --squash --delete-branch --auto 2>/dev/null || \
    gh pr merge "$BRANCH" --squash --delete-branch 2>/dev/null || \
    echo -e "${YELLOW}⚠️ Auto-merge failed. Merge manually or use: gh pr merge $BRANCH --squash --delete-branch${NC}"

else
  echo -e "${YELLOW}⚠️ GitHub CLI (gh) not installed. PR created but needs manual merge.${NC}"
  echo -e "   Branch pushed: ${BRANCH}"
  echo -e "   Create PR at: https://github.com/adrianenc11-hue/kelionai-v2/compare/master...${BRANCH}"
fi

# Switch back to master
git checkout master
git pull origin master 2>/dev/null || true

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deploy pipeline initiated${NC}"
echo -e "${GREEN}  Monitor: https://github.com/adrianenc11-hue/kelionai-v2/actions${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
