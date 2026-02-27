#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# KelionAI v2 — Integrate Orphan Branches
#
# Integrates all copilot/* branches into a single integration/all-features
# branch, then opens a PR to master.
#
# Features:
#   • Deduplication — for branches like *-again, *-another-one, uses only
#     the one with the most recent commit
#   • Already-merged detection — skips branches already in master
#   • Conflict auto-resolution — NEVER skips a branch due to conflicts;
#     uses theirs / file-by-file / force strategies in order
#   • Detailed logs for every merge attempt and resolution
#
# Usage:
#   bash scripts/integrate-orphan-branches.sh [--dry-run] [--recreate-integration]
#
# Environment:
#   GITHUB_TOKEN  — required
#   GH_REPO       — owner/repo (defaults to adrianenc11-hue/kelionai-v2)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()       { echo -e "${GREEN}✅  $*${NC}" | tee -a "$LOG_FILE"; }
fail()     { echo -e "${RED}❌  $*${NC}" | tee -a "$LOG_FILE"; }
skip()     { echo -e "${YELLOW}⏭️   SKIP: $*${NC}" | tee -a "$LOG_FILE"; }
info()     { echo -e "${CYAN}ℹ️   $*${NC}" | tee -a "$LOG_FILE"; }
conflict() { echo -e "${BLUE}🔀  CONFLICT: $*${NC}" | tee -a "$LOG_FILE"; }
header()   { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}" | tee -a "$LOG_FILE"; }

# ─── Defaults ────────────────────────────────────────────────────────────────
DRY_RUN=false
RECREATE_INTEGRATION=false
GH_REPO="${GH_REPO:-adrianenc11-hue/kelionai-v2}"
INTEGRATION_BRANCH="integration/all-features"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p logs conflicts
LOG_FILE="logs/integrate-branches-${TIMESTAMP}.log"
CONFLICT_LOG="logs/conflict-resolution-${TIMESTAMP}.log"

# ─── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run)              DRY_RUN=true ;;
    --recreate-integration) RECREATE_INTEGRATION=true ;;
  esac
done

# ─── Tool check ──────────────────────────────────────────────────────────────
for tool in git gh curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    fail "Required tool not found: $tool"
    exit 1
  fi
done

if [[ "$DRY_RUN" == "true" ]]; then
  info "DRY-RUN mode enabled — no changes will be made"
fi

# ─── Summary counters ────────────────────────────────────────────────────────
MERGED_CLEAN=0
MERGED_CONFLICT=0
SKIPPED_MERGED=0
SKIPPED_DUPLICATE=0
ERRORS=0

# ─── Helpers ─────────────────────────────────────────────────────────────────

remote_branch_exists() {
  git ls-remote --exit-code --heads origin "$1" &>/dev/null
}

already_merged_into_master() {
  local branch="$1"
  git merge-base --is-ancestor "origin/$branch" origin/master 2>/dev/null
}

# Return the Unix timestamp of the latest commit on a remote branch
branch_commit_time() {
  git log -1 --format="%ct" "origin/$1" 2>/dev/null || echo "0"
}

