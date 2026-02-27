#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# KelionAI v2 — Full Integration Pipeline (master orchestrator)
#
# Runs all integration steps in order:
#   1. recover-unmerged-prs.sh    — recover closed PRs #101..#110
#   2. integrate-orphan-branches.sh — integrate all copilot/* branches
#   3. deploy-and-verify.sh       — deploy to Railway + verify
#   4. Final consolidated report
#
# Usage:
#   bash scripts/full-pipeline.sh [--dry-run] [--skip-deploy] [--skip-recovery]
#
# Flags:
#   --dry-run        Simulate all steps without making real changes
#   --skip-deploy    Skip the deploy-and-verify step
#   --skip-recovery  Skip the PR recovery step
#   --base-url=URL   Override the verification base URL (default: https://kelionai.app)
#
# Environment:
#   GITHUB_TOKEN   — required for GitHub operations
#   RAILWAY_TOKEN  — required for Railway deploy (unless --skip-deploy)
#   GH_REPO        — owner/repo (defaults to adrianenc11-hue/kelionai-v2)
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

ok()     { echo -e "${GREEN}✅  $*${NC}" | tee -a "$LOG_FILE"; }
fail()   { echo -e "${RED}❌  $*${NC}" | tee -a "$LOG_FILE"; }
skip()   { echo -e "${YELLOW}⏭️   SKIP: $*${NC}" | tee -a "$LOG_FILE"; }
info()   { echo -e "${CYAN}ℹ️   $*${NC}" | tee -a "$LOG_FILE"; }
header() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════════════${NC}\n${BOLD}${CYAN}  $*${NC}\n${BOLD}${CYAN}══════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"; }

# ─── Defaults ────────────────────────────────────────────────────────────────
DRY_RUN=false
SKIP_DEPLOY=false
SKIP_RECOVERY=false
BASE_URL="https://kelionai.app"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p logs
LOG_FILE="logs/pipeline-${TIMESTAMP}.log"

# ─── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run)       DRY_RUN=true ;;
    --skip-deploy)   SKIP_DEPLOY=true ;;
    --skip-recovery) SKIP_RECOVERY=true ;;
    --base-url=*)    BASE_URL="${arg#--base-url=}" ;;
  esac
done

# Build pass-through flags for sub-scripts
PASSTHROUGH_FLAGS=()
[[ "$DRY_RUN" == "true" ]] && PASSTHROUGH_FLAGS+=(--dry-run)

# ─── Tool check ──────────────────────────────────────────────────────────────
for tool in git gh curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌  Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Pipeline state ──────────────────────────────────────────────────────────
STEP_RECOVERY_STATUS="SKIPPED"
STEP_INTEGRATION_STATUS="PENDING"
STEP_DEPLOY_STATUS="SKIPPED"
PIPELINE_START=$(date +%s)

# ─── Banner ──────────────────────────────────────────────────────────────────
header "KelionAI v2 — Full Integration Pipeline"
info "Timestamp : $TIMESTAMP"
info "Log file  : $LOG_FILE"
info "Dry-run   : $DRY_RUN"
info "Skip deploy   : $SKIP_DEPLOY"
info "Skip recovery : $SKIP_RECOVERY"
info "Base URL      : $BASE_URL"

# ─── Step 1: Recover unmerged PRs ────────────────────────────────────────────
header "Step 1 / 3 — Recover Unmerged PRs"

if [[ "$SKIP_RECOVERY" == "true" ]]; then
  skip "PR recovery step skipped (--skip-recovery)"
  STEP_RECOVERY_STATUS="SKIPPED"
else
  info "Running: recover-unmerged-prs.sh ${PASSTHROUGH_FLAGS[*]:-}"

  bash "${SCRIPT_DIR}/recover-unmerged-prs.sh" "${PASSTHROUGH_FLAGS[@]:-}" 2>&1 | tee -a "$LOG_FILE"
  if [[ "${PIPESTATUS[0]}" -eq 0 ]]; then
    ok "Step 1 complete: PR recovery succeeded"
    STEP_RECOVERY_STATUS="PASS"
  else
    fail "Step 1 failed: PR recovery exited with non-zero code"
    STEP_RECOVERY_STATUS="FAIL"
    # Continue pipeline — integration and deploy should still run
    info "Continuing pipeline despite recovery failure..."
  fi
