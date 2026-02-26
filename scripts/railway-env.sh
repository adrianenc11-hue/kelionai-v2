#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2 — Configurare automată Railway (Linux/Mac)
# Utilizare: bash scripts/railway-env.sh
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
ENV_EXAMPLE="$PROJECT_DIR/.env.example"
ENV_FILE="$PROJECT_DIR/.env"

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}   KelionAI v2 — Configurare automată Railway     ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

# ─── Lista variabile cerute ───────────────────────────────────
REQUIRED_VARS=(
    ANTHROPIC_API_KEY
    OPENAI_API_KEY
    DEEPSEEK_API_KEY
    ELEVENLABS_API_KEY
    GROQ_API_KEY
    PERPLEXITY_API_KEY
    TAVILY_API_KEY
    SERPER_API_KEY
    TOGETHER_API_KEY
    SUPABASE_URL
    SUPABASE_ANON_KEY
    SUPABASE_SERVICE_KEY
    SUPABASE_DB_PASSWORD
    DATABASE_URL
    STRIPE_SECRET_KEY
    STRIPE_WEBHOOK_SECRET
    STRIPE_PRICE_PRO
    STRIPE_PRICE_PREMIUM
    SENTRY_DSN
    GRAFANA_PROM_URL
    GRAFANA_PROM_USER
    GRAFANA_PROM_PASS
    PORT
    NODE_ENV
    LOG_LEVEL
    APP_URL
    ALLOWED_ORIGINS
    GOOGLE_MAPS_KEY
    ADMIN_TOKEN
)

# ─── Funcție: citește o variabilă din fișier .env ─────────────
get_env_value() {
    local key="$1"
    local file="$2"
    if [ ! -f "$file" ]; then echo ""; return; fi
    local val
    val=$(grep -m1 "^${key}=" "$file" 2>/dev/null | cut -d'=' -f2- || echo "")
    echo "$val"
}

# ─── Funcție: verifică dacă valoarea e placeholder ───────────
is_placeholder() {
    local val="$1"
    if [ -z "$val" ]; then return 0; fi
    local placeholders=(
        "xxx" "xxxx" "placeholder" "sk-ant-api03-xxx"
        "sk-proj-xxx" "sk-xxx" "sk_xxx" "gsk_xxx"
        "pplx-xxx" "tvly-xxx" "whsec_xxx" "price_xxx"
    )
    for p in "${placeholders[@]}"; do
        if [[ "$val" == *"$p"* ]]; then return 0; fi
    done
    return 1
}

# ─── 1. Verifică / instalează Railway CLI ────────────────────
step "1. Verificare Railway CLI"
if ! command -v railway &>/dev/null; then
    warn "Railway CLI nu este instalat. Instalez automat..."
    npm i -g @railway/cli
    ok "Railway CLI instalat"
else
    RAILWAY_VER=$(railway --version 2>/dev/null || echo "necunoscut")
    ok "Railway CLI detectat: $RAILWAY_VER"
fi

# ─── 2. Login Railway ────────────────────────────────────────
step "2. Autentificare Railway"
if railway whoami &>/dev/null 2>&1; then
    CURRENT_USER=$(railway whoami 2>/dev/null || echo "utilizator necunoscut")
    ok "Deja autentificat ca: $CURRENT_USER"
else
    info "Se deschide browserul pentru autentificare Railway..."
    railway login
    ok "Autentificat în Railway"
fi

# ─── 3. Link proiect ─────────────────────────────────────────
step "3. Linkare proiect Railway"
info "Legarea proiectului curent la Railway..."
railway link || warn "Linkarea automată a eșuat — poți face manual: railway link"

# ─── 4. Generează ADMIN_TOKEN ────────────────────────────────
step "4. Generare ADMIN_TOKEN"
ADMIN_TOKEN=$(node -e "const c=require('crypto');process.stdout.write(c.randomBytes(32).toString('hex'))")
ok "ADMIN_TOKEN generat automat"

# ─── 5. Colectează și setează variabilele ────────────────────
step "5. Setare variabile în Railway"

declare -A VAR_SOURCES
SET_COUNT=0
PLACEHOLDER_COUNT=0

