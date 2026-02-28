#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# KelionAI v2 — Auto-Fix Script
#
# Reads a scan report (JSON) produced by scan-and-fix-live.sh and automatically
# applies code fixes for actionable issues:
#
#   add_security_header:<name>:<value>  → patch server/index.js
#   add_hsts                            → patch server/index.js
#   add_https_redirect                  → patch server/index.js
#   fix_manifest_content_type           → patch server/index.js
#
# After applying fixes the script creates a branch, commits, and opens a PR.
#
# Usage:
#   bash scripts/auto-fix.sh [--report=path/to/report.json] [--dry-run]
#
# Environment:
#   GITHUB_TOKEN  — required for opening a PR (via `gh`)
#   GH_REPO       — owner/repo  (default: adrianenc11-hue/kelionai-v2)
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p logs reports
LOG_FILE="logs/auto-fix-${TIMESTAMP}.log"

log()    { echo -e "$*" | tee -a "$LOG_FILE"; }
ok()     { log "${GREEN}✅  $*${NC}"; }
fail()   { log "${RED}❌  $*${NC}"; }
warn()   { log "${YELLOW}⚠️   $*${NC}"; }
info()   { log "${CYAN}ℹ️   $*${NC}"; }
header() { log "\n${BOLD}${CYAN}══ $* ══${NC}"; }

# ─── Defaults ────────────────────────────────────────────────────────────────
DRY_RUN=false
REPORT_FILE=""
GH_REPO="${GH_REPO:-adrianenc11-hue/kelionai-v2}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVER_FILE="${PROJECT_DIR}/server/index.js"

for arg in "$@"; do
  case "$arg" in
    --report=*) REPORT_FILE="${arg#*=}" ;;
    --dry-run)  DRY_RUN=true ;;
  esac
done

# ─── Tool check ──────────────────────────────────────────────────────────────
for tool in jq git gh; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌  Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Find report ─────────────────────────────────────────────────────────────
header "KelionAI v2 — Auto-Fix"
info "Log     : $LOG_FILE"
info "Dry-run : $DRY_RUN"

if [[ -z "$REPORT_FILE" ]]; then
  # Pick the latest report
  REPORT_FILE=$(ls -t "${PROJECT_DIR}/reports/live-scan-"*.json 2>/dev/null | head -1 || true)
  if [[ -z "$REPORT_FILE" ]]; then
    fail "No scan report found in reports/. Run scan-and-fix-live.sh first."
    exit 1
  fi
  info "Using latest report: $REPORT_FILE"
fi

if [[ ! -f "$REPORT_FILE" ]]; then
  fail "Report file not found: $REPORT_FILE"
  exit 1
fi

info "Report  : $REPORT_FILE"

# ─── Parse issues ────────────────────────────────────────────────────────────
header "Parsing Issues from Report"

FAIL_COUNT=$(jq -r '.summary.fail // 0' "$REPORT_FILE")
WARN_COUNT=$(jq -r '.summary.warn // 0' "$REPORT_FILE")
info "Failures: $FAIL_COUNT  Warnings: $WARN_COUNT"

if [[ "$FAIL_COUNT" -eq 0 ]] && [[ "$WARN_COUNT" -eq 0 ]]; then
  ok "No issues to fix — report is clean"
  exit 0
fi

# Collect distinct fix_actions (skip "none")
FIXES=$(jq -r '[.issues[] | select(.fix_action != "none") | .fix_action] | unique | .[]' \
  "$REPORT_FILE" 2>/dev/null || true)

if [[ -z "$FIXES" ]]; then
  warn "Issues found but none have an auto-fix action. Manual review required."
  # Log each issue
  jq -r '.issues[] | "  [\(.severity | ascii_upcase)] \(.description) — \(.url)"' \
    "$REPORT_FILE" | while IFS= read -r line; do warn "$line"; done
  exit 0
fi

info "Auto-fixable actions detected:"
echo "$FIXES" | while IFS= read -r fix; do info "  • $fix"; done

# ─── Apply fixes ─────────────────────────────────────────────────────────────
header "Applying Fixes to server/index.js"

CHANGES_MADE=false

