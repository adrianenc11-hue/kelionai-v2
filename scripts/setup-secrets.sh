#!/usr/bin/env bash
# setup-secrets.sh — Setează secretele GitHub necesare pentru CI/CD (Netlify deploy)
# Utilizare: bash scripts/setup-secrets.sh [--check] [--force]

set -euo pipefail

# ─── Culori ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info()    { echo -e "${BLUE}ℹ${NC}  $*"; }
success() { echo -e "${GREEN}✅${NC} $*"; }
warning() { echo -e "${YELLOW}⚠️${NC}  $*"; }
error()   { echo -e "${RED}❌${NC} $*" >&2; }

# ─── Flags ───────────────────────────────────────────────────────────────────
CHECK_ONLY=false
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --check) CHECK_ONLY=true ;;
    --force) FORCE=true ;;
    *)
      error "Unknown argument: $arg"
      echo "  Usage: bash scripts/setup-secrets.sh [--check] [--force]"
      exit 1
      ;;
  esac
done

# ─── Verifică gh CLI ─────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  error "GitHub CLI (gh) nu este instalat."
  echo ""
  echo "  Instalare pe macOS:   brew install gh"
  echo "  Instalare pe Linux:   https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
  echo "  Sau:                  https://cli.github.com/"
  exit 1
fi

# ─── Verifică autentificarea ─────────────────────────────────────────────────
if ! gh auth status &>/dev/null; then
  error "Nu ești autentificat cu GitHub CLI."
  echo ""
  echo "  Rulează: gh auth login"
  exit 1
fi

# ─── Detectează repo-ul curent ───────────────────────────────────────────────
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)
if [ -z "$REPO" ]; then
  error "Nu s-a putut detecta repo-ul GitHub. Rulează scriptul din directorul proiectului."
  exit 1
fi

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║       KelionAI — Setup GitHub Secrets pentru CI/CD       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
info "Repo detectat: ${REPO}"
echo ""

