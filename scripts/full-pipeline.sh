#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2 — Full Integration Pipeline
# Master orchestrator: recover PRs → integrate branches → deploy & verify.
#
# Usage:
#   bash scripts/full-pipeline.sh [OPTIONS]
#
# Options:
#   --dry-run        Simulate all steps without making changes
#   --skip-deploy    Skip the deploy-and-verify step
#   --skip-recovery  Skip the PR recovery step
#   --base-url URL   Override the verification base URL (default: https://kelionai.app)
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

# ─── Parse arguments ───────────────────────────────────────────
DRY_RUN=false
SKIP_DEPLOY=false
SKIP_RECOVERY=false
BASE_URL="https://kelionai.app"

for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=true ;;
    --skip-deploy)    SKIP_DEPLOY=true ;;
    --skip-recovery)  SKIP_RECOVERY=true ;;
    --base-url=*)     BASE_URL="${arg#--base-url=}" ;;
  esac
done

# ─── Setup logging ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="$LOG_DIR/pipeline-${TIMESTAMP}.log"

# ─── Logging helpers (write to stdout AND log file) ────────────
log() { echo -e "$1" | tee -a "$LOG_FILE"; }
ok()   { log "${GREEN}✅ $1${NC}"; }
err()  { log "${RED}❌ $1${NC}"; }
warn() { log "${YELLOW}⚠️  $1${NC}"; }
info() { log "${CYAN}ℹ️  $1${NC}"; }
step() { log "\n${BOLD}${BLUE}══ STEP: $1 ══${NC}"; }

# ─── Check required tools ──────────────────────────────────────
for tool in git gh curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌ Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Pipeline state ────────────────────────────────────────────
STEP_RECOVERY_STATUS="SKIPPED"
STEP_INTEGRATION_STATUS="SKIPPED"
STEP_DEPLOY_STATUS="SKIPPED"
PIPELINE_EXIT_CODE=0

_build_flags() {
  local flags=""
  [ "$DRY_RUN" = true ] && flags="$flags --dry-run"
  echo "$flags"
}

# ─── Banner ────────────────────────────────────────────────────
log ""
log "${BOLD}${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
log "${BOLD}${CYAN}║   KelionAI v2 — Full Integration Pipeline             ║${NC}"
log "${BOLD}${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
if [ "$DRY_RUN" = true ]; then
  log "${YELLOW}   🔍 DRY RUN MODE — no changes will be made${NC}"
fi
log ""
info "Pipeline log: $LOG_FILE"
info "Timestamp:    $TIMESTAMP"
log ""
info "Configuration:"
info "  --dry-run:       $DRY_RUN"
info "  --skip-deploy:   $SKIP_DEPLOY"
info "  --skip-recovery: $SKIP_RECOVERY"
info "  --base-url:      $BASE_URL"
log ""

PIPELINE_START=$(date +%s)

# ─── Step 1: Recover unmerged PRs ─────────────────────────────
step "1/3 — Recover Unmerged PRs"
if [ "$SKIP_RECOVERY" = true ]; then
  warn "Skipping PR recovery (--skip-recovery flag set)"
  STEP_RECOVERY_STATUS="SKIPPED"
else
  FLAGS="$(_build_flags)"
  if bash "$SCRIPT_DIR/recover-unmerged-prs.sh" $FLAGS 2>&1 | tee -a "$LOG_FILE"; then
    ok "PR recovery completed successfully"
    STEP_RECOVERY_STATUS="PASS"
  else
    RC=$?
    err "PR recovery finished with exit code $RC (some PRs may have failed)"
    STEP_RECOVERY_STATUS="PARTIAL"
    # Non-fatal — continue to integration
  fi
fi

# ─── Step 2: Integrate orphan branches ────────────────────────
step "2/3 — Integrate Orphan Branches"
FLAGS="$(_build_flags)"
if bash "$SCRIPT_DIR/integrate-orphan-branches.sh" $FLAGS 2>&1 | tee -a "$LOG_FILE"; then
  ok "Branch integration completed successfully"
  STEP_INTEGRATION_STATUS="PASS"
else
  RC=$?
  err "Branch integration finished with exit code $RC (some branches may have conflicts)"
  STEP_INTEGRATION_STATUS="PARTIAL"
  PIPELINE_EXIT_CODE=1
fi

# ─── Step 3: Deploy & Verify ───────────────────────────────────
step "3/3 — Deploy & Verify"
if [ "$SKIP_DEPLOY" = true ]; then
  warn "Skipping deploy (--skip-deploy flag set)"
  STEP_DEPLOY_STATUS="SKIPPED"
else
  FLAGS="$(_build_flags)"
  if bash "$SCRIPT_DIR/deploy-and-verify.sh" $FLAGS "$BASE_URL" 2>&1 | tee -a "$LOG_FILE"; then
    ok "Deploy & verify completed successfully"
    STEP_DEPLOY_STATUS="PASS"
  else
    RC=$?
    err "Deploy & verify failed with exit code $RC"
    STEP_DEPLOY_STATUS="FAIL"
    PIPELINE_EXIT_CODE=1
  fi
fi

# ─── Final report ─────────────────────────────────────────────
PIPELINE_END=$(date +%s)
PIPELINE_DURATION=$((PIPELINE_END - PIPELINE_START))

log ""
log "${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
log "${BOLD}║   Pipeline Final Report                               ║${NC}"
log "${BOLD}╚══════════════════════════════════════════════════════╝${NC}"

_status_icon() {
  case "$1" in
    PASS)    echo -e "${GREEN}✅ PASS${NC}" ;;
    FAIL)    echo -e "${RED}❌ FAIL${NC}" ;;
    PARTIAL) echo -e "${YELLOW}⚠️  PARTIAL${NC}" ;;
    SKIPPED) echo -e "${YELLOW}⏭  SKIPPED${NC}" ;;
    *)       echo -e "${CYAN}❓ UNKNOWN${NC}" ;;
  esac
}

log ""
log "  Step 1 — Recover PRs:         $(_status_icon "$STEP_RECOVERY_STATUS")"
log "  Step 2 — Integrate branches:  $(_status_icon "$STEP_INTEGRATION_STATUS")"
log "  Step 3 — Deploy & Verify:     $(_status_icon "$STEP_DEPLOY_STATUS")"
log ""
log "  Duration: ${PIPELINE_DURATION}s"
log "  Log file: $LOG_FILE"
log ""

if [ $PIPELINE_EXIT_CODE -eq 0 ]; then
  log "${BOLD}${GREEN}══════════════════════════════════════════════════════${NC}"
  log "${BOLD}${GREEN}   ✅ Pipeline completed successfully!                 ${NC}"
  log "${BOLD}${GREEN}══════════════════════════════════════════════════════${NC}"
else
  log "${BOLD}${RED}══════════════════════════════════════════════════════${NC}"
  log "${BOLD}${RED}   ❌ Pipeline completed with errors. See log above.    ${NC}"
  log "${BOLD}${RED}══════════════════════════════════════════════════════${NC}"
fi
log ""

exit $PIPELINE_EXIT_CODE
