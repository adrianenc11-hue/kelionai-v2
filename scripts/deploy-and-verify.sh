#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2 — Deploy & Verify
# Triggers a Railway deploy and runs a full live verification
# of the production environment.
#
# Usage: bash scripts/deploy-and-verify.sh [--dry-run] [--skip-deploy] [BASE_URL]
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
step() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}" | tee -a "$LOG_FILE"; }

# ─── Parse arguments ───────────────────────────────────────────
DRY_RUN=false
SKIP_DEPLOY=false
BASE_URL="https://kelionai.app"

for arg in "$@"; do
  case "$arg" in
    --dry-run)     DRY_RUN=true ;;
    --skip-deploy) SKIP_DEPLOY=true ;;
    http://*|https://*) BASE_URL="$arg" ;;
  esac
done

# ─── Setup logging ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
LOG_FILE="$LOG_DIR/deploy-verify-${TIMESTAMP}.log"

# ─── Check required tools ──────────────────────────────────────
for tool in curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌ Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Verification counters ─────────────────────────────────────
PASS=0
FAIL=0
MAX_RESPONSE_TIME_MS=3000
TIMEOUT_S=10

# ─── Banner ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}${CYAN}   KelionAI v2 — Deploy & Verify                      ${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}   🔍 DRY RUN MODE — no changes will be made            ${NC}" | tee -a "$LOG_FILE"
  echo -e "${YELLOW}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
fi
echo "" | tee -a "$LOG_FILE"
info "Target URL: $BASE_URL"
info "Log file:   $LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# ─── 1. Deploy to Railway ──────────────────────────────────────
step "Deploy to Railway"
if [ "$SKIP_DEPLOY" = true ]; then
  info "Skipping deploy (--skip-deploy flag set)"
elif [ "$DRY_RUN" = true ]; then
  info "[dry-run] Would trigger Railway deploy"
else
  if command -v railway &>/dev/null; then
    if railway whoami &>/dev/null 2>&1; then
      info "Triggering Railway deploy..."
      railway up --detach 2>&1 | tee -a "$LOG_FILE"
      ok "Railway deploy triggered"
    else
      warn "Not authenticated with Railway CLI. Deploy triggered by push."
    fi
  else
    info "Railway CLI not installed. Deploy triggered by push to master."
  fi
fi

# ─── 2. Wait for deployment to be ready ───────────────────────
step "Waiting for deployment to be ready"
if [ "$DRY_RUN" = true ]; then
  info "[dry-run] Would poll $BASE_URL/api/health until 200"
else
  MAX_WAIT=300
  INTERVAL=10
  ELAPSED=0
  DEPLOY_OK=false

  info "Polling $BASE_URL/api/health (max ${MAX_WAIT}s)..."
  while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    echo -ne "${CYAN}  ⏳ ${ELAPSED}s / ${MAX_WAIT}s...${NC}\r"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      --max-time "$TIMEOUT_S" \
      "$BASE_URL/api/health" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      echo ""
      ok "App responding after ${ELAPSED}s"
      DEPLOY_OK=true
      break
    fi
  done
  echo ""

  if [ "$DEPLOY_OK" = false ]; then
    warn "Timeout — app not responding yet on $BASE_URL"
    warn "Check Railway dashboard: https://railway.app/dashboard"
  fi
fi

# ─── Helper: check_endpoint ───────────────────────────────────
# Usage: check_endpoint METHOD PATH DESCRIPTION [EXPECTED_CODE] [BODY_PATTERN]
check_endpoint() {
  local method="$1"
  local path="$2"
  local description="$3"
  local expected_code="${4:-200}"
  local body_pattern="${5:-}"
  local url="${BASE_URL}${path}"

  if [ "$DRY_RUN" = true ]; then
    info "[dry-run] Would check: $method $url (expect $expected_code)"
    return 0
  fi

  # Measure response time (portable: seconds-level on BSD, ms on GNU)
  local start_s start_ns end_ns elapsed_ms
  start_s=$(date +%s)
  start_ns=$(date +%s%N 2>/dev/null || echo "${start_s}000000000")

  local http_code body
  body=$(curl -s -w "\n%{http_code}" \
    --max-time "$TIMEOUT_S" \
    -X "$method" \
    -H "Content-Type: application/json" \
    "$url" 2>/dev/null || echo -e "\n000")
  http_code=$(echo "$body" | tail -1)
  body=$(echo "$body" | head -n -1)

  end_ns=$(date +%s%N 2>/dev/null || echo "$(date +%s)000000000")
  elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
  # Fallback: if elapsed_ms is negative or nonsensical (BSD date), use seconds
  if [ "$elapsed_ms" -lt 0 ] || [ "$elapsed_ms" -gt 60000 ]; then
    elapsed_ms=$(( ($(date +%s) - start_s) * 1000 ))
  fi

  local time_ok=true
  if [ "$elapsed_ms" -gt "$MAX_RESPONSE_TIME_MS" ]; then
    time_ok=false
  fi

  # Check status code
  if [ "$http_code" = "000" ]; then
    err "[TIMEOUT/CONN] $method $path — $description"
    FAIL=$((FAIL + 1))
    return
  fi

  if [ "$http_code" != "$expected_code" ]; then
    err "[$http_code] $method $path — $description (expected: $expected_code)"
    FAIL=$((FAIL + 1))
    return
  fi

  # Check body pattern if given
  if [ -n "$body_pattern" ]; then
    if ! echo "$body" | grep -q "$body_pattern"; then
      err "[$http_code] $method $path — $description (body missing: $body_pattern)"
      FAIL=$((FAIL + 1))
      return
    fi
  fi

  # Check response time
  if [ "$time_ok" = false ]; then
    warn "[$http_code] $method $path — $description (slow: ${elapsed_ms}ms > ${MAX_RESPONSE_TIME_MS}ms)"
    PASS=$((PASS + 1))
  else
    ok "[$http_code] $method $path — $description (${elapsed_ms}ms)"
    PASS=$((PASS + 1))
  fi
}

