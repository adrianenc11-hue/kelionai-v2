#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2.5 — Application health check
# Usage: bash scripts/health-check.sh  or  npm run health
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✅ $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
info() { echo -e "${CYAN}ℹ️  $1${NC}"; }

BASE_URL="${1:-https://kelionai.app}"
TIMEOUT=10
PASS=0
FAIL=0

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}   KelionAI v2.5 — Application health check       ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""
info "Checking endpoints at: $BASE_URL"
echo ""

# ─── Endpoint check function ──────────────────────────────────
check_endpoint() {
    local method="$1"
    local path="$2"
    local description="$3"
    local expected_code="${4:-200}"

    local url="${BASE_URL}${path}"
    local http_code

    http_code=$(curl -s -o /dev/null -w "%{http_code}" \
        --max-time "$TIMEOUT" \
        -X "$method" \
        -H "Content-Type: application/json" \
        "$url" 2>/dev/null || echo "000")

    if [ "$http_code" = "$expected_code" ]; then
        ok "[$http_code] $method $path — $description"
        PASS=$((PASS + 1))
    elif [ "$http_code" = "000" ]; then
        err "[TIMEOUT/ERR] $method $path — $description (connection failed)"
        FAIL=$((FAIL + 1))
    else
        err "[$http_code] $method $path — $description (expected: $expected_code)"
        FAIL=$((FAIL + 1))
    fi
}

# ─── Main endpoints ───────────────────────────────────────────
echo -e "${BOLD}${BLUE}▶ Main endpoints${NC}"
check_endpoint "GET"  "/api/health"         "Health check"
check_endpoint "GET"  "/api/payments/plans" "Payment plans"
check_endpoint "GET"  "/api/legal/terms"    "Terms and conditions"
check_endpoint "GET"  "/api/legal/privacy"  "Privacy policy"

echo ""
echo -e "${BOLD}${BLUE}▶ Additional endpoints${NC}"
check_endpoint "GET"  "/"                   "Main frontend"
check_endpoint "GET"  "/metrics"            "Prometheus metrics" "200"

# ─── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
    echo -e "${BOLD}${GREEN}   ✅ All checks passed ($PASS/$TOTAL)${NC}"
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
    echo ""
    exit 0
else
    echo -e "${BOLD}${RED}   ❌ $FAIL checks failed out of $TOTAL${NC}"
    echo -e "${BOLD}${RED}══════════════════════════════════════════════════${NC}"
    echo ""
    if [ $FAIL -eq $TOTAL ]; then
        warn "Application is not accessible. Check:"
        echo -e "  • Railway deploy: ${CYAN}https://railway.app/dashboard${NC}"
        echo -e "  • Server logs: ${CYAN}railway logs${NC}"
    else
        warn "Some endpoints are not working. Check the logs."
    fi
    echo ""
    exit 1
fi
