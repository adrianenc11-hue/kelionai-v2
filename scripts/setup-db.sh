#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2.3 — Configurare bază de date Supabase
# Utilizare: bash scripts/setup-db.sh  sau  npm run setup:db
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
echo -e "${BOLD}${CYAN}   KelionAI v2.3 — Configurare Supabase           ${NC}"
echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"
echo ""

# ─── Citire variabile din .env ────────────────────────────────
step "Citire configurație"
if [ ! -f "$ENV_FILE" ]; then
    err "Fișierul .env nu există. Rulează mai întâi: npm run setup"
    exit 1
fi

# Funcție pentru citire valoare din .env
get_env() {
    local key="$1"
    local val
    val=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- || echo "")
    echo "$val"
}

SUPABASE_URL=$(get_env "SUPABASE_URL")
SUPABASE_SERVICE_KEY=$(get_env "SUPABASE_SERVICE_KEY")
DATABASE_URL=$(get_env "DATABASE_URL")

if [ -z "$SUPABASE_URL" ] || [[ "$SUPABASE_URL" == *"xxx"* ]]; then
    err "SUPABASE_URL nu este configurat în .env"
    info "Rulează: npm run setup  pentru configurare interactivă"
    exit 1
fi

if [ -z "$SUPABASE_SERVICE_KEY" ] || [[ "$SUPABASE_SERVICE_KEY" == *"xxx"* ]]; then
    err "SUPABASE_SERVICE_KEY nu este configurat în .env"
    info "Găsești cheia la: ${SUPABASE_URL}/settings/api"
    exit 1
fi

ok "Configurație citită"
info "Supabase URL: ${SUPABASE_URL}"

# ─── Găsire schema SQL ────────────────────────────────────────
step "Găsire fișier schema SQL"
SCHEMA_FILE=""
if [ -f "$PROJECT_DIR/server/schema-full.sql" ]; then
    SCHEMA_FILE="$PROJECT_DIR/server/schema-full.sql"
    ok "Folosesc: server/schema-full.sql"
elif [ -f "$PROJECT_DIR/server/schema.sql" ]; then
    SCHEMA_FILE="$PROJECT_DIR/server/schema.sql"
    ok "Folosesc: server/schema.sql"
else
    err "Nu am găsit fișierul schema SQL în server/schema.sql sau server/schema-full.sql"
    exit 1
fi

SQL_CONTENT=$(cat "$SCHEMA_FILE")

# ─── Execuție SQL via Supabase REST API ───────────────────────
step "Execuție schema SQL pe Supabase"
info "Trimit schema SQL la Supabase..."

# Supabase REST API endpoint pentru execuție SQL
SUPABASE_SQL_URL="${SUPABASE_URL}/rest/v1/rpc/exec_sql"

# Încearcă mai întâi cu pg (dacă DATABASE_URL e disponibil)
if [ -n "$DATABASE_URL" ] && [[ "$DATABASE_URL" != *"xxx"* ]] && command -v psql &>/dev/null; then
    info "Folosesc psql pentru execuție directă PostgreSQL..."
    if echo "$SQL_CONTENT" | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 2>&1; then
        ok "Schema SQL executată cu succes via psql!"
    else
        warn "psql a întâmpinat erori. Încerc via Supabase Management API..."
        execute_via_api=true
    fi
else
    execute_via_api=true
fi

# Fallback: Supabase Management API
ESCAPED_SQL=""
PROJECT_REF=""
if [ "${execute_via_api:-false}" = "true" ]; then
    # Extrage project ref din URL (https://[REF].supabase.co)
    PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://||' | cut -d'.' -f1)

    info "Project ref: $PROJECT_REF"
    info "Folosesc Supabase Management API..."

    # Escapare SQL pentru JSON (necesită Python 3)
    if ! command -v python3 &>/dev/null; then
        warn "Python 3 nu este disponibil. Nu pot escapa SQL pentru JSON."
        warn "Execută manual schema SQL în Supabase SQL Editor."
        execute_via_api=false
    else
        ESCAPED_SQL=$(python3 -c "
import sys, json
sql = sys.stdin.read()
print(json.dumps(sql))
" <<< "$SQL_CONTENT" 2>/dev/null) || {
            warn "Nu am putut escapa SQL-ul. Execută manual în Supabase SQL Editor."
            execute_via_api=false
        }
    fi
fi

if [ "${execute_via_api:-false}" = "true" ] && [ -n "${ESCAPED_SQL:-}" ]; then

    RESPONSE=$(curl -sf \
        --max-time 30 \
        -X POST \
        "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"query\": ${ESCAPED_SQL}}" \
        2>&1 || echo "CURL_ERROR")

    if [[ "$RESPONSE" == *"CURL_ERROR"* ]] || [[ "$RESPONSE" == *"error"* && "$RESPONSE" != *"already exists"* ]]; then
        warn "API Management Supabase nu a funcționat."
        warn "Execută manual schema SQL:"
        echo ""
        echo -e "  1. Mergi la: ${CYAN}${SUPABASE_URL/https:\/\//https:\/\/supabase.com\/dashboard\/project\/}/sql/new${NC}"
        echo -e "  2. Copiază conținutul fișierului: ${CYAN}${SCHEMA_FILE}${NC}"
        echo -e "  3. Click ${BOLD}Run${NC}"
        echo ""
    else
        ok "Schema SQL executată cu succes via Supabase API!"
    fi
fi

# ─── Verificare tabele create ─────────────────────────────────
step "Verificare tabele Supabase"
info "Verific dacă tabelele au fost create..."

TABLES_TO_CHECK=("conversations" "messages" "user_preferences")
ALL_OK=true

for TABLE in "${TABLES_TO_CHECK[@]}"; do
    RESPONSE=$(curl -sf \
        --max-time 10 \
        -X GET \
        "${SUPABASE_URL}/rest/v1/${TABLE}?limit=1" \
        -H "apikey: ${SUPABASE_SERVICE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
        2>/dev/null || echo "ERROR")

    if [[ "$RESPONSE" == "ERROR" ]] || [[ "$RESPONSE" == *'"message"'*'"code"'* ]]; then
        err "Tabelul '${TABLE}' nu există sau nu este accesibil"
        ALL_OK=false
    else
        ok "Tabelul '${TABLE}' există și este accesibil"
    fi
done

# ─── Sumar ────────────────────────────────────────────────────
echo ""
if [ "$ALL_OK" = true ]; then
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${GREEN}   ✅ Baza de date configurată cu succes!          ${NC}"
    echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
    echo ""
    exit 0
else
    echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}${YELLOW}   ⚠️  Unele tabele lipsesc — execută schema manual${NC}"
    echo -e "${BOLD}${YELLOW}══════════════════════════════════════════════════${NC}"
    echo ""
    warn "Pași pentru execuție manuală:"
    echo -e "  1. Mergi la: ${CYAN}https://supabase.com/dashboard${NC}"
    echo -e "  2. Selectează proiectul tău"
    echo -e "  3. Mergi la: SQL Editor → New query"
    echo -e "  4. Copiază conținutul din: ${CYAN}${SCHEMA_FILE}${NC}"
    echo -e "  5. Click ${BOLD}Run${NC}"
    echo ""
    exit 1
fi