apply_fix() {
  local fix_action="$1"
  info "Applying: $fix_action"

  case "$fix_action" in

    # ── Add an arbitrary security header (format: add_security_header:Name:Value)
    add_security_header:*)
      local header_name header_value
      header_name=$(echo "$fix_action" | cut -d: -f2)
      header_value=$(echo "$fix_action" | cut -d: -f3-)

      # Validate header name and value against an allowlist to prevent code injection
      local allowed_headers=(
        "X-Frame-Options"
        "X-Content-Type-Options"
        "Referrer-Policy"
        "Permissions-Policy"
        "X-XSS-Protection"
      )
      local is_allowed=false
      for allowed in "${allowed_headers[@]}"; do
        [[ "$header_name" == "$allowed" ]] && is_allowed=true && break
      done
      if [[ "$is_allowed" != "true" ]]; then
        warn "  Header '$header_name' is not in the allowlist — skipping for safety"
        return
      fi
      # Validate value: must not contain quotes, backslashes, or newlines
      if echo "$header_value" | grep -qP "['\"\\\\\n]"; then
        warn "  Header value for '$header_name' contains unsafe characters — skipping"
        return
      fi

      if grep -q "\"${header_name}\"" "$SERVER_FILE" 2>/dev/null; then
        info "  $header_name already present in server/index.js — skipping"
        return
      fi

      if [[ "$DRY_RUN" == "true" ]]; then
        info "  [DRY-RUN] Would add header: $header_name: $header_value"
        return
      fi

      # Inject after 'app.set("trust proxy", 1);'
      # Using a sed-based in-place insert (cross-platform with perl fallback)
      local snippet
      snippet="app.use((_req, res, next) => { res.setHeader('${header_name}', '${header_value}'); next(); }); // auto-fix: ${fix_action}"

      if grep -q "app.set('trust proxy'" "$SERVER_FILE"; then
        perl -i -0pe \
          "s|(app\.set\('trust proxy'[^;]+;)|\$1\n${snippet}|" \
          "$SERVER_FILE"
        ok "  Injected header $header_name: $header_value into server/index.js"
        CHANGES_MADE=true
      else
        warn "  Could not find injection point in server/index.js for $header_name"
      fi
      ;;

    # ── Add HSTS header
    add_hsts)
      if grep -q "Strict-Transport-Security" "$SERVER_FILE" 2>/dev/null; then
        info "  HSTS already configured in server/index.js — skipping"
        return
      fi

      if [[ "$DRY_RUN" == "true" ]]; then
        info "  [DRY-RUN] Would add HSTS middleware"
        return
      fi

      local snippet="app.use((_req, res, next) => { if (process.env.NODE_ENV === 'production') { res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'); } next(); }); // auto-fix: add_hsts"

      if grep -q "app.set('trust proxy'" "$SERVER_FILE"; then
        perl -i -0pe \
          "s|(app\.set\('trust proxy'[^;]+;)|\$1\n${snippet}|" \
          "$SERVER_FILE"
        ok "  Injected HSTS middleware into server/index.js"
        CHANGES_MADE=true
      else
        warn "  Could not find injection point in server/index.js for HSTS"
      fi
      ;;

    # ── Add HTTP → HTTPS redirect middleware
    add_https_redirect)
      if grep -q "https_redirect\|x-forwarded-proto.*https\|http.*redirect.*https" \
        "$SERVER_FILE" 2>/dev/null; then
        info "  HTTPS redirect already present in server/index.js — skipping"
        return
      fi

      if [[ "$DRY_RUN" == "true" ]]; then
        info "  [DRY-RUN] Would add HTTP→HTTPS redirect middleware"
        return
      fi

      local snippet="app.use((req, res, next) => { if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') { return res.redirect(301, 'https://' + req.hostname + req.url); } next(); }); // auto-fix: add_https_redirect"

      if grep -q "app.set('trust proxy'" "$SERVER_FILE"; then
        perl -i -0pe \
          "s|(app\.set\('trust proxy'[^;]+;)|\$1\n${snippet}|" \
          "$SERVER_FILE"
        ok "  Injected HTTP→HTTPS redirect middleware into server/index.js"
        CHANGES_MADE=true
      else
        warn "  Could not find injection point in server/index.js for HTTPS redirect"
      fi
      ;;

    # ── Fix manifest.json content-type
    fix_manifest_content_type)
      if grep -q "manifest\.json" "$SERVER_FILE" 2>/dev/null; then
        info "  manifest.json route already present in server/index.js — skipping"
        return
      fi

      if [[ "$DRY_RUN" == "true" ]]; then
        info "  [DRY-RUN] Would add manifest.json explicit route"
        return
      fi

      # Add explicit route before express.static
      local snippet="app.get('/manifest.json', (_req, res) => { res.type('application/manifest+json'); res.sendFile(require('path').join(__dirname, '..', 'app', 'manifest.json')); }); // auto-fix: fix_manifest_content_type"

      if grep -q "express.static" "$SERVER_FILE"; then
        perl -i -0pe \
          "s|(app\.use\(express\.static)|\n${snippet}\n\n\$1|" \
          "$SERVER_FILE"
        ok "  Injected manifest.json route into server/index.js"
        CHANGES_MADE=true
      else
        warn "  Could not find express.static injection point for manifest.json fix"
      fi
      ;;

    # ── CSP (already configured via helmet — just warn)
    add_csp)
      if grep -q "contentSecurityPolicy\|Content-Security-Policy" "$SERVER_FILE" 2>/dev/null; then
        info "  CSP already configured in server/index.js — skipping"
      else
        warn "  CSP not found in server/index.js — manual configuration required"
      fi
      ;;

    *)
      warn "  Unknown fix action: $fix_action — skipping"
      ;;
  esac
}