fi

# ─── Step 2: Integrate orphan branches ───────────────────────────────────────
header "Step 2 / 3 — Integrate Orphan Branches"

info "Running: integrate-orphan-branches.sh ${PASSTHROUGH_FLAGS[*]:-}"

bash "${SCRIPT_DIR}/integrate-orphan-branches.sh" "${PASSTHROUGH_FLAGS[@]:-}" 2>&1 | tee -a "$LOG_FILE"
if [[ "${PIPESTATUS[0]}" -eq 0 ]]; then
  ok "Step 2 complete: Branch integration succeeded"
  STEP_INTEGRATION_STATUS="PASS"
else
  fail "Step 2 failed: Integration exited with non-zero code"
  STEP_INTEGRATION_STATUS="FAIL"
  info "Continuing pipeline despite integration failure..."
fi

# ─── Step 3: Deploy and verify ───────────────────────────────────────────────
header "Step 3 / 3 — Deploy and Verify"

if [[ "$SKIP_DEPLOY" == "true" ]]; then
  skip "Deploy step skipped (--skip-deploy)"
  STEP_DEPLOY_STATUS="SKIPPED"
else
  deploy_args=("${PASSTHROUGH_FLAGS[@]:-}")
  deploy_args+=("--base-url=${BASE_URL}")

  info "Running: deploy-and-verify.sh ${deploy_args[*]:-}"

  bash "${SCRIPT_DIR}/deploy-and-verify.sh" "${deploy_args[@]:-}" 2>&1 | tee -a "$LOG_FILE"
  if [[ "${PIPESTATUS[0]}" -eq 0 ]]; then
    ok "Step 3 complete: Deploy and verification succeeded"
    STEP_DEPLOY_STATUS="PASS"
  else
    fail "Step 3 failed: Deploy/verification exited with non-zero code"
    STEP_DEPLOY_STATUS="FAIL"
  fi
fi

# ─── Final consolidated report ───────────────────────────────────────────────
header "Final Pipeline Report"

PIPELINE_END=$(date +%s)
PIPELINE_DURATION=$((PIPELINE_END - PIPELINE_START))

format_status() {
  case "$1" in
    PASS)    echo -e "${GREEN}PASS${NC}" ;;
    FAIL)    echo -e "${RED}FAIL${NC}" ;;
    SKIPPED) echo -e "${YELLOW}SKIPPED${NC}" ;;
    *)       echo -e "${CYAN}$1${NC}" ;;
  esac
}

echo ""
echo -e "${BOLD}Pipeline Results${NC}" | tee -a "$LOG_FILE"
echo -e "─────────────────────────────────────────────────" | tee -a "$LOG_FILE"
printf "  %-35s %s\n" "Step 1: Recover unmerged PRs"     "$(format_status "$STEP_RECOVERY_STATUS")"    | tee -a "$LOG_FILE"
printf "  %-35s %s\n" "Step 2: Integrate orphan branches" "$(format_status "$STEP_INTEGRATION_STATUS")" | tee -a "$LOG_FILE"
printf "  %-35s %s\n" "Step 3: Deploy & verify"           "$(format_status "$STEP_DEPLOY_STATUS")"      | tee -a "$LOG_FILE"
echo -e "─────────────────────────────────────────────────" | tee -a "$LOG_FILE"
echo -e "  Total duration: ${PIPELINE_DURATION}s" | tee -a "$LOG_FILE"
echo -e "  Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Determine overall exit code
OVERALL_FAIL=false
for status in "$STEP_RECOVERY_STATUS" "$STEP_INTEGRATION_STATUS" "$STEP_DEPLOY_STATUS"; do
  [[ "$status" == "FAIL" ]] && OVERALL_FAIL=true
done

if [[ "$OVERALL_FAIL" == "true" ]]; then
  fail "Pipeline completed with failures"
  exit 1
else
  ok "Pipeline completed successfully"
  exit 0
fi
