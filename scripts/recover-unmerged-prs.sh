#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2 — Recover Unmerged PRs
# Recovers PRs #101, #102, #105, #107, #110 that were closed
# without being merged into master.
#
# Usage: bash scripts/recover-unmerged-prs.sh [--dry-run]
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Colors ────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"; }
err()  { echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"; }
info() { echo -e "${CYAN}ℹ️  $1${NC}" | tee -a "$LOG_FILE"; }
skip() { echo -e "${YELLOW}⏭  SKIP: $1${NC}" | tee -a "$LOG_FILE"; }
step() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}" | tee -a "$LOG_FILE"; }

# ─── Parse arguments ───────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

# ─── Setup logging ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="$LOG_DIR/recover-prs-${TIMESTAMP}.log"

# ─── Check required tools ──────────────────────────────────────
for tool in git gh curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌ Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Report counters ───────────────────────────────────────────
COUNT_RECOVERED=0
COUNT_SKIPPED=0
COUNT_CONFLICTS=0
COUNT_FAILED=0

# ─── Target PR numbers ─────────────────────────────────────────
# Source branches are looked up dynamically from GitHub so that
# we don't risk two PRs incorrectly sharing a hardcoded branch name.
PR_NUMBERS=(101 102 105 107 110)

# ─── Banner ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}${CYAN}   KelionAI v2 — Recover Unmerged PRs                 ${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}   🔍 DRY RUN MODE — no changes will be made            ${NC}" | tee -a "$LOG_FILE"
  echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"
info "Log file: $LOG_FILE"
echo "" | tee -a "$LOG_FILE"

cd "$PROJECT_DIR"

# ─── Fetch latest remote state ─────────────────────────────────
step "Fetching latest remote state"
if [ "$DRY_RUN" = false ]; then
  git fetch origin --prune 2>&1 | tee -a "$LOG_FILE" || true
else
  info "[dry-run] Would run: git fetch origin --prune"
fi