# Apply each distinct fix
while IFS= read -r fix_action; do
  [[ -z "$fix_action" ]] && continue
  apply_fix "$fix_action"
done <<< "$FIXES"

# ─── Log non-auto-fixable issues ─────────────────────────────────────────────
header "Non-Auto-Fixable Issues (manual review required)"

NO_FIX_ISSUES=$(jq -r '.issues[] | select(.fix_action == "none") |
  "  [\(.severity | ascii_upcase)] \(.description)\n  URL: \(.url)"' \
  "$REPORT_FILE" 2>/dev/null || true)

if [[ -n "$NO_FIX_ISSUES" ]]; then
  warn "The following issues require manual intervention:"
  echo "$NO_FIX_ISSUES" | while IFS= read -r line; do warn "$line"; done
fi

# ─── Commit & PR ─────────────────────────────────────────────────────────────
header "Creating Branch and Pull Request"

if [[ "$CHANGES_MADE" != "true" ]]; then
  info "No code changes were made — skipping branch/PR creation"
  exit 0
fi

if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Would create branch fix/auto-repair-${TIMESTAMP} and open PR"
  exit 0
fi

BRANCH_NAME="fix/auto-repair-${TIMESTAMP}"
BASE_BRANCH=$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

git -C "$PROJECT_DIR" checkout -b "$BRANCH_NAME"
git -C "$PROJECT_DIR" add server/index.js
git -C "$PROJECT_DIR" commit -m "fix: auto-repair scan issues detected at ${TIMESTAMP}

Applied auto-fixes from scan report: $(basename "$REPORT_FILE")
$(echo "$FIXES" | sed 's/^/- /')
"

git -C "$PROJECT_DIR" push origin "$BRANCH_NAME"
ok "Branch pushed: $BRANCH_NAME"

# Open PR via gh CLI
PR_BODY="## Auto-Fix PR

**Generated by:** \`scripts/auto-fix.sh\`  
**Scan report:** \`$(basename "$REPORT_FILE")\`  
**Timestamp:** \`${TIMESTAMP}\`

### Applied Fixes
$(echo "$FIXES" | sed 's/^/- /')

### Non-Auto-Fixed Issues (manual review)
$(jq -r '.issues[] | select(.fix_action == "none") | "- [\(.severity | ascii_upcase)] \(.description)"' \
  "$REPORT_FILE" 2>/dev/null || echo "- None")

> This PR was created automatically. Please review the changes before merging.
"

PR_URL=$(gh pr create \
  --repo "$GH_REPO" \
  --base "$BASE_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "fix: auto-repair live scan issues (${TIMESTAMP})" \
  --body "$PR_BODY" \
  2>&1 || true)

if echo "$PR_URL" | grep -q "https://"; then
  PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$' | tail -1 || echo "")
  ok "PR created: $PR_URL"
  # Export for use by scan-fix-deploy.sh
  echo "PR_URL=${PR_URL}" > /tmp/auto-fix-pr.env
  echo "PR_NUMBER=${PR_NUMBER}" >> /tmp/auto-fix-pr.env
  echo "BRANCH_NAME=${BRANCH_NAME}" >> /tmp/auto-fix-pr.env
else
  warn "PR creation output: $PR_URL"
  warn "Could not confirm PR was created. Check GitHub manually."
fi

header "Auto-Fix Complete"
info "Changes committed on branch: $BRANCH_NAME"
exit 0
