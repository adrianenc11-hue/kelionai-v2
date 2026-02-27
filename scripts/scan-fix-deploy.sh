#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# KelionAI v2 — Scan → Fix → Deploy Pipeline
#
# Orchestrates the full scan-fix-deploy cycle:
#   1. Run scan-and-fix-live.sh (live site scan)
#   2. If problems found → run auto-fix.sh (code fixes + PR)
#   3. If PR created and --auto-merge → merge the PR
#   4. Unless --skip-deploy → trigger Railway redeploy
#   5. Wait for health endpoint to become ready
#   6. Re-run scan-and-fix-live.sh (post-deploy verification)
#   7. If still failing → open a GitHub Issue alert
#   8. Print final PASS / FAIL report
#
# Usage:
#   bash scripts/scan-fix-deploy.sh \
#     [--dry-run] [--skip-deploy] [--auto-merge] [--base-url=URL]
#
# Flags:
#   --dry-run      Simulate all steps without making real changes
#   --skip-deploy  Skip the Railway deploy step
#   --auto-merge   Automatically merge the auto-fix PR if created
#   --base-url=URL Override the scan base URL (default: https://kelionai.app)
#
# Environment:
#   GITHUB_TOKEN   — required for GitHub operations (PR, Issue)
#   RAILWAY_TOKEN  — required for Railway deploy (unless --skip-deploy)
#   GH_REPO        — owner/repo  (default: adrianenc11-hue/kelionai-v2)
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

# ─── Paths & timestamps ───────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p logs reports
LOG_FILE="logs/scan-fix-deploy-${TIMESTAMP}.log"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()    { echo -e "$*" | tee -a "$LOG_FILE"; }
ok()     { log "${GREEN}✅  $*${NC}"; }
fail()   { log "${RED}❌  $*${NC}"; }
warn()   { log "${YELLOW}⚠️   $*${NC}"; }
skip()   { log "${YELLOW}⏭️   SKIP: $*${NC}"; }
info()   { log "${CYAN}ℹ️   $*${NC}"; }
header() { log "\n${BOLD}${CYAN}══════════════════════════════════════════════════${NC}\n${BOLD}${CYAN}  $*${NC}\n${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"; }

# ─── Defaults ────────────────────────────────────────────────────────────────
DRY_RUN=false
SKIP_DEPLOY=false
AUTO_MERGE=false
BASE_URL="${BASE_URL:-https://kelionai.app}"
GH_REPO="${GH_REPO:-adrianenc11-hue/kelionai-v2}"
DEPLOY_TIMEOUT=300
HEALTH_POLL_INTERVAL=15

# Step statuses
STEP_SCAN1_STATUS="PENDING"
STEP_AUTOFIX_STATUS="SKIPPED"
STEP_MERGE_STATUS="SKIPPED"
STEP_DEPLOY_STATUS="SKIPPED"
STEP_SCAN2_STATUS="SKIPPED"

PIPELINE_START=$(date +%s)

# ─── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run)     DRY_RUN=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    --auto-merge)  AUTO_MERGE=true ;;
    --base-url=*)  BASE_URL="${arg#*=}" ;;
  esac
done

# Build pass-through flags for sub-scripts
SCAN_FLAGS=()
FIX_FLAGS=()
[[ "$DRY_RUN" == "true" ]] && SCAN_FLAGS+=(--dry-run) && FIX_FLAGS+=(--dry-run)
SCAN_FLAGS+=(--base-url="$BASE_URL")

# ─── Tool check ──────────────────────────────────────────────────────────────
for tool in curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌  Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Banner ──────────────────────────────────────────────────────────────────
header "KelionAI v2 — Scan → Fix → Deploy Pipeline"
info "Timestamp  : $TIMESTAMP_ISO"
info "Log        : $LOG_FILE"
info "Base URL   : $BASE_URL"
info "Dry-run    : $DRY_RUN"
info "Skip-deploy: $SKIP_DEPLOY"
info "Auto-merge : $AUTO_MERGE"

