#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2.3 — Redeploy rapid
# Utilizare: bash scripts/deploy.sh  sau  npm run deploy
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

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
step() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}   KelionAI v2.3 — Redeploy rapid                 ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

# ─── 1. Git status ────────────────────────────────────────────
step "Verificare modificări Git"
GIT_STATUS=$(git status --porcelain 2>/dev/null)
if [ -z "$GIT_STATUS" ]; then
    info "Nu există modificări noi. Forțez redeploy..."
    COMMIT_MSG=""
else
    echo -e "${CYAN}Fișiere modificate:${NC}"
    git status --short
    echo ""
    read -r -p "Mesaj commit (Enter pentru mesaj automat): " COMMIT_MSG
    if [ -z "$COMMIT_MSG" ]; then
        COMMIT_MSG="deploy: actualizare $(date '+%Y-%m-%d %H:%M')"
    fi
fi

# ─── 2. Git add + commit + push ───────────────────────────────
step "Push la GitHub"
if [ -n "$GIT_STATUS" ]; then
    git add .
    git commit -m "${COMMIT_MSG}"
    ok "Commit creat: ${COMMIT_MSG}"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "master")
git push origin "$BRANCH"
ok "Push la GitHub (branch: $BRANCH)"

# ─── 3. Declanșează deploy Railway ────────────────────────────
step "Deploy Railway"
if command -v railway &>/dev/null; then
    if railway whoami &>/dev/null 2>&1; then
        info "Pornesc deploy pe Railway..."
        railway up --detach
        ok "Deploy Railway pornit"
    else
        info "Nu ești autentificat în Railway. Deploy se face automat din GitHub push."
    fi
else
    info "Railway CLI nu este instalat. Deploy se face automat din GitHub push."
fi

# ─── 4. Așteaptă deploy ───────────────────────────────────────
step "Așteptare finalizare deploy"
info "Aștept ca deploy-ul să fie disponibil (maxim 3 minute)..."
MAX_WAIT=180
INTERVAL=10
ELAPSED=0
DEPLOY_OK=false

while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    echo -ne "${CYAN}  ⏳ ${ELAPSED}s / ${MAX_WAIT}s...${NC}\r"

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://kelionai.app/api/health" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo ""
        ok "Aplicația răspunde după ${ELAPSED}s!"
        DEPLOY_OK=true
        break
    fi
done

echo ""
if [ "$DEPLOY_OK" = false ]; then
    warn "Timeout — aplicația nu răspunde încă pe kelionai.app"
    warn "Verifică starea în: https://railway.app/dashboard"
fi

# ─── 5. Health check ──────────────────────────────────────────
step "Verificare stare aplicație"
bash "$SCRIPT_DIR/health-check.sh" || true

# ─── Sumar ────────────────────────────────────────────────────
echo ""
if [ "$DEPLOY_OK" = true ]; then
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${GREEN}   ✅ Deploy finalizat cu succes!                 ${NC}"
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
else
    echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${YELLOW}   ⚠️  Deploy în curs — verifică mai târziu       ${NC}"
    echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════════${NC}"
fi
echo ""
echo -e "  🌐 ${CYAN}https://kelionai.app${NC}"
echo -e "  📊 ${CYAN}https://railway.app/dashboard${NC}"
echo ""
