#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# KelionAI v2 — Deploy and Verify
#
# Triggers a Railway deployment (via CLI), waits for the health endpoint to
# become ready, then runs a full suite of verification checks.
#
# Usage:
#   bash scripts/deploy-and-verify.sh [--dry-run] [--skip-deploy] [--base-url URL]
#
# Environment:
#   RAILWAY_TOKEN  — required for deployment (unless --skip-deploy)
#   BASE_URL       — override base URL (default: https://kelionai.app)
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

ok()     { echo -e "${GREEN}✅  $*${NC}" | tee -a "$LOG_FILE"; PASS=$((PASS + 1)); }
fail()   { echo -e "${RED}❌  $*${NC}" | tee -a "$LOG_FILE"; FAIL=$((FAIL + 1)); }
skip()   { echo -e "${YELLOW}⏭️   SKIP: $*${NC}" | tee -a "$LOG_FILE"; }
info()   { echo -e "${CYAN}ℹ️   $*${NC}" | tee -a "$LOG_FILE"; }
warn()   { echo -e "${YELLOW}⚠️   $*${NC}" | tee -a "$LOG_FILE"; }
header() { echo -e "\n${BOLD}${CYAN}══ $* ══${NC}" | tee -a "$LOG_FILE"; }

# ─── Defaults ────────────────────────────────────────────────────────────────
DRY_RUN=false
SKIP_DEPLOY=false
BASE_URL="${BASE_URL:-https://kelionai.app}"
DEPLOY_TIMEOUT=300       # seconds to wait for Railway deploy
HEALTH_POLL_INTERVAL=10  # seconds between health check polls
RESPONSE_TIME_LIMIT=3    # seconds — max acceptable response time
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p logs
LOG_FILE="logs/deploy-verify-${TIMESTAMP}.log"
PASS=0
FAIL=0

# ─── Parse args ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --dry-run)        DRY_RUN=true ;;
    --skip-deploy)    SKIP_DEPLOY=true ;;
    --base-url=*)     BASE_URL="${arg#*=}" ;;
  esac
done

# ─── Tool check ──────────────────────────────────────────────────────────────
for tool in curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌  Required tool not found: $tool${NC}"
    exit 1
  fi
done

if [[ "$DRY_RUN" == "true" ]]; then
  info "DRY-RUN mode enabled — skipping deploy and using mock checks"
fi

header "KelionAI v2 — Deploy & Verify"
info "Base URL : $BASE_URL"
info "Log file : $LOG_FILE"
info "Timestamp: $TIMESTAMP"

# ─── Helper: timed curl ───────────────────────────────────────────────────────
# check_endpoint METHOD PATH DESCRIPTION [EXPECTED_CODE] [BODY]
# Returns PASS/FAIL and also checks response time.
check_endpoint() {
  local method="$1"
  local path="$2"
  local description="$3"
  local expected_code="${4:-200}"
  local body="${5:-}"

  local url="${BASE_URL}${path}"
  local response_file
  response_file=$(mktemp)
  local http_code elapsed

  local curl_args=(
    -s -o "$response_file" -w "%{http_code} %{time_total}"
    --max-time 15
    -X "$method"
    -H "Content-Type: application/json"
  )

  if [[ -n "$body" ]]; then
    curl_args+=(-d "$body")
  fi

  local result
  result=$(curl "${curl_args[@]}" "$url" 2>/dev/null || echo "000 0")
  http_code=$(echo "$result" | awk '{print $1}')
  elapsed=$(echo "$result" | awk '{print $2}')

  rm -f "$response_file"

  # Validate HTTP code
  if [[ "$http_code" == "000" ]]; then
    fail "[$http_code] $method $path — $description (connection failed)"
    return
  fi

  if [[ "$http_code" != "$expected_code" ]]; then
    fail "[$http_code] $method $path — $description (expected: $expected_code)"
    return
  fi

  # Validate response time
  local elapsed_int
  elapsed_int=$(echo "$elapsed" | awk '{printf "%d", $1}')
  if [[ "$elapsed_int" -ge "$RESPONSE_TIME_LIMIT" ]]; then
    warn "[$http_code] $method $path — $description (${elapsed}s — over ${RESPONSE_TIME_LIMIT}s threshold)"
    FAIL=$((FAIL + 1))
    return
  fi

  ok "[$http_code] $method $path — $description (${elapsed}s)"
}