# ═════════════════════════════════════════════════════════════════════════════
# STEP 1 — Initial live scan
# ═════════════════════════════════════════════════════════════════════════════
header "Step 1 / 6 — Initial Live Scan"

scan1_exit=0
bash "${SCRIPT_DIR}/scan-and-fix-live.sh" "${SCAN_FLAGS[@]}" 2>&1 | tee -a "$LOG_FILE" \
  || scan1_exit=$?

if [[ "$scan1_exit" -eq 0 ]]; then
  ok "Step 1: Scan passed — no issues detected"
  STEP_SCAN1_STATUS="PASS"
else
  warn "Step 1: Scan found issues (exit $scan1_exit)"
  STEP_SCAN1_STATUS="FAIL"
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 2 — Auto-fix (only if scan found issues)
# ═════════════════════════════════════════════════════════════════════════════
header "Step 2 / 6 — Auto-Fix"

PR_URL=""
PR_NUMBER=""

if [[ "$STEP_SCAN1_STATUS" == "PASS" ]]; then
  skip "No issues found — auto-fix not needed"
  STEP_AUTOFIX_STATUS="SKIPPED"
else
  fix_exit=0
  bash "${SCRIPT_DIR}/auto-fix.sh" "${FIX_FLAGS[@]}" 2>&1 | tee -a "$LOG_FILE" \
    || fix_exit=$?

  if [[ -f /tmp/auto-fix-pr.env ]]; then
    # shellcheck disable=SC1091
    source /tmp/auto-fix-pr.env
    rm -f /tmp/auto-fix-pr.env
    ok "Step 2: Auto-fix applied — PR: $PR_URL"
    STEP_AUTOFIX_STATUS="PASS"
  elif [[ "$fix_exit" -eq 0 ]]; then
    ok "Step 2: Auto-fix ran (no PR created — no code changes needed)"
    STEP_AUTOFIX_STATUS="PASS"
  else
    warn "Step 2: Auto-fix exited with code $fix_exit"
    STEP_AUTOFIX_STATUS="FAIL"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 3 — Merge PR (if auto-merge flag and PR was created)
# ═════════════════════════════════════════════════════════════════════════════
header "Step 3 / 6 — Merge Auto-Fix PR"

if [[ -z "$PR_NUMBER" ]]; then
  skip "No PR was created — merge step skipped"
  STEP_MERGE_STATUS="SKIPPED"
elif [[ "$AUTO_MERGE" != "true" ]]; then
  skip "Auto-merge disabled — skipping merge of PR #${PR_NUMBER}"
  STEP_MERGE_STATUS="SKIPPED"
