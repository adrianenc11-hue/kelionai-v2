#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# KelionAI — Railway Environment Variables Setup
# Adaugă variabilele de environment din .env în Railway
#
# Utilizare: bash scripts/railway-env.sh
#            sau: npm run railway:vars
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_LOCAL="$ROOT_DIR/.env.local"

echo ""
echo "🚂 KelionAI — Railway Environment Setup (bash)"
echo "════════════════════════════════════════"
echo ""

# ─── 1. Verifică Railway CLI ─────────────────────────────────────────────────

if ! command -v railway &>/dev/null; then
    echo "⚠️  Railway CLI nu este instalat. Instalez..."
    npm i -g @railway/cli
    echo "✅ Railway CLI instalat"
fi
echo "✅ Railway CLI detectat"

# ─── 2. Verifică autentificare ───────────────────────────────────────────────

if ! railway whoami &>/dev/null; then
    echo "❌ Nu ești autentificat în Railway. Rulează: railway login"
    exit 1
fi
echo "✅ Autentificat: $(railway whoami)"

# ─── 3. Verifică project link ────────────────────────────────────────────────

if ! railway status &>/dev/null; then
    echo "❌ Niciun proiect Railway linked. Rulează: railway link"
    exit 1
fi
echo "✅ Proiect Railway linked"
echo ""

# ─── 4. Generează ADMIN_TOKEN dacă lipsește ──────────────────────────────────

if [ ! -f "$ENV_FILE" ] || ! grep -q "^ADMIN_TOKEN=" "$ENV_FILE"; then
    ADMIN_TOKEN=$(node -e "const crypto=require('crypto'); console.log(crypto.randomBytes(64).toString('hex'))")
    echo "🔑 Generez ADMIN_TOKEN automat..."
    echo "ADMIN_TOKEN=$ADMIN_TOKEN" >> "$ENV_LOCAL"
    echo "   ✅ ADMIN_TOKEN generat și salvat în .env.local"
    railway variables set "ADMIN_TOKEN=$ADMIN_TOKEN"
    echo "   ✅ ADMIN_TOKEN setat în Railway"
fi

# ─── 5. Setează variabilele din .env ─────────────────────────────────────────

if [ ! -f "$ENV_FILE" ]; then
    echo "⚠️  Fișierul .env nu există. Setați manual variabilele sau creați .env din .env.example."
    exit 0
fi

echo "📋 Setez variabilele din .env în Railway..."
echo ""

SET_COUNT=0
SKIP_COUNT=0

while IFS= read -r line || [ -n "$line" ]; do
    # Ignoră liniile goale și comentariile
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue

    # Extrage cheia și valoarea
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
        KEY="${BASH_REMATCH[1]}"
        VALUE="${BASH_REMATCH[2]}"

        # Sări peste valorile goale sau placeholde
        if [[ -z "$VALUE" || "$VALUE" == *"xxx"* ]]; then
            SKIP_COUNT=$((SKIP_COUNT + 1))
            continue
        fi

        railway variables set "${KEY}=${VALUE}" &>/dev/null && \
            echo "   ✅ ${KEY} setat" && SET_COUNT=$((SET_COUNT + 1)) || \
            echo "   ⚠️  Nu am putut seta ${KEY}"
    fi
done < "$ENV_FILE"

# ─── 6. Sumar ─────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════"
echo "✅ $SET_COUNT variabile setate cu succes în Railway!"
if [ $SKIP_COUNT -gt 0 ]; then
    echo "⏭️  $SKIP_COUNT variabile sărite (goale sau placeholder)"
fi
echo "🚀 Rulează 'railway up' pentru a deploya!"
echo ""