# ─── Process each PR ───────────────────────────────────────────
for PR_NUM in "${PR_NUMBERS[@]}"; do
  RECOVER_BRANCH="recover/pr-${PR_NUM}"

  step "Processing PR #${PR_NUM}"

  # 1. Look up PR details from GitHub to get the correct head branch
  PR_JSON=$(gh pr view "$PR_NUM" --json headRefName,title,state 2>/dev/null || echo "")
  if [ -z "$PR_JSON" ]; then
    err "Could not fetch PR #${PR_NUM} from GitHub."
    COUNT_FAILED=$((COUNT_FAILED + 1))
    continue
  fi

  SOURCE_BRANCH=$(echo "$PR_JSON" | jq -r '.headRefName // empty')
  PR_TITLE=$(echo "$PR_JSON" | jq -r '.title // "Recover PR #'"$PR_NUM"'"')

  if [ -z "$SOURCE_BRANCH" ]; then
    err "PR #${PR_NUM}: could not determine head branch."
    COUNT_FAILED=$((COUNT_FAILED + 1))
    continue
  fi

  info "Source branch: $SOURCE_BRANCH"
  info "PR title:      $PR_TITLE"

  # 2. Check if source branch exists on remote
  if ! git ls-remote --exit-code --heads origin "$SOURCE_BRANCH" &>/dev/null; then
    warn "Source branch '$SOURCE_BRANCH' not found on remote. Cannot recover PR #${PR_NUM}."
    COUNT_FAILED=$((COUNT_FAILED + 1))
    continue
  fi
  ok "Source branch exists: $SOURCE_BRANCH"

  # 3. Check if source branch is already merged into master
  MERGE_BASE=$(git merge-base "origin/master" "origin/${SOURCE_BRANCH}" 2>/dev/null || echo "")
  SOURCE_SHA=$(git rev-parse "origin/${SOURCE_BRANCH}" 2>/dev/null || echo "")
  if [ -n "$MERGE_BASE" ] && [ "$MERGE_BASE" = "$SOURCE_SHA" ]; then
    skip "${SOURCE_BRANCH} is already merged into master (PR #${PR_NUM})"
    COUNT_SKIPPED=$((COUNT_SKIPPED + 1))
    continue
  fi

  # 4. Check if recover branch already exists
  RECOVER_EXISTS=false
  if git ls-remote --exit-code --heads origin "$RECOVER_BRANCH" &>/dev/null; then
    skip "Branch $RECOVER_BRANCH already exists"
    RECOVER_EXISTS=true
    COUNT_SKIPPED=$((COUNT_SKIPPED + 1))
  else
    # Create recover branch
    if [ "$DRY_RUN" = true ]; then
      info "[dry-run] Would create branch $RECOVER_BRANCH from origin/$SOURCE_BRANCH"
    else
      git checkout -B "$RECOVER_BRANCH" "origin/$SOURCE_BRANCH" 2>&1 | tee -a "$LOG_FILE"
      git push origin "$RECOVER_BRANCH" 2>&1 | tee -a "$LOG_FILE"
      ok "Created and pushed branch: $RECOVER_BRANCH"
      COUNT_RECOVERED=$((COUNT_RECOVERED + 1))
    fi
  fi

  # 5. Check if open PR already exists from this recover branch
  EXISTING_PR=$(gh pr list --head "$RECOVER_BRANCH" --base master --state open --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [ -n "$EXISTING_PR" ]; then
    skip "PR already exists for $RECOVER_BRANCH → master (PR #${EXISTING_PR})"
    COUNT_SKIPPED=$((COUNT_SKIPPED + 1))
    continue
  fi

  # 6. Dry-run merge check for conflicts
  if [ "$DRY_RUN" = false ] && [ "$RECOVER_EXISTS" = false ]; then
    info "Running dry-run merge check for $RECOVER_BRANCH..."
    git checkout master 2>/dev/null \
      || git checkout -B master origin/master 2>&1 | tee -a "$LOG_FILE"
    git pull origin master 2>&1 | tee -a "$LOG_FILE"

    CONFLICT_FILES=""
    if ! git merge --no-commit --no-ff "origin/$RECOVER_BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
      CONFLICT_FILES=$(git diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ', ')
      git merge --abort 2>/dev/null || git reset --hard HEAD 2>/dev/null || true
      warn "Conflicts detected in PR #${PR_NUM}: ${CONFLICT_FILES}"
      COUNT_CONFLICTS=$((COUNT_CONFLICTS + 1))
    else
      git merge --abort 2>/dev/null || git reset --hard HEAD 2>/dev/null || true
      ok "No conflicts in dry-run merge for PR #${PR_NUM}"
    fi
  fi

  # 7. Create PR
  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] Would create PR: 'Recover PR #${PR_NUM}: ${PR_TITLE}' ($RECOVER_BRANCH → master)"
  else
    PR_BODY="Recovering unmerged PR #${PR_NUM}.

This PR was originally closed without being merged. The code is being recovered from branch \`${SOURCE_BRANCH}\`.

**Original PR:** #${PR_NUM}
**Source branch:** \`${SOURCE_BRANCH}\`
**Recovery branch:** \`${RECOVER_BRANCH}\`

🤖 Auto-generated by \`scripts/recover-unmerged-prs.sh\`"

    NEW_PR_URL=$(gh pr create \
      --title "Recover PR #${PR_NUM}: ${PR_TITLE}" \
      --body "$PR_BODY" \
      --head "$RECOVER_BRANCH" \
      --base master \
      --json url --jq '.url' 2>&1 | tee -a "$LOG_FILE" || echo "")
    if [ -n "$NEW_PR_URL" ] && [[ "$NEW_PR_URL" == http* ]]; then
      ok "Created PR: $NEW_PR_URL"
    else
      err "Failed to create PR for $RECOVER_BRANCH"
      COUNT_FAILED=$((COUNT_FAILED + 1))
    fi
  fi

done

# ─── Summary ───────────────────────────────────────────────────
echo "" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}   Recovery Summary                                    ${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${GREEN}  ✅ Recovered:  ${COUNT_RECOVERED}${NC}" | tee -a "$LOG_FILE"
echo -e "${YELLOW}  ⏭  Skipped:   ${COUNT_SKIPPED}${NC}" | tee -a "$LOG_FILE"
echo -e "${YELLOW}  ⚠️  Conflicts: ${COUNT_CONFLICTS}${NC}" | tee -a "$LOG_FILE"
echo -e "${RED}  ❌ Failed:    ${COUNT_FAILED}${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
info "Full log: $LOG_FILE"
echo "" | tee -a "$LOG_FILE"

if [ $COUNT_FAILED -gt 0 ]; then
  exit 1
fi
exit 0