# Auto-resolve conflicts; $1 = branch being merged
auto_resolve_conflicts() {
  local branch_name="$1"
  local conflict_dir="conflicts/${branch_name//\//_}"

  echo "$(date '+%Y-%m-%d %H:%M:%S') — Resolving conflicts for branch: $branch_name" >> "$CONFLICT_LOG"

  conflict "Attempting -X theirs strategy for $branch_name"

  # ── Strategy A: -X theirs ────────────────────────────────────────────────
  # We need to redo the merge with -X theirs because we're already in a
  # conflicted state — abort first, then retry.
  git merge --abort 2>/dev/null || true

  if git merge -X theirs "origin/$branch_name" --no-edit \
       -m "Auto-resolved conflicts for $branch_name (strategy: theirs)" 2>>/dev/null; then
    conflict "  ✓ Resolved with -X theirs for $branch_name"
    echo "  Strategy: -X theirs — SUCCESS" >> "$CONFLICT_LOG"
    return 0
  fi

  # ── Strategy B: file-by-file ─────────────────────────────────────────────
  conflict "  Strategy A failed — file-by-file resolution for $branch_name"
  git merge --abort 2>/dev/null || true
  git merge --no-commit --no-ff "origin/$branch_name" 2>/dev/null || true

  local conflicted_files
  conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null || echo "")

  mkdir -p "$conflict_dir"

  if [[ -n "$conflicted_files" ]]; then
    while IFS= read -r file; do
      [[ -z "$file" ]] && continue
      local ext="${file##*.}"
      conflict "    Resolving: $file (.$ext)"

      # Save both versions
      git show ":2:$file" > "${conflict_dir}/${file//\//_}.master"  2>/dev/null || true
      git show ":3:$file" > "${conflict_dir}/${file//\//_}.feature" 2>/dev/null || true

      case "$ext" in
        yml|yaml)
          git checkout --theirs -- "$file" 2>/dev/null || true
          echo "  $file: accept-feature-branch (YAML)" >> "$CONFLICT_LOG"
          ;;
        css)
          {
            git show ":2:$file" 2>/dev/null || true
            echo ""
            echo "/* ── Feature branch styles (${branch_name}) ── */"
            git show ":3:$file" 2>/dev/null || true
          } > "$file"
          echo "  $file: merged-both (CSS)" >> "$CONFLICT_LOG"
          ;;
        html)
          git checkout --theirs -- "$file" 2>/dev/null || true
          echo "  $file: accept-feature-branch (HTML)" >> "$CONFLICT_LOG"
          ;;
        js|ts)
          git checkout --theirs -- "$file" 2>/dev/null || true
          echo "  $file: accept-feature-branch (JS/TS)" >> "$CONFLICT_LOG"
          ;;
        json)
          git checkout --theirs -- "$file" 2>/dev/null || true
          echo "  $file: accept-feature-branch (JSON)" >> "$CONFLICT_LOG"
          ;;
        *)
          git checkout --theirs -- "$file" 2>/dev/null || true
          echo "  $file: accept-feature-branch (default)" >> "$CONFLICT_LOG"
          ;;
      esac

      git add "$file" 2>/dev/null || true
    done <<< "$conflicted_files"
  fi

  # ── Strategy C: force-accept feature branch for any remaining ────────────
  local remaining
  remaining=$(git diff --name-only --diff-filter=U 2>/dev/null || echo "")
  if [[ -n "$remaining" ]]; then
    conflict "  Forcing feature-branch acceptance for remaining files"
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      git checkout --theirs -- "$f" 2>/dev/null || true
      git add "$f" 2>/dev/null || true
      echo "  $f: force-feature-branch" >> "$CONFLICT_LOG"
    done <<< "$remaining"
  fi

  # Commit
  if git diff --cached --quiet 2>/dev/null; then
    info "  Nothing to commit after conflict resolution for $branch_name"
  else
    git commit -m "Auto-resolved conflicts for $branch_name" 2>/dev/null || true
  fi

  echo "  RESOLUTION COMPLETE" >> "$CONFLICT_LOG"
  return 0
}

# ─── Step 1: Fetch all remote branches ───────────────────────────────────────
header "Fetching remote branches"
git fetch origin --quiet
git fetch origin master --quiet

# Collect all copilot/* branches
mapfile -t ALL_COPILOT < <(git branch -r | grep 'origin/copilot/' | sed 's|.*origin/||' | sort)

