#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2.3 — Configurare interactivă variabile de mediu
# Utilizare: bash scripts/setup-env.sh  sau  npm run setup
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
ENV_FILE="$PROJECT_DIR/.env"

echo ""
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${CYAN}   KelionAI v2.3 — Configurare chei API           ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""
info "Vei fi întrebat pentru fiecare cheie API."
info "Apasă Enter pentru a sări cheile opționale."
echo ""

# ─── Funcție pentru citire cheie ──────────────────────────────
declare -A ENV_VARS

ask_key() {
    local key="$1"
    local description="$2"
    local url="$3"
    local required="$4"
    local prefix="$5"
    local current_val=""

    # Citește valoarea curentă din .env dacă există
    if [ -f "$ENV_FILE" ]; then
        current_val=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- || echo "")
        # Dacă valoarea conține xxx sau e goală, tratează ca necompletată
        if [[ "$current_val" == *"xxx"* ]] || [[ -z "$current_val" ]]; then
            current_val=""
        fi
    fi

    echo ""
    echo -e "${BOLD}$key${NC}"
    echo -e "  📋 $description"
    echo -e "  🔗 Obții de la: ${CYAN}$url${NC}"
    if [ "$required" = "true" ]; then
        echo -e "  ${RED}(obligatoriu)${NC}"
    else
        echo -e "  ${YELLOW}(opțional)${NC}"
    fi
    if [ -n "$current_val" ]; then
        # Afișează primele/ultimele caractere pentru securitate
        local masked="${current_val:0:8}...${current_val: -4}"
        echo -e "  Valoare curentă: ${GREEN}$masked${NC}"
        read -r -p "  Noua valoare (Enter pentru a păstra): " new_val
        if [ -z "$new_val" ]; then
            new_val="$current_val"
        fi
    else
        read -r -p "  Introdu valoarea: " new_val
    fi

    # Validare format prefix
    if [ -n "$new_val" ] && [ -n "$prefix" ]; then
        if [[ ! "$new_val" == ${prefix}* ]]; then
            warn "Atenție: cheia $key ar trebui să înceapă cu '$prefix'"
            read -r -p "  Continui oricum? (da/nu): " confirm
            if [[ ! "$confirm" =~ ^[Dd][Aa]$ ]]; then
                ask_key "$key" "$description" "$url" "$required" "$prefix"
                return
            fi
        fi
    fi

    # Verifică dacă e obligatoriu și gol
    if [ "$required" = "true" ] && [ -z "$new_val" ]; then
        err "Cheia $key este obligatorie!"
        ask_key "$key" "$description" "$url" "$required" "$prefix"
        return
    fi

    if [ -n "$new_val" ]; then
        ENV_VARS["$key"]="$new_val"
        ok "$key configurat"
    else
        ENV_VARS["$key"]=""
        warn "$key sărit (opțional)"
    fi
}

# ─── Secțiunea AI ─────────────────────────────────────────────
step "🤖 Configurare AI"
ask_key "ANTHROPIC_API_KEY" \
    "Claude 3.5 Sonnet — AI principal pentru chat și analiză imagini" \
    "https://console.anthropic.com/settings/keys" \
    "false" \
    "sk-ant-"

ask_key "OPENAI_API_KEY" \
    "GPT-4o — AI alternativ + Whisper pentru transcriere voce" \
    "https://platform.openai.com/api-keys" \
    "false" \
    "sk-"

ask_key "DEEPSEEK_API_KEY" \
    "DeepSeek — alternativă economică pentru chat" \
    "https://platform.deepseek.com/api_keys" \
    "false" \
    "sk-"

# Verifică că cel puțin un AI e configurat
if [ -z "${ENV_VARS[ANTHROPIC_API_KEY]:-}" ] && \
   [ -z "${ENV_VARS[OPENAI_API_KEY]:-}" ] && \
   [ -z "${ENV_VARS[DEEPSEEK_API_KEY]:-}" ]; then
    err "Este necesară cel puțin o cheie AI (Anthropic, OpenAI sau DeepSeek)!"
    exit 1
fi

# ─── Secțiunea Voce ───────────────────────────────────────────
step "🔊 Configurare Voce (TTS/STT)"
ask_key "ELEVENLABS_API_KEY" \
    "ElevenLabs — sinteză vocală (text-to-speech) pentru Kelion și Kira" \
    "https://elevenlabs.io/app/settings/api-keys" \
    "false" \
    "sk_"

ask_key "GROQ_API_KEY" \
    "Groq — transcriere voce rapidă (opțional, fallback pentru Whisper)" \
    "https://console.groq.com/keys" \
    "false" \
    "gsk_"

# ─── Secțiunea Căutare ────────────────────────────────────────
step "🔍 Configurare Căutare Web"
ask_key "PERPLEXITY_API_KEY" \
    "Perplexity — căutare AI cu surse citate" \
    "https://www.perplexity.ai/settings/api" \
    "false" \
    "pplx-"