# ─── 3. Verification checks ────────────────────────────────────
step "Running verification checks on $BASE_URL"

echo "" | tee -a "$LOG_FILE"
echo -e "${BOLD}${BLUE}  ▸ Core endpoints${NC}" | tee -a "$LOG_FILE"
check_endpoint "GET"  "/api/health"         "Health check"            "200" '"status"'
check_endpoint "GET"  "/"                   "Homepage"                "200"
check_endpoint "GET"  "/api/payments/plans" "Payment plans"           "200"
check_endpoint "GET"  "/api/legal/terms"    "Terms of service"        "200"
check_endpoint "GET"  "/api/legal/privacy"  "Privacy policy"          "200"

echo "" | tee -a "$LOG_FILE"
echo -e "${BOLD}${BLUE}  ▸ Auth endpoints (expect 400/401 without credentials)${NC}" | tee -a "$LOG_FILE"
check_endpoint "POST" "/api/auth/login"     "Login endpoint reachable" "400"
check_endpoint "POST" "/api/chat"           "Chat endpoint reachable"  "401"

echo "" | tee -a "$LOG_FILE"
echo -e "${BOLD}${BLUE}  ▸ No 5xx on main routes${NC}" | tee -a "$LOG_FILE"
for path in "/api/health" "/" "/api/payments/plans" "/api/legal/terms"; do
  if [ "$DRY_RUN" = false ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT_S" "${BASE_URL}${path}" 2>/dev/null || echo "000")
    if [[ "$code" =~ ^5 ]]; then
      err "5xx on $path: HTTP $code"
      FAIL=$((FAIL + 1))
    fi
  fi
done

echo "" | tee -a "$LOG_FILE"
echo -e "${BOLD}${BLUE}  ▸ SSL certificate${NC}" | tee -a "$LOG_FILE"
if [ "$DRY_RUN" = true ]; then
  info "[dry-run] Would check SSL certificate"
else
  DOMAIN=$(echo "$BASE_URL" | sed 's|https\?://||' | cut -d'/' -f1)
  if echo | timeout "$TIMEOUT_S" openssl s_client -connect "${DOMAIN}:443" -servername "$DOMAIN" 2>/dev/null | \
      openssl x509 -noout -checkend 0 &>/dev/null; then
    ok "SSL certificate valid for $DOMAIN"
    PASS=$((PASS + 1))
  else
    if [[ "$BASE_URL" == https://* ]]; then
      err "SSL certificate invalid or expired for $DOMAIN"
      FAIL=$((FAIL + 1))
    else
      info "Skipping SSL check (non-HTTPS URL)"
    fi
  fi
fi

# ─── 4. Summary ────────────────────────────────────────────────
echo "" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}   Verification Summary                                ${NC}" | tee -a "$LOG_FILE"
echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
TOTAL=$((PASS + FAIL))

if [ "$DRY_RUN" = true ]; then
  info "[dry-run] Verification skipped"
  echo -e "${BOLD}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
  exit 0
fi

if [ $FAIL -eq 0 ]; then
  echo -e "${BOLD}${GREEN}  ✅ All checks passed ($PASS/$TOTAL)${NC}" | tee -a "$LOG_FILE"
  echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  echo -e "  🌐 ${CYAN}$BASE_URL${NC}" | tee -a "$LOG_FILE"
  echo -e "  📋 Log: ${CYAN}$LOG_FILE${NC}" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  exit 0
else
  echo -e "${BOLD}${RED}  ❌ $FAIL check(s) failed out of $TOTAL${NC}" | tee -a "$LOG_FILE"
  echo -e "${BOLD}${RED}══════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  warn "Check Railway logs: https://railway.app/dashboard"
  echo -e "  📋 Log: ${CYAN}$LOG_FILE${NC}" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
  exit 1
fi