# ─── Funcție de citire validată ──────────────────────────────────────────────
read_secret() {
  local var_name="$1"
  local prompt_text="$2"
  local format_check="${3:-}"   # optional: "netlify_token" or "uuid"
  local value=""

  while true; do
    echo -n "  ${prompt_text}: "
    # Citire fără echo (ascunde valoarea)
    IFS= read -rs value
    echo ""

    # Validare: nu gol
    if [ -z "$value" ]; then
      warning "Valoarea nu poate fi goală. Încearcă din nou."
      continue
    fi

    # Validare: fără newlines
    if [[ "$value" =~ $'\n' ]]; then
      warning "Valoarea conține newlines. Încearcă din nou."
      continue
    fi

    # Validare: fără spații la început/sfârșit
    trimmed=$(printf '%s' "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [ "$trimmed" != "$value" ]; then
      warning "Valoarea conține spații la început sau sfârșit. Încearcă din nou."
      continue
    fi

    # Validare format specific
    if [ "$format_check" = "netlify_token" ]; then
      if [ ${#value} -lt 40 ] || ! [[ "$value" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        warning "NETLIFY_AUTH_TOKEN trebuie să fie un șir alfanumeric (cu posibile '-' sau '_') de cel puțin 40 de caractere. Încearcă din nou."
        continue
      fi
    elif [ "$format_check" = "uuid" ]; then
      if ! [[ "$value" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
        warning "NETLIFY_SITE_ID trebuie să fie un UUID valid (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx). Încearcă din nou."
        continue
      fi
    fi

    break
  done

  # Exportă în variabila globală prin nameref (bash 4.3+) sau indirect
  printf -v "$var_name" '%s' "$value"
}

# ─── Mod --check: verifică secretele existente ───────────────────────────────
if [ "$CHECK_ONLY" = "true" ]; then
  info "Verificare secrete setate pentru repo: ${REPO}"
  echo ""
  SECRET_LIST=$(gh secret list --repo "$REPO" 2>/dev/null || true)

  check_secret_exists() {
    local name="$1"
    if echo "$SECRET_LIST" | grep -q "^${name}[[:space:]]"; then
      success "${name}  — setat"
    else
      warning "${name}  — LIPSĂ"
    fi
  }

  check_secret_exists "NETLIFY_AUTH_TOKEN"
  check_secret_exists "NETLIFY_SITE_ID"
  check_secret_exists "KS_SENTRY"
  echo ""
  info "Pentru a seta secretele lipsă, rulează: bash scripts/setup-secrets.sh"
  echo ""
  exit 0
fi

# ─── Colectare secrete ───────────────────────────────────────────────────────
echo -e "${YELLOW}Secretele necesare pentru Netlify deploy:${NC}"
echo ""

echo "  Găsești NETLIFY_AUTH_TOKEN la: https://app.netlify.com/user/applications"
read_secret NETLIFY_AUTH_TOKEN "NETLIFY_AUTH_TOKEN" "netlify_token"

echo ""
echo "  Găsești NETLIFY_SITE_ID la: Site Settings → General → Site details"
read_secret NETLIFY_SITE_ID "NETLIFY_SITE_ID" "uuid"

# ─── Opțional: KS_SENTRY ─────────────────────────────────────────────────────
echo ""
echo -n "  Vrei să setezi și KS_SENTRY? (y/N): "
read -r SET_SENTRY
KS_SENTRY=""

if [[ "$SET_SENTRY" =~ ^[Yy]$ ]]; then
  echo "  Găsești KS_SENTRY la: https://sentry.io/settings/account/api/auth-tokens/"
  read_secret KS_SENTRY "KS_SENTRY"
fi

# ─── Confirmare ──────────────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Urmează să setezi:${NC}"
echo "  • NETLIFY_AUTH_TOKEN  = ${NETLIFY_AUTH_TOKEN:0:4}****"
echo "  • NETLIFY_SITE_ID     = ${NETLIFY_SITE_ID:0:8}****"
if [ -n "$KS_SENTRY" ]; then
  echo "  • KS_SENTRY           = ${KS_SENTRY:0:4}****"
fi
echo "  în repo: ${REPO}"
echo ""

if [ "$FORCE" = "false" ]; then
  echo -n "  Confirmi? (y/N): "
  read -r CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    warning "Anulat de utilizator."
    exit 0
  fi
fi

# ─── Setare secrete ──────────────────────────────────────────────────────────
echo ""
info "Setare secrete în GitHub..."

if printf '%s' "$NETLIFY_AUTH_TOKEN" | gh secret set NETLIFY_AUTH_TOKEN --repo "$REPO"; then
  success "NETLIFY_AUTH_TOKEN setat cu succes."
else
  error "Eroare la setarea NETLIFY_AUTH_TOKEN."
  exit 1
fi

if printf '%s' "$NETLIFY_SITE_ID" | gh secret set NETLIFY_SITE_ID --repo "$REPO"; then
  success "NETLIFY_SITE_ID setat cu succes."
else
  error "Eroare la setarea NETLIFY_SITE_ID."
  exit 1
fi

if [ -n "$KS_SENTRY" ]; then
  if printf '%s' "$KS_SENTRY" | gh secret set KS_SENTRY --repo "$REPO"; then
    success "KS_SENTRY setat cu succes."
  else
    warning "Eroare la setarea KS_SENTRY (ne-critic)."
  fi
fi

# ─── Verificare post-setare ───────────────────────────────────────────────────
echo ""
info "Verificare că secretele au fost setate corect..."
SECRET_LIST=$(gh secret list --repo "$REPO" 2>/dev/null || true)

verify_secret() {
  local name="$1"
  if echo "$SECRET_LIST" | grep -q "^${name}[[:space:]]"; then
    success "${name}  — verificat ✓"
  else
    warning "${name}  — nu apare în lista de secrete (poate necesita câteva secunde)"
  fi
}

verify_secret "NETLIFY_AUTH_TOKEN"
verify_secret "NETLIFY_SITE_ID"
if [ -n "$KS_SENTRY" ]; then
  verify_secret "KS_SENTRY"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     Sumar                                ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
success "NETLIFY_AUTH_TOKEN  — setat"
success "NETLIFY_SITE_ID     — setat"
if [ -n "$KS_SENTRY" ]; then
  success "KS_SENTRY           — setat"
fi
echo ""
info "Secretele sunt acum disponibile în GitHub Actions."

# ─── Opțional: re-rulare workflow ────────────────────────────────────────────
echo ""
echo -n "  Vrei să re-rulezi workflow-ul CI/CD acum? (y/N): "
read -r RUN_WORKFLOW

if [[ "$RUN_WORKFLOW" =~ ^[Yy]$ ]]; then
  if gh workflow run test.yml --repo "$REPO"; then
    success "Workflow 'test.yml' pornit cu succes."
    info "Urmărește-l la: https://github.com/${REPO}/actions"
  else
    warning "Nu s-a putut porni workflow-ul. Poți să-l pornești manual din GitHub Actions."
  fi
fi

echo ""