if [[ ${#ALL_COPILOT[@]} -eq 0 ]]; then
  info "No copilot/* branches found."
  exit 0
fi

info "Found ${#ALL_COPILOT[@]} copilot/* branches"

# ─── Step 2: Deduplicate branches ────────────────────────────────────────────
# Group branches by their "base feature name" (strip suffixes: -again,
# -another-one, -journal, -layers, -v2, -new, -fix, etc.)
header "Deduplication analysis"

declare -A BASE_TO_BRANCHES  # base_name → space-separated list of branch names
declare -A CANONICAL          # branch → canonical branch to use (or self)

strip_suffix() {
  local name="$1"
  # Remove trailing -again, -another-one, -journal, -layers, -new, -fix, -v2,
  # -again-[anything], -second, -third, -redo, -retry, -updated
  echo "$name" | sed -E \
    's/(-again(-[a-z0-9-]+)?|-another-one|-journal|-layers|-new|-fix|-v2|-second|-third|-redo|-retry|-updated)$//'
}

for branch in "${ALL_COPILOT[@]}"; do
  base=$(strip_suffix "$branch")
  if [[ -v BASE_TO_BRANCHES["$base"] ]]; then
    BASE_TO_BRANCHES["$base"]="${BASE_TO_BRANCHES[$base]} $branch"
  else
    BASE_TO_BRANCHES["$base"]="$branch"
  fi
done

# For each group, pick the branch with the most recent commit
declare -A SKIP_DUPLICATE  # branch → 1 if should be skipped as duplicate

for base in "${!BASE_TO_BRANCHES[@]}"; do
  IFS=' ' read -ra group <<< "${BASE_TO_BRANCHES[$base]}"
  if [[ ${#group[@]} -eq 1 ]]; then
    continue  # no duplicates
  fi

  # Find the newest branch in the group
  newest=""
  newest_time=0
  for b in "${group[@]}"; do
    t=$(branch_commit_time "$b")
    if [[ "$t" -gt "$newest_time" ]]; then
      newest_time="$t"
      newest="$b"
    fi
  done

  # Mark all others as duplicates
  for b in "${group[@]}"; do
    if [[ "$b" != "$newest" ]]; then
      SKIP_DUPLICATE["$b"]=1
      skip "$b is a duplicate of $newest (using latest)"
      SKIPPED_DUPLICATE=$((SKIPPED_DUPLICATE + 1))
    fi
  done
done

# Build final list of branches to integrate
BRANCHES_TO_INTEGRATE=()
for branch in "${ALL_COPILOT[@]}"; do
  if [[ -v SKIP_DUPLICATE["$branch"] ]]; then
    continue
  fi
  if already_merged_into_master "$branch"; then
    skip "$branch is already merged into master"
    SKIPPED_MERGED=$((SKIPPED_MERGED + 1))
    continue
  fi
  BRANCHES_TO_INTEGRATE+=("$branch")
done

info "${#BRANCHES_TO_INTEGRATE[@]} branches to integrate after deduplication"

# ─── Step 3: Prepare integration branch ──────────────────────────────────────
header "Preparing integration branch: $INTEGRATION_BRANCH"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would create/reset $INTEGRATION_BRANCH from master"
else
  if remote_branch_exists "$INTEGRATION_BRANCH"; then
    if [[ "$RECREATE_INTEGRATION" == "true" ]]; then
      info "Deleting existing $INTEGRATION_BRANCH (--recreate-integration)"
      git push origin --delete "$INTEGRATION_BRANCH" 2>/dev/null || true
    else
      info "Integration branch already exists — reusing it"
    fi
  fi

  # Create or reset the integration branch locally
  git checkout -B "$INTEGRATION_BRANCH" origin/master 2>/dev/null || \
    git checkout -b "$INTEGRATION_BRANCH" origin/master

  ok "Integration branch ready: $INTEGRATION_BRANCH"
fi

# ─── Step 4: Merge each branch ───────────────────────────────────────────────
header "Merging branches into $INTEGRATION_BRANCH"

for branch in "${BRANCHES_TO_INTEGRATE[@]}"; do
  info "Merging: $branch"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[DRY-RUN] Would merge origin/$branch"
    MERGED_CLEAN=$((MERGED_CLEAN + 1))
    continue
  fi

  git fetch origin "$branch" --quiet 2>/dev/null || true

  # Re-check already merged (in case integration branch already has it)
  if git merge-base --is-ancestor "origin/$branch" HEAD 2>/dev/null; then
    skip "$branch is already in integration branch HEAD"
    SKIPPED_MERGED=$((SKIPPED_MERGED + 1))
    continue
  fi

  if git merge --no-edit -m "Merge $branch into $INTEGRATION_BRANCH" "origin/$branch" 2>/dev/null; then
    ok "Clean merge: $branch"
    MERGED_CLEAN=$((MERGED_CLEAN + 1))
  else
    conflict "Conflicts detected when merging $branch — starting auto-resolution"
    auto_resolve_conflicts "$branch"
    ok "Merged with conflict resolution: $branch"
    MERGED_CONFLICT=$((MERGED_CONFLICT + 1))
  fi
done

# ─── Step 5: Push integration branch ─────────────────────────────────────────
header "Pushing integration branch"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would push $INTEGRATION_BRANCH to origin"
else
  git push -u origin "$INTEGRATION_BRANCH" --force-with-lease 2>>"$LOG_FILE"
  ok "Pushed: $INTEGRATION_BRANCH"
fi

# ─── Step 6: Open PR to master ───────────────────────────────────────────────
header "Opening PR: $INTEGRATION_BRANCH → master"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would open PR from $INTEGRATION_BRANCH → master"
else
  # Deduplication check: open PR already exists?
  open_count=$(gh pr list --repo "$GH_REPO" \
    --head "$INTEGRATION_BRANCH" --base master --state open \
    --json number --jq 'length' 2>/dev/null || echo "0")

  if [[ "$open_count" -gt 0 ]]; then
    skip "PR already exists for $INTEGRATION_BRANCH → master"
  else
    pr_body="## Integration of all orphan copilot/* branches

This PR was automatically created by \`scripts/integrate-orphan-branches.sh\`.

### Stats
| Status | Count |
|--------|-------|
| Merged (clean) | ${MERGED_CLEAN} |
| Merged (conflict resolved) | ${MERGED_CONFLICT} |
| Skipped (already merged) | ${SKIPPED_MERGED} |
| Skipped (duplicate) | ${SKIPPED_DUPLICATE} |

### Conflict resolution log
See \`logs/conflict-resolution-${TIMESTAMP}.log\` in the artifacts for details.

### Branches integrated
$(printf -- '- %s\n' "${BRANCHES_TO_INTEGRATE[@]}")"

    if gh pr create \
         --repo "$GH_REPO" \
         --head "$INTEGRATION_BRANCH" \
         --base master \
         --title "Integrate all orphan copilot/* branches" \
         --body "$pr_body" 2>>"$LOG_FILE"; then
      ok "PR created: $INTEGRATION_BRANCH → master"
    else
      fail "Failed to create integration PR"
      ERRORS=$((ERRORS + 1))
    fi
  fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
header "Integration Summary"
echo -e "${GREEN}  Merged (clean)             : $MERGED_CLEAN${NC}"    | tee -a "$LOG_FILE"
echo -e "${BLUE}  Merged (conflict resolved) : $MERGED_CONFLICT${NC}"  | tee -a "$LOG_FILE"
echo -e "${YELLOW}  Skipped (already merged)  : $SKIPPED_MERGED${NC}"  | tee -a "$LOG_FILE"
echo -e "${YELLOW}  Skipped (duplicate)       : $SKIPPED_DUPLICATE${NC}" | tee -a "$LOG_FILE"
echo -e "${RED}  Errors                    : $ERRORS${NC}"             | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
info "Full log: $LOG_FILE"
info "Conflict resolution log: $CONFLICT_LOG"

if [[ $ERRORS -gt 0 ]]; then
  exit 1
fi
exit 0