# ─── Step 1: Deploy to Railway ───────────────────────────────────────────────
header "Step 1: Deploy to Railway"

if [[ "$SKIP_DEPLOY" == "true" ]]; then
  skip "Deploy step skipped (--skip-deploy)"
elif [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would run: railway up --detach"
else
  if ! command -v railway &>/dev/null; then
    info "Installing Railway CLI..."
    npm install -g @railway/cli 2>>"$LOG_FILE" || {
      fail "Failed to install Railway CLI"
      exit 1
    }
  fi

  if [[ -z "${RAILWAY_TOKEN:-}" ]]; then
    fail "RAILWAY_TOKEN is not set — cannot deploy"
    exit 1
  fi

  info "Triggering Railway deploy..."
  if railway up --detach 2>>"$LOG_FILE"; then
    ok "Railway deploy triggered"
  else
    fail "Railway deploy command failed"
    exit 1
  fi
fi

# ─── Step 2: Wait for health endpoint ────────────────────────────────────────
header "Step 2: Waiting for health endpoint"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would poll $BASE_URL/api/health"
else
  elapsed_wait=0
  info "Polling $BASE_URL/api/health (timeout: ${DEPLOY_TIMEOUT}s)..."

  while true; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 "$BASE_URL/api/health" 2>/dev/null || echo "000")

    if [[ "$http_code" == "200" ]]; then
      ok "Health endpoint returned 200 after ${elapsed_wait}s"
      break
    fi

    elapsed_wait=$((elapsed_wait + HEALTH_POLL_INTERVAL))
    if [[ "$elapsed_wait" -ge "$DEPLOY_TIMEOUT" ]]; then
      fail "Health check timed out after ${DEPLOY_TIMEOUT}s (last code: $http_code)"
      exit 1
    fi

    info "Still waiting... ${elapsed_wait}s / ${DEPLOY_TIMEOUT}s (last: $http_code)"
    sleep "$HEALTH_POLL_INTERVAL"
  done
fi

# ─── Step 3: Verification checks ─────────────────────────────────────────────
header "Step 3: Verification checks"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would run all verification checks against $BASE_URL"
else

  echo -e "\n${BOLD}${BLUE}▶ Core endpoints${NC}" | tee -a "$LOG_FILE"
  check_endpoint "GET"  "/api/health"         "Health check — must return 200"        "200"
  check_endpoint "GET"  "/"                   "Homepage"                              "200"

  echo -e "\n${BOLD}${BLUE}▶ API endpoints${NC}" | tee -a "$LOG_FILE"
  check_endpoint "GET"  "/api/payments/plans" "Payment plans"                         "200"
  check_endpoint "GET"  "/api/legal/terms"    "Legal terms"                           "200"
  check_endpoint "GET"  "/api/legal/privacy"  "Privacy policy"                        "200"

  echo -e "\n${BOLD}${BLUE}▶ Auth (expect 401 without token)${NC}" | tee -a "$LOG_FILE"
  check_endpoint "GET"  "/api/user/profile"   "User profile — unauthenticated"        "401"
  check_endpoint "GET"  "/api/user/memory"    "User memory — unauthenticated"         "401"

  echo -e "\n${BOLD}${BLUE}▶ No 5xx on key routes${NC}" | tee -a "$LOG_FILE"
  for path in "/api/health" "/" "/api/payments/plans" "/api/legal/terms"; do
    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time 10 "${BASE_URL}${path}" 2>/dev/null || echo "000")
    if [[ "${http_code:0:1}" == "5" ]]; then
      fail "5xx detected on $path ($http_code)"
    else
      ok "No 5xx on $path ($http_code)"
    fi
  done

fi

# ─── Summary ─────────────────────────────────────────────────────────────────
header "Verification Summary"
TOTAL=$((PASS + FAIL))

echo -e "${GREEN}  PASS: $PASS / $TOTAL${NC}" | tee -a "$LOG_FILE"
echo -e "${RED}  FAIL: $FAIL / $TOTAL${NC}"   | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"
info "Full log: $LOG_FILE"

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] All checks simulated — no real requests made"
  exit 0
fi

if [[ $FAIL -eq 0 ]]; then
  echo -e "${BOLD}${GREEN}  ✅ All checks passed!${NC}" | tee -a "$LOG_FILE"
  exit 0
else
  echo -e "${BOLD}${RED}  ❌ $FAIL check(s) failed.${NC}" | tee -a "$LOG_FILE"
  exit 1
fi