ask_key "TAVILY_API_KEY" \
    "Tavily — căutare web structurată" \
    "https://app.tavily.com" \
    "false" \
    "tvly-"

ask_key "SERPER_API_KEY" \
    "Serper — Google Search API" \
    "https://serper.dev" \
    "false" \
    ""

# ─── Secțiunea Imagini ────────────────────────────────────────
step "🖼️  Configurare Generare Imagini"
ask_key "TOGETHER_API_KEY" \
    "Together AI — generare imagini cu FLUX (alternativă la DALL-E)" \
    "https://api.together.ai/settings/api-keys" \
    "false" \
    ""

# ─── Secțiunea Supabase ───────────────────────────────────────
step "🗄️  Configurare Supabase (baza de date)"
info "Găsești aceste valori la: https://supabase.com/dashboard/project/[ID]/settings/api"
echo ""

ask_key "SUPABASE_URL" \
    "URL-ul proiectului Supabase (ex: https://xxxx.supabase.co)" \
    "https://supabase.com/dashboard" \
    "true" \
    "https://"

ask_key "SUPABASE_ANON_KEY" \
    "Cheia publică (anon) — folosită în frontend" \
    "https://supabase.com/dashboard/project/[ID]/settings/api" \
    "true" \
    "eyJ"

ask_key "SUPABASE_SERVICE_KEY" \
    "Cheia de serviciu (service_role) — DOAR backend, NU expune în frontend!" \
    "https://supabase.com/dashboard/project/[ID]/settings/api" \
    "true" \
    "eyJ"

ask_key "SUPABASE_DB_PASSWORD" \
    "Parola PostgreSQL directă (opțional, pentru migrări directe)" \
    "https://supabase.com/dashboard/project/[ID]/settings/database" \
    "false" \
    ""

ask_key "DATABASE_URL" \
    "URL conexiune directă PostgreSQL (opțional)" \
    "https://supabase.com/dashboard/project/[ID]/settings/database" \
    "false" \
    "postgresql://"

# ─── Secțiunea Plăți ──────────────────────────────────────────
step "💳 Configurare Plăți Stripe"
ask_key "STRIPE_SECRET_KEY" \
    "Cheia secretă Stripe (test: sk_test_xxx, producție: sk_live_xxx)" \
    "https://dashboard.stripe.com/apikeys" \
    "false" \
    "sk_"

ask_key "STRIPE_WEBHOOK_SECRET" \
    "Secretul webhook Stripe (pentru notificări plăți)" \
    "https://dashboard.stripe.com/webhooks" \
    "false" \
    "whsec_"

ask_key "STRIPE_PRICE_PRO" \
    "ID-ul prețului Stripe pentru planul Pro (€9.99/lună)" \
    "https://dashboard.stripe.com/products" \
    "false" \
    "price_"

ask_key "STRIPE_PRICE_PREMIUM" \
    "ID-ul prețului Stripe pentru planul Premium (€19.99/lună)" \
    "https://dashboard.stripe.com/products" \
    "false" \
    "price_"

# ─── Secțiunea Monitorizare ───────────────────────────────────
step "📊 Configurare Monitorizare"
ask_key "SENTRY_DSN" \
    "Sentry — urmărire erori în timp real" \
    "https://sentry.io (Project Settings → Client Keys)" \
    "false" \
    "https://"

ask_key "GRAFANA_PROM_URL" \
    "Grafana/Prometheus — URL pentru push metrici (opțional)" \
    "https://grafana.com/products/cloud/" \
    "false" \
    ""

ask_key "GRAFANA_PROM_USER" \
    "Grafana Prometheus user ID (opțional)" \
    "https://grafana.com/products/cloud/" \
    "false" \
    ""

ask_key "GRAFANA_PROM_PASS" \
    "Grafana Prometheus parolă/token (opțional)" \
    "https://grafana.com/products/cloud/" \
    "false" \
    ""

# ─── Secțiunea Aplicație ──────────────────────────────────────
step "⚙️  Configurare Aplicație"
ENV_VARS["PORT"]="3000"
ENV_VARS["NODE_ENV"]="production"
ENV_VARS["APP_URL"]="https://kelionai.app"
ok "PORT=3000, NODE_ENV=production, APP_URL=https://kelionai.app"

# ─── Scriere fișier .env ──────────────────────────────────────
step "Scriere fișier .env"

# Backup dacă există deja
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "${ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)"
    info "Backup creat: ${ENV_FILE}.backup.*"
fi

cat > "$ENV_FILE" << ENVEOF
# ═══════════════════════════════════════════════════════════════
# KelionAI v2 — Variabile de Configurare
# Generat automat de scripts/setup-env.sh la $(date)
# ⚠️  Nu comite niciodată fișierul .env în Git!
# ═══════════════════════════════════════════════════════════════


