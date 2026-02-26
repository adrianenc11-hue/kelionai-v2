#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2.3 — Verificare stare aplicație (health check)
# Utilizare: bash scripts/health-check.sh  sau  npm run health
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

# ─── Culori ───────────────────────────────────────────────────
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
echo -e "${BOLD}${CYAN}   KelionAI v2.3 — Verificare stare aplicație     ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""
info "Verificare endpoint-uri pe: $BASE_URL"
echo ""

# ─── Funcție verificare endpoint ──────────────────────────────
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
        err "[TIMEOUT/ERR] $method $path — $description (conexiune eșuată)"
        FAIL=$((FAIL + 1))
    else
        err "[$http_code] $method $path — $description (așteptat: $expected_code)"
        FAIL=$((FAIL + 1))
    fi
}

# ─── Verificare endpoint-uri principale ───────────────────────
echo -e "${BOLD}${BLUE}▶ Endpoint-uri principale${NC}"
check_endpoint "GET"  "/api/health"         "Health check"
check_endpoint "GET"  "/api/payments/plans" "Planuri plată"
check_endpoint "GET"  "/api/legal/terms"    "Termeni și condiții"
check_endpoint "GET"  "/api/legal/privacy"  "Politica de confidențialitate"

echo ""
echo -e "${BOLD}${BLUE}▶ Endpoint-uri suplimentare${NC}"
check_endpoint "GET"  "/"                   "Frontend principal"
check_endpoint "GET"  "/metrics"            "Metrici Prometheus" "200"

# ─── Sumar ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
TOTAL=$((PASS + FAIL))
if [ $FAIL -eq 0 ]; then
    echo -e "${BOLD}${GREEN}   ✅ Toate verificările au trecut ($PASS/$TOTAL)${NC}"
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
    echo ""
    exit 0
else
    echo -e "${BOLD}${RED}   ❌ $FAIL verificări eșuate din $TOTAL${NC}"
    echo -e "${BOLD}${RED}══════════════════════════════════════════════════${NC}"
    echo ""
    if [ $FAIL -eq $TOTAL ]; then
        warn "Aplicația nu este accesibilă. Verifică:"
        echo -e "  • Deploy-ul Railway: ${CYAN}https://railway.app/dashboard${NC}"
        echo -e "  • Log-urile serverului: ${CYAN}railway logs${NC}"
    else
        warn "Unele endpoint-uri nu funcționează. Verifică log-urile."
    fi
    echo ""
    exit 1
fi
