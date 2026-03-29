#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2.3 — Setup complet automat
# Rulează O SINGURĂ DATĂ pentru a configura totul de la zero.
# Utilizare: bash scripts/setup-full.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Culori ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ─── Helpers ──────────────────────────────────────────────────
ok()   { echo -e "${GREEN}✅ $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
info() { echo -e "${CYAN}ℹ️  $1${NC}"; }
step() { echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}   KelionAI v2.3 — Setup complet automat          ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

# ─── 1. Verifică Node.js ──────────────────────────────────────
step "Verificare Node.js"
if ! command -v node &>/dev/null; then
    err "Node.js nu este instalat. Descarcă de pe https://nodejs.org (versiunea 20+)"
    exit 1
fi
NODE_VER=$(node -v)
ok "Node.js $NODE_VER"

# ─── 2. Verifică fișierul .env ────────────────────────────────
step "Verificare fișier .env"
if [ ! -f "$PROJECT_DIR/.env" ]; then
    warn "Fișierul .env nu există. Îl creez din .env.example..."
    if [ -f "$PROJECT_DIR/.env.example" ]; then
        cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
        warn "Fișierul .env a fost creat. Editează-l cu cheile tale API înainte de a continua."
        warn "Rulează: nano .env"
        info "Sau folosește: npm run setup  (pentru configurare interactivă)"
        echo ""
        read -r -p "Apasă ENTER după ce ai completat .env, sau Ctrl+C pentru a anula... "
    else
        err ".env.example nu există. Nu pot crea .env automat."
        exit 1
    fi
fi
ok "Fișierul .env există"

# ─── 3. Instalare Railway CLI ─────────────────────────────────
step "Verificare Railway CLI"
if ! command -v railway &>/dev/null; then
    info "Railway CLI nu este instalat. Îl instalez acum..."
    if command -v npm &>/dev/null; then
        npm install -g @railway/cli
        ok "Railway CLI instalat via npm"
    elif command -v curl &>/dev/null; then
        bash <(curl -fsSL cli.new/railway)
        ok "Railway CLI instalat via curl"
    else
        err "Nu pot instala Railway CLI. Instalează manual: npm install -g @railway/cli"
        exit 1
    fi
else
    ok "Railway CLI: $(railway --version 2>/dev/null || echo 'instalat')"
fi

# ─── 4. Login Railway ─────────────────────────────────────────
step "Autentificare Railway"
if ! railway whoami &>/dev/null 2>&1; then
    info "Nu ești autentificat în Railway. Deschid browserul pentru login..."
    railway login
    ok "Autentificat în Railway"
else
    RAILWAY_USER=$(railway whoami 2>/dev/null || echo "utilizator")
    ok "Deja autentificat ca: $RAILWAY_USER"
fi

# ─── 5. Legare la proiectul Railway ───────────────────────────
step "Legare la proiectul Railway"
if [ ! -f "$PROJECT_DIR/.railway/config.json" ] && [ ! -f "$PROJECT_DIR/.railway" ]; then
    info "Leg proiectul la Railway (just-communication → kelionai-v2)..."
    cd "$PROJECT_DIR"
    railway link
    ok "Proiect legat la Railway"
else
    ok "Proiectul este deja legat la Railway"
fi
cd "$PROJECT_DIR"

# ─── 6. Trimite variabilele .env la Railway ───────────────────
step "Trimitere variabile de mediu la Railway"
info "Citesc .env și trimit variabilele la Railway..."

ENV_FILE="$PROJECT_DIR/.env"
VARS_SENT=0
VARS_SKIPPED=0

while IFS= read -r line || [ -n "$line" ]; do
    # Ignoră linii goale și comentarii
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    # Verifică formatul KEY=VALUE
    if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
        KEY="${line%%=*}"
        VALUE="${line#*=}"
        # Sare cheile template (conțin xxx sau sunt goale)
        if [[ "$VALUE" == *"xxx"* ]] || [[ -z "$VALUE" ]]; then
            VARS_SKIPPED=$((VARS_SKIPPED + 1))
            continue
        fi
        railway variables set "${KEY}=${VALUE}" --silent 2>/dev/null && \
            VARS_SENT=$((VARS_SENT + 1)) || \
            warn "Nu am putut seta variabila: $KEY"
    fi
done < "$ENV_FILE"

ok "Variabile trimise la Railway: $VARS_SENT (sărite: $VARS_SKIPPED template/goale)"

# ─── 7. Setup baza de date ────────────────────────────────────
step "Configurare bază de date Supabase"
bash "$SCRIPT_DIR/setup-db.sh" || {
    warn "Setup-ul bazei de date a eșuat. Continuă oricum cu deploy-ul."
}

# ─── 8. Instalare dependențe npm ──────────────────────────────
step "Instalare dependențe npm"
cd "$PROJECT_DIR"
npm install --silent
ok "Dependențe npm instalate"

# ─── 9. Deploy Railway ────────────────────────────────────────
step "Deploy pe Railway"
info "Pornesc deploy-ul pe Railway..."
cd "$PROJECT_DIR"
railway up --detach
ok "Deploy pornit"

# ─── 10. Așteaptă deploy ──────────────────────────────────────
step "Așteptare finalizare deploy"
info "Aștept ca deploy-ul să se finalizeze (maxim 3 minute)..."
MAX_WAIT=180
INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    echo -ne "${CYAN}  ⏳ Timp scurs: ${ELAPSED}s / ${MAX_WAIT}s...${NC}\r"

    # Verifică dacă aplicația răspunde
    if curl -sf --max-time 5 "https://kelionai.app/api/health" &>/dev/null; then
        echo ""
        ok "Deploy finalizat cu succes după ${ELAPSED}s!"
        break
    fi

    if [ $ELAPSED -ge $MAX_WAIT ]; then
        echo ""
        warn "Timeout așteptare deploy. Verifică manual starea în Railway dashboard."
    fi
done

echo ""

# ─── 11. Health checks ────────────────────────────────────────
step "Verificare stare aplicație"
bash "$SCRIPT_DIR/health-check.sh" || {
    warn "Unele endpoint-uri nu răspund încă. Verifică din nou în câteva minute."
}

# ─── Sumar final ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   ✅ Setup complet finalizat!                     ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  🌐 Aplicație: ${CYAN}https://kelionai.app${NC}"
echo -e "  📊 Railway:   ${CYAN}https://railway.app/dashboard${NC}"
echo -e "  🗄️  Supabase:  ${CYAN}https://supabase.com/dashboard${NC}"
echo ""
info "Pentru redeploy rapid: npm run deploy"
info "Pentru verificare sănătate: npm run health"
echo ""