# ───────────────────────────────────────────────
# 🤖 AI
# ───────────────────────────────────────────────
ANTHROPIC_API_KEY=${ENV_VARS[ANTHROPIC_API_KEY]:-}
OPENAI_API_KEY=${ENV_VARS[OPENAI_API_KEY]:-}
DEEPSEEK_API_KEY=${ENV_VARS[DEEPSEEK_API_KEY]:-}


# ───────────────────────────────────────────────
# 🔊 VOCE (TTS / STT)
# ───────────────────────────────────────────────
ELEVENLABS_API_KEY=${ENV_VARS[ELEVENLABS_API_KEY]:-}
GROQ_API_KEY=${ENV_VARS[GROQ_API_KEY]:-}


# ───────────────────────────────────────────────
# 🔍 CĂUTARE WEB
# ───────────────────────────────────────────────
PERPLEXITY_API_KEY=${ENV_VARS[PERPLEXITY_API_KEY]:-}
TAVILY_API_KEY=${ENV_VARS[TAVILY_API_KEY]:-}
SERPER_API_KEY=${ENV_VARS[SERPER_API_KEY]:-}


# ───────────────────────────────────────────────
# 🖼️  IMAGINI
# ───────────────────────────────────────────────
TOGETHER_API_KEY=${ENV_VARS[TOGETHER_API_KEY]:-}


# ───────────────────────────────────────────────
# 🗄️  BAZA DE DATE — Supabase
# ───────────────────────────────────────────────
SUPABASE_URL=${ENV_VARS[SUPABASE_URL]:-}
SUPABASE_ANON_KEY=${ENV_VARS[SUPABASE_ANON_KEY]:-}
SUPABASE_SERVICE_KEY=${ENV_VARS[SUPABASE_SERVICE_KEY]:-}
SUPABASE_DB_PASSWORD=${ENV_VARS[SUPABASE_DB_PASSWORD]:-}
DATABASE_URL=${ENV_VARS[DATABASE_URL]:-}


# ───────────────────────────────────────────────
# 💳 PLĂȚI — Stripe
# ───────────────────────────────────────────────
STRIPE_SECRET_KEY=${ENV_VARS[STRIPE_SECRET_KEY]:-}
STRIPE_WEBHOOK_SECRET=${ENV_VARS[STRIPE_WEBHOOK_SECRET]:-}
STRIPE_PRICE_PRO=${ENV_VARS[STRIPE_PRICE_PRO]:-}
STRIPE_PRICE_PREMIUM=${ENV_VARS[STRIPE_PRICE_PREMIUM]:-}


# ───────────────────────────────────────────────
# 📊 MONITORIZARE
# ───────────────────────────────────────────────
SENTRY_DSN=${ENV_VARS[SENTRY_DSN]:-}
GRAFANA_PROM_URL=${ENV_VARS[GRAFANA_PROM_URL]:-}
GRAFANA_PROM_USER=${ENV_VARS[GRAFANA_PROM_USER]:-}
GRAFANA_PROM_PASS=${ENV_VARS[GRAFANA_PROM_PASS]:-}


# ───────────────────────────────────────────────
# ⚙️  APLICAȚIE
# ───────────────────────────────────────────────
PORT=${ENV_VARS[PORT]}
NODE_ENV=${ENV_VARS[NODE_ENV]}
APP_URL=${ENV_VARS[APP_URL]}
ENVEOF

ok "Fișierul .env a fost scris cu succes!"

# ─── Opțional: push la Railway ────────────────────────────────
step "Trimitere variabile la Railway"
echo ""
read -r -p "Vrei să trimiți variabilele la Railway acum? (da/nu): " push_railway
if [[ "$push_railway" =~ ^[Dd][Aa]$ ]]; then
    if command -v railway &>/dev/null && railway whoami &>/dev/null 2>&1; then
        VARS_SENT=0
        while IFS= read -r line || [ -n "$line" ]; do
            [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
            if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
                KEY="${line%%=*}"
                VALUE="${line#*=}"
                if [ -n "$VALUE" ]; then
                    railway variables set "${KEY}=${VALUE}" --silent 2>/dev/null && \
                        VARS_SENT=$((VARS_SENT + 1)) || true
                fi
            fi
        done < "$ENV_FILE"
        ok "Trimise $VARS_SENT variabile la Railway"
    else
        warn "Railway CLI nu e disponibil sau nu ești autentificat."
        info "Rulează: npm run setup:full  pentru a trimite variabilele la Railway"
    fi
else
    info "Variabilele nu au fost trimise la Railway. Rulează npm run setup:full când ești gata."
fi

# ─── Sumar ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   ✅ Configurare completă!                        ${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo ""
info "Pași următori:"
echo -e "  1. ${CYAN}npm run setup:db${NC}   — configurează baza de date Supabase"
echo -e "  2. ${CYAN}npm run setup:full${NC} — deploy complet pe Railway"
echo -e "  3. ${CYAN}npm run health${NC}     — verifică starea aplicației"
echo ""
