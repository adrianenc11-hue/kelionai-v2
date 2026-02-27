#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2 — Integrate Orphan copilot/* Branches
# Lists all copilot/* branches, deduplicates, checks conflicts,
# and merges non-conflicting branches into integration/all-features.
#
# Usage: bash scripts/integrate-orphan-branches.sh [--dry-run]
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
LOG_FILE="$LOG_DIR/integrate-branches-${TIMESTAMP}.log"

# ─── Check required tools ──────────────────────────────────────
for tool in git gh curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌ Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Report counters ───────────────────────────────────────────
COUNT_MERGED=0
COUNT_SKIPPED_MERGED=0
COUNT_SKIPPED_DUPLICATE=0
COUNT_FAILED_CONFLICTS=0
COUNT_FAILED_OTHER=0

INTEGRATION_BRANCH="integration/all-features"

# ─── Banner ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}${CYAN}   KelionAI v2 — Integrate Orphan Branches            ${NC}" | tee -a "$LOG_FILE"
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

# ─── List all copilot/* branches ───────────────────────────────
step "Listing all copilot/* branches"
ALL_COPILOT_BRANCHES=()
while IFS= read -r branch; do
  branch="${branch#  }"
  branch="${branch#* }"
  branch="${branch//remotes\/origin\//}"
  branch="${branch// /}"
  if [[ "$branch" == copilot/* ]]; then
    ALL_COPILOT_BRANCHES+=("$branch")
  fi
done < <(git branch -r | grep 'copilot/' || true)

if [ ${#ALL_COPILOT_BRANCHES[@]} -eq 0 ]; then
  warn "No copilot/* branches found on remote."
  exit 0
fi

info "Found ${#ALL_COPILOT_BRANCHES[@]} copilot/* branches:"
for b in "${ALL_COPILOT_BRANCHES[@]}"; do
  echo "  - $b" | tee -a "$LOG_FILE"
done

# ─── Deduplicate: group branches by base feature name ──────────
# For branches ending in -again, -another-one, -again-one etc.,
# group them and keep only the one with the most recent commit.
step "Deduplicating branches (keeping latest per feature group)"

declare -A FEATURE_LATEST_BRANCH
declare -A FEATURE_LATEST_DATE
declare -A BRANCH_SKIP_REASON

_strip_suffix() {
  local name="$1"
  name="${name#copilot/}"
  # Remove duplicate suffixes in a loop until none remain
  local prev=""
  while [ "$name" != "$prev" ]; do
    prev="$name"
    name="${name%-again}"
    name="${name%-another-one}"
    name="${name%-journal}"
  done
  echo "$name"
}

for branch in "${ALL_COPILOT_BRANCHES[@]}"; do
  feature_key="$(_strip_suffix "$branch")"
  commit_date=$(git log -1 --format="%ct" "origin/$branch" 2>/dev/null || echo "0")

  if [ -z "${FEATURE_LATEST_BRANCH[$feature_key]+x}" ]; then
    FEATURE_LATEST_BRANCH["$feature_key"]="$branch"
    FEATURE_LATEST_DATE["$feature_key"]="$commit_date"
  else
    existing_date="${FEATURE_LATEST_DATE[$feature_key]}"
    if [ "$commit_date" -gt "$existing_date" ]; then
      # Mark old branch as duplicate
      old_branch="${FEATURE_LATEST_BRANCH[$feature_key]}"
      BRANCH_SKIP_REASON["$old_branch"]="duplicate of $branch (using latest)"
      FEATURE_LATEST_BRANCH["$feature_key"]="$branch"
      FEATURE_LATEST_DATE["$feature_key"]="$commit_date"
    else
      # Current branch is older — mark as duplicate
      BRANCH_SKIP_REASON["$branch"]="duplicate of ${FEATURE_LATEST_BRANCH[$feature_key]} (using latest)"
    fi
  fi
done

# Build the deduplicated list
DEDUPED_BRANCHES=()
for branch in "${ALL_COPILOT_BRANCHES[@]}"; do
  if [ -n "${BRANCH_SKIP_REASON[$branch]+x}" ]; then
    skip "$branch is a ${BRANCH_SKIP_REASON[$branch]}"
    COUNT_SKIPPED_DUPLICATE=$((COUNT_SKIPPED_DUPLICATE + 1))
  else
    DEDUPED_BRANCHES+=("$branch")
  fi
done

info "After deduplication: ${#DEDUPED_BRANCHES[@]} branches to process"

# ─── Check which branches are already merged into master ───────
step "Checking which branches are already merged into master"
TO_INTEGRATE=()
for branch in "${DEDUPED_BRANCHES[@]}"; do
  MERGE_BASE=$(git merge-base "origin/master" "origin/$branch" 2>/dev/null || echo "")
  BRANCH_SHA=$(git rev-parse "origin/$branch" 2>/dev/null || echo "")
  if [ -n "$MERGE_BASE" ] && [ "$MERGE_BASE" = "$BRANCH_SHA" ]; then
    skip "$branch is already merged into master"
    COUNT_SKIPPED_MERGED=$((COUNT_SKIPPED_MERGED + 1))
  else
    TO_INTEGRATE+=("$branch")
  fi
done

if [ ${#TO_INTEGRATE[@]} -eq 0 ]; then
  ok "All copilot branches are already merged into master. Nothing to do."
  exit 0
fi

info "${#TO_INTEGRATE[@]} branches to integrate:"
for b in "${TO_INTEGRATE[@]}"; do
  echo "  - $b" | tee -a "$LOG_FILE"
done

# ─── Create or reuse integration branch ────────────────────────
step "Preparing integration branch: $INTEGRATION_BRANCH"
if [ "$DRY_RUN" = true ]; then
  info "[dry-run] Would create branch $INTEGRATION_BRANCH from origin/master"
else
  if git ls-remote --exit-code --heads origin "$INTEGRATION_BRANCH" &>/dev/null; then
    warn "Branch $INTEGRATION_BRANCH already exists — deleting and recreating from master"
    git push origin --delete "$INTEGRATION_BRANCH" 2>&1 | tee -a "$LOG_FILE" || true
  fi
  git checkout -B "$INTEGRATION_BRANCH" origin/master 2>&1 | tee -a "$LOG_FILE"
  git push -u origin "$INTEGRATION_BRANCH" 2>&1 | tee -a "$LOG_FILE"
  ok "Integration branch created: $INTEGRATION_BRANCH"
fi

# ─── Merge each branch (with dry-run conflict check first) ─────
step "Merging branches into $INTEGRATION_BRANCH"

MERGED_BRANCHES=()
FAILED_BRANCHES=()

for branch in "${TO_INTEGRATE[@]}"; do
  info "Processing: $branch"

  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] Would attempt to merge $branch into $INTEGRATION_BRANCH"
    continue
  fi

  # Ensure we are on the integration branch
  git checkout "$INTEGRATION_BRANCH" 2>&1 | tee -a "$LOG_FILE"

  # Dry-run merge to detect conflicts
  MERGE_OK=true
  CONFLICT_FILES=""
  if ! git merge --no-commit --no-ff "origin/$branch" 2>&1 | tee -a "$LOG_FILE"; then
    CONFLICT_FILES=$(git diff --name-only --diff-filter=U 2>/dev/null | tr '\n' ', ')
    git merge --abort 2>/dev/null || true
    err "Conflicts in $branch — conflicting files: ${CONFLICT_FILES:-unknown}"
    FAILED_BRANCHES+=("$branch (conflicts: ${CONFLICT_FILES:-unknown})")
    COUNT_FAILED_CONFLICTS=$((COUNT_FAILED_CONFLICTS + 1))
    MERGE_OK=false
  else
    # Abort dry-run, redo as real merge
    git merge --abort 2>/dev/null || git reset --hard HEAD 2>/dev/null || true
  fi

  if [ "$MERGE_OK" = true ]; then
    # Real merge
    if git merge --no-ff "origin/$branch" -m "Integrate: $branch" 2>&1 | tee -a "$LOG_FILE"; then
      ok "Merged: $branch"
      MERGED_BRANCHES+=("$branch")
      COUNT_MERGED=$((COUNT_MERGED + 1))
    else
      git merge --abort 2>/dev/null || git reset --hard HEAD 2>/dev/null || true
      err "Merge failed unexpectedly for: $branch"
      FAILED_BRANCHES+=("$branch (merge error)")
      COUNT_FAILED_OTHER=$((COUNT_FAILED_OTHER + 1))
    fi
  fi
done

# ─── Push integration branch ───────────────────────────────────
if [ "$DRY_RUN" = false ] && [ ${#MERGED_BRANCHES[@]} -gt 0 ]; then
  step "Pushing $INTEGRATION_BRANCH"
  git push origin "$INTEGRATION_BRANCH" 2>&1 | tee -a "$LOG_FILE"
  ok "Pushed: $INTEGRATION_BRANCH"
fi

# ─── Create PR for integration branch ──────────────────────────
step "Creating PR for $INTEGRATION_BRANCH → master"
if [ "$DRY_RUN" = true ]; then
  info "[dry-run] Would check/create PR for $INTEGRATION_BRANCH → master"
else
  EXISTING_INT_PR=$(gh pr list --head "$INTEGRATION_BRANCH" --base master --state open --json number --jq '.[0].number' 2>/dev/null || echo "")
  if [ -n "$EXISTING_INT_PR" ]; then
    skip "PR already exists for $INTEGRATION_BRANCH → master (PR #${EXISTING_INT_PR})"
  else
    # Build merged list for PR body
    MERGED_LIST=""
    for b in "${MERGED_BRANCHES[@]}"; do
      MERGED_LIST="${MERGED_LIST}  - \`$b\`\n"
    done
    FAILED_LIST=""
    for b in "${FAILED_BRANCHES[@]}"; do
      FAILED_LIST="${FAILED_LIST}  - $b\n"
    done

    PR_BODY="## Integration of orphan copilot/* branches

This PR integrates all unmerged \`copilot/*\` branches that were not yet in \`master\`.

### ✅ Merged branches (${#MERGED_BRANCHES[@]})
${MERGED_LIST:-  _none_}

### ⚠️ Skipped due to conflicts (${#FAILED_BRANCHES[@]})
${FAILED_LIST:-  _none_}

### ⏭ Skipped — already merged in master (${COUNT_SKIPPED_MERGED})
### ⏭ Skipped — duplicates (${COUNT_SKIPPED_DUPLICATE})

🤖 Auto-generated by \`scripts/integrate-orphan-branches.sh\`"

    NEW_PR_URL=$(gh pr create \
      --title "Integration: all orphan copilot/* branches → master" \
      --body "$(echo -e "$PR_BODY")" \
      --head "$INTEGRATION_BRANCH" \
      --base master \
      --json url --jq '.url' 2>&1 | tee -a "$LOG_FILE" || echo "")
    if [ -n "$NEW_PR_URL" ] && [[ "$NEW_PR_URL" == http* ]]; then
      ok "Created integration PR: $NEW_PR_URL"
    else
      err "Failed to create integration PR"
    fi
  fi
fi

# ─── Summary ───────────────────────────────────────────────────
echo "" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}   Integration Summary                                 ${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${GREEN}  ✅ Merged:              ${COUNT_MERGED}${NC}" | tee -a "$LOG_FILE"
echo -e "${YELLOW}  ⏭  Skipped (merged):   ${COUNT_SKIPPED_MERGED}${NC}" | tee -a "$LOG_FILE"
echo -e "${YELLOW}  ⏭  Skipped (dup):      ${COUNT_SKIPPED_DUPLICATE}${NC}" | tee -a "$LOG_FILE"
echo -e "${RED}  ❌ Failed (conflicts): ${COUNT_FAILED_CONFLICTS}${NC}" | tee -a "$LOG_FILE"
echo -e "${RED}  ❌ Failed (other):     ${COUNT_FAILED_OTHER}${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
info "Full log: $LOG_FILE"
echo "" | tee -a "$LOG_FILE"

TOTAL_FAILED=$((COUNT_FAILED_CONFLICTS + COUNT_FAILED_OTHER))
if [ $TOTAL_FAILED -gt 0 ] && [ $COUNT_MERGED -eq 0 ]; then
  exit 1
fi
exit 0