elif [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would merge PR #${PR_NUMBER}"
  STEP_MERGE_STATUS="SKIPPED"
else
  if command -v gh &>/dev/null; then
    merge_exit=0
    gh pr merge "$PR_NUMBER" \
      --repo "$GH_REPO" \
      --squash \
      --auto \
      --delete-branch 2>&1 | tee -a "$LOG_FILE" || merge_exit=$?
    if [[ "$merge_exit" -eq 0 ]]; then
      ok "Step 3: PR #${PR_NUMBER} merged"
      STEP_MERGE_STATUS="PASS"
    else
      warn "Step 3: Could not merge PR #${PR_NUMBER} (exit $merge_exit)"
      STEP_MERGE_STATUS="FAIL"
    fi
  else
    warn "gh CLI not available — cannot auto-merge PR"
    STEP_MERGE_STATUS="FAIL"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 4 — Railway redeploy
# ═════════════════════════════════════════════════════════════════════════════
header "Step 4 / 6 — Railway Redeploy"

if [[ "$SKIP_DEPLOY" == "true" ]]; then
  skip "Deploy skipped (--skip-deploy)"
  STEP_DEPLOY_STATUS="SKIPPED"
elif [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would trigger Railway redeploy"
  STEP_DEPLOY_STATUS="SKIPPED"
else
  if ! command -v railway &>/dev/null; then
    info "Installing Railway CLI..."
    npm install -g @railway/cli 2>>"$LOG_FILE" || true
  fi

  if command -v railway &>/dev/null; then
    if [[ -z "${RAILWAY_TOKEN:-}" ]]; then
      warn "RAILWAY_TOKEN not set — skipping deploy"
      STEP_DEPLOY_STATUS="SKIPPED"
    else
      deploy_exit=0
      railway up --detach 2>&1 | tee -a "$LOG_FILE" || deploy_exit=$?
      if [[ "$deploy_exit" -eq 0 ]]; then
        ok "Step 4: Railway deploy triggered"
        STEP_DEPLOY_STATUS="PASS"
      else
        warn "Step 4: Railway deploy failed (exit $deploy_exit)"
        STEP_DEPLOY_STATUS="FAIL"
      fi
    fi
  else
    warn "Railway CLI not available — deploy skipped"
    STEP_DEPLOY_STATUS="SKIPPED"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 5 — Wait for health endpoint
# ═════════════════════════════════════════════════════════════════════════════
header "Step 5 / 6 — Wait for Health Endpoint"

if [[ "$STEP_DEPLOY_STATUS" != "PASS" ]]; then
  skip "Deploy did not run — skipping health wait"
elif [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would poll $BASE_URL/api/health"
else
  elapsed_wait=0
  info "Polling $BASE_URL/api/health (timeout: ${DEPLOY_TIMEOUT}s)..."

  while true; do
    hc=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 "${BASE_URL}/api/health" 2>/dev/null || echo "000")
    if [[ "$hc" == "200" ]]; then
      ok "Health endpoint ready after ${elapsed_wait}s"
      break
    fi
    elapsed_wait=$((elapsed_wait + HEALTH_POLL_INTERVAL))
    if [[ "$elapsed_wait" -ge "$DEPLOY_TIMEOUT" ]]; then
      warn "Health check timed out after ${DEPLOY_TIMEOUT}s (last: $hc)"
      break
    fi
    info "Waiting... ${elapsed_wait}s/${DEPLOY_TIMEOUT}s (last: $hc)"
    sleep "$HEALTH_POLL_INTERVAL"
  done
fi

# ═════════════════════════════════════════════════════════════════════════════
# STEP 6 — Post-deploy scan (verification)
# ═════════════════════════════════════════════════════════════════════════════
header "Step 6 / 6 — Post-Deploy Verification Scan"

scan2_exit=0
bash "${SCRIPT_DIR}/scan-and-fix-live.sh" "${SCAN_FLAGS[@]}" 2>&1 | tee -a "$LOG_FILE" \
  || scan2_exit=$?

if [[ "$scan2_exit" -eq 0 ]]; then
  ok "Step 6: Post-deploy scan PASSED"
  STEP_SCAN2_STATUS="PASS"
else
  fail "Step 6: Post-deploy scan still has failures (exit $scan2_exit)"
  STEP_SCAN2_STATUS="FAIL"

  # ── Open a GitHub Issue alert if scan still fails ──────────────────────────
  if [[ "$DRY_RUN" != "true" ]] && command -v gh &>/dev/null; then
    LATEST_REPORT=$(ls -t reports/live-scan-*.json 2>/dev/null | head -1 || true)
    FAIL_DETAILS=""
    if [[ -n "$LATEST_REPORT" ]]; then
      FAIL_DETAILS=$(jq -r '.issues[] | "- [\(.severity | ascii_upcase)] \(.description) — \(.url)"' \
        "$LATEST_REPORT" 2>/dev/null || true)
    fi

    ISSUE_BODY="## 🚨 Scan-Fix-Deploy Alert

**Pipeline run:** \`${TIMESTAMP_ISO}\`  
**Base URL:** \`${BASE_URL}\`  
**Log:** \`${LOG_FILE}\`

Post-deploy verification scan still reports failures.  
Manual intervention required.

### Remaining Issues
${FAIL_DETAILS:-_See latest scan report._}

### Pipeline Steps
| Step | Status |
|------|--------|
| Step 1 — Initial scan      | $STEP_SCAN1_STATUS |
| Step 2 — Auto-fix          | $STEP_AUTOFIX_STATUS |
| Step 3 — PR merge          | $STEP_MERGE_STATUS |
| Step 4 — Railway deploy    | $STEP_DEPLOY_STATUS |
| Step 6 — Post-deploy scan  | $STEP_SCAN2_STATUS |

> This issue was created automatically by \`scripts/scan-fix-deploy.sh\`.
"
    issue_exit=0
    gh issue create \
      --repo "$GH_REPO" \
      --title "🚨 scan-fix-deploy: post-deploy failures detected (${TIMESTAMP})" \
      --body "$ISSUE_BODY" \
      --label "bug" 2>&1 | tee -a "$LOG_FILE" || issue_exit=$?

    if [[ "$issue_exit" -eq 0 ]]; then
      warn "GitHub Issue created — see above for URL"
    else
      warn "Could not create GitHub Issue (exit $issue_exit)"
    fi
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# FINAL REPORT
# ═════════════════════════════════════════════════════════════════════════════
header "Final Pipeline Report"

PIPELINE_END=$(date +%s)
PIPELINE_DURATION=$((PIPELINE_END - PIPELINE_START))

format_status() {
  case "$1" in
    PASS)    echo -e "${GREEN}PASS${NC}" ;;
    FAIL)    echo -e "${RED}FAIL${NC}" ;;
    SKIPPED) echo -e "${YELLOW}SKIPPED${NC}" ;;
    PENDING) echo -e "${CYAN}PENDING${NC}" ;;
    *)       echo -e "${CYAN}$1${NC}" ;;
  esac
}

log ""
log "${BOLD}Pipeline Results${NC}"
log "─────────────────────────────────────────────────"
printf "  %-40s %s\n" "Step 1: Initial live scan" \
  "$(format_status "$STEP_SCAN1_STATUS")"   | tee -a "$LOG_FILE"
printf "  %-40s %s\n" "Step 2: Auto-fix" \
  "$(format_status "$STEP_AUTOFIX_STATUS")" | tee -a "$LOG_FILE"
printf "  %-40s %s\n" "Step 3: Merge PR" \
  "$(format_status "$STEP_MERGE_STATUS")"   | tee -a "$LOG_FILE"
printf "  %-40s %s\n" "Step 4: Railway redeploy" \
  "$(format_status "$STEP_DEPLOY_STATUS")"  | tee -a "$LOG_FILE"
printf "  %-40s %s\n" "Step 6: Post-deploy scan" \
  "$(format_status "$STEP_SCAN2_STATUS")"   | tee -a "$LOG_FILE"
log "─────────────────────────────────────────────────"
info "Total duration : ${PIPELINE_DURATION}s"
info "Log file       : $LOG_FILE"
log ""

OVERALL_FAIL=false
# Pipeline is considered failed if the post-deploy scan fails, or if auto-fix
# or deploy was attempted and failed (SKIPPED is acceptable).
for status in "$STEP_SCAN2_STATUS" "$STEP_AUTOFIX_STATUS" "$STEP_DEPLOY_STATUS"; do
  [[ "$status" == "FAIL" ]] && OVERALL_FAIL=true
done

if [[ "$OVERALL_FAIL" == "true" ]]; then
  log "${BOLD}${RED}  ❌ Pipeline completed with failures — manual review required${NC}"
  exit 1
else
  log "${BOLD}${GREEN}  ✅ Pipeline completed successfully — site is healthy!${NC}"
  exit 0
fi
