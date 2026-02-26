#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# KelionAI v2 — AUTO-SAVE SCRIPT
# Rulează: bash scripts/auto-save.sh
# Opțional: bash scripts/auto-save.sh "mesaj commit custom"
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${GREEN}✅ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $1${NC}"; }
err()  { echo -e "${RED}❌ $1${NC}"; exit 1; }
info() { echo -e "${CYAN}ℹ️  $1${NC}"; }

echo -e "${BOLD}${BLUE}"
echo "╔══════════════════════════════════════════╗"
echo "║      KelionAI v2 — AUTO-SAVE             ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

if [ ! -f "package.json" ]; then
  err "Rulează scriptul din rădăcina proiectului (unde e package.json)"
fi

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  err "Nu ești într-un repository git"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
info "Branch curent: ${BOLD}$BRANCH${NC}"

info "Pull din origin/$BRANCH..."
git pull origin "$BRANCH" --rebase 2>/dev/null || warn "Pull a eșuat — continuăm..."

if git diff --quiet && git diff --staged --quiet && [ -z "$(git status --porcelain)" ]; then
  log "Nimic de salvat — totul este deja up-to-date!"
  exit 0
fi

TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
COMMIT_MSG="${1:-"chore: auto-save $TIMESTAMP"}"

info "Adaug toate fișierele modificate..."
git add -A
info "Fișiere incluse în commit:"
git status --short
info "Commit: \"$COMMIT_MSG\""
git commit -m "$COMMIT_MSG"
log "Commit creat!"

LATEST_TAG=$(git tag --sort=-version:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n1 || echo "")
if [ -z "$LATEST_TAG" ]; then
  NEW_TAG="v2.3.0"
else
  MAJOR=$(echo "$LATEST_TAG" | cut -d. -f1 | tr -d 'v')
  MINOR=$(echo "$LATEST_TAG" | cut -d. -f2)
  PATCH=$(echo "$LATEST_TAG" | cut -d. -f3)
  PATCH=$((PATCH + 1))
  NEW_TAG="v${MAJOR}.${MINOR}.${PATCH}"
fi

info "Creez tag: $NEW_TAG"
git tag -a "$NEW_TAG" -m "KelionAI auto-save: $TIMESTAMP"
log "Tag $NEW_TAG creat!"

info "Push pe origin/$BRANCH..."
git push origin "$BRANCH"
log "Push reușit!"

info "Push tag $NEW_TAG..."
git push origin "$NEW_TAG"
log "Tag pushed!"

echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  ✅ AUTO-SAVE COMPLET!${NC}"
echo -e "${GREEN}  Branch : $BRANCH${NC}"
echo -e "${GREEN}  Tag    : $NEW_TAG${NC}"
echo -e "${GREEN}  Commit : $COMMIT_MSG${NC}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "${CYAN}🚀 Railway va detecta push-ul și va face deploy automat.${NC}"
echo -e "${CYAN}📦 Tag: https://github.com/adrianenc11-hue/kelionai-v2/releases/tag/$NEW_TAG${NC}"