for KEY in "${REQUIRED_VARS[@]}"; do
    # Caz special: ADMIN_TOKEN generat automat
    if [ "$KEY" = "ADMIN_TOKEN" ]; then
        VALUE="$ADMIN_TOKEN"
        SOURCE="generat"
    else
        # Încearcă .env local
        LOCAL_VAL=$(get_env_value "$KEY" "$ENV_FILE")
        # Încearcă .env.example
        EXAMPLE_VAL=$(get_env_value "$KEY" "$ENV_EXAMPLE")

        # Valori implicite pentru variabile de sistem
        declare -A DEFAULTS=(
            [PORT]="3000"
            [NODE_ENV]="production"
            [LOG_LEVEL]="info"
            [APP_URL]="https://kelionai.app"
            [ALLOWED_ORIGINS]=""
        )

        if [ -n "$LOCAL_VAL" ] && ! is_placeholder "$LOCAL_VAL"; then
            VALUE="$LOCAL_VAL"
            SOURCE="local .env"
        elif [ -n "$EXAMPLE_VAL" ] && ! is_placeholder "$EXAMPLE_VAL"; then
            VALUE="$EXAMPLE_VAL"
            SOURCE=".env.example"
        elif [[ -v DEFAULTS[$KEY] ]]; then
            VALUE="${DEFAULTS[$KEY]}"
            SOURCE="implicit"
        else
            VALUE="placeholder_to_be_updated"
            SOURCE="placeholder"
        fi
    fi

    VAR_SOURCES[$KEY]="$SOURCE"

    # Sări variabilele goale
    if [ -z "$VALUE" ]; then
        warn "  $KEY — sărit (valoare goală)"
        continue
    fi

    # Setează variabila în Railway cu escapare corectă a valorii
    if railway variables set "${KEY}=$(printf '%s' "$VALUE")" --silent 2>/dev/null; then
        SET_COUNT=$((SET_COUNT + 1))
        if [ "$SOURCE" = "placeholder" ]; then
            PLACEHOLDER_COUNT=$((PLACEHOLDER_COUNT + 1))
        fi
    else
        warn "  $KEY — setare eșuată (poți seta manual)"
    fi
done

ok "$SET_COUNT variabile setate în Railway"
if [ "$PLACEHOLDER_COUNT" -gt 0 ]; then
    warn "$PLACEHOLDER_COUNT variabile au valoarea 'placeholder_to_be_updated' și pot fi actualizate ulterior"
fi

# ─── 6. Afișează tabelul sumar ───────────────────────────────
step "6. Sumar variabile"
echo ""
printf "  %-30s %-15s %s\n" "VARIABILA" "SURSĂ" "STATUS"
printf "  %-30s %-15s %s\n" "$(printf '%.0s─' {1..30})" "$(printf '%.0s─' {1..15})" "$(printf '%.0s─' {1..20})"

for KEY in "${REQUIRED_VARS[@]}"; do
    SOURCE="${VAR_SOURCES[$KEY]:-necunoscut}"
    if [ "$SOURCE" = "placeholder" ]; then
        STATUS="${YELLOW}⚠  placeholder${NC}"
    else
        STATUS="${GREEN}✓  setat${NC}"
    fi
    printf "  %-30s %-15s " "$KEY" "$SOURCE"
    echo -e "$STATUS"
done

# ─── 7. Deploy automat ───────────────────────────────────────
step "7. Deploy automat Railway"
if [ "$PLACEHOLDER_COUNT" -gt 0 ]; then
    warn "Atenție: $PLACEHOLDER_COUNT variabile sunt placeholder. Aplicația poate eșua dacă acestea sunt critice."
fi
info "Pornesc deploy pe Railway..."
if railway up; then
    ok "Deploy Railway pornit cu succes!"
else
    warn "Deploy-ul a eșuat sau a fost întrerupt. Poți rula manual: railway up"
fi

# ─── Sumar final ─────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   ✅ Configurare Railway completă!               ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo ""
info "Pași următori:"
echo -e "  1. ${CYAN}railway logs${NC}               — verifică log-urile deploy-ului"
echo -e "  2. ${CYAN}railway open${NC}               — deschide aplicația în browser"
if [ "$PLACEHOLDER_COUNT" -gt 0 ]; then
    echo -e "  3. ${YELLOW}railway variables set KEY=VALOARE_REALA${NC} — actualizează placeholderele"
fi
echo ""
