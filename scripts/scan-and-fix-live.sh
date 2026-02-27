#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# KelionAI v2 — Live Site Scanner
#
# Scans https://kelionai.app LIVE and checks:
#   - HTTP endpoints (status codes, response time < 3s)
#   - Security headers (X-Frame-Options, CSP, HSTS, X-Content-Type-Options,
#     Referrer-Policy)
#   - HTTPS / SSL certificate validity
#   - Performance (compression, cache headers)
#   - Page content (avatar canvas, pricing plans, onboarding steps, navbar,
#     footer)
#
# Usage:
#   bash scripts/scan-and-fix-live.sh [--base-url=URL] [--dry-run]
#
# Output:
#   reports/live-scan-{timestamp}.json   — machine-readable results
#   reports/live-scan-{timestamp}.md     — human-readable report
#   logs/scan-{timestamp}.log            — full console log
#
# Exit codes:
#   0 — all checks passed (or dry-run)
#   1 — one or more checks failed
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Timestamps & paths ───────────────────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
TIMESTAMP_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
mkdir -p logs reports
LOG_FILE="logs/scan-${TIMESTAMP}.log"
JSON_REPORT="reports/live-scan-${TIMESTAMP}.json"
MD_REPORT="reports/live-scan-${TIMESTAMP}.md"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()    { echo -e "$*" | tee -a "$LOG_FILE"; }
ok()     { log "${GREEN}✅  $*${NC}";      PASS=$((PASS + 1)); }
fail()   { log "${RED}❌  $*${NC}";        FAIL=$((FAIL + 1)); }
warn()   { log "${YELLOW}⚠️   $*${NC}";    WARN=$((WARN + 1)); }
skip()   { log "${YELLOW}⏭️   SKIP: $*${NC}"; }
info()   { log "${CYAN}ℹ️   $*${NC}"; }
header() { log "\n${BOLD}${CYAN}══ $* ══${NC}"; }

# ─── Counters ────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
WARN=0
CHECKS_JSON="[]"
ISSUES_JSON="[]"

# ─── JSON accumulators ───────────────────────────────────────────────────────
add_check() {
  local id="$1" category="$2" name="$3" url="$4" status="$5"
  local http_code="${6:-}" resp_time="${7:-}" details="${8:-}"
  CHECKS_JSON=$(printf '%s' "$CHECKS_JSON" | jq \
    --arg id       "$id"        \
    --arg cat      "$category"  \
    --arg name     "$name"      \
    --arg url      "$url"       \
    --arg status   "$status"    \
    --arg code     "$http_code" \
    --arg time     "$resp_time" \
    --arg details  "$details"   \
    '. += [{
       "id":            $id,
       "category":      $cat,
       "name":          $name,
       "url":           $url,
       "status":        $status,
       "http_code":     $code,
       "response_time": $time,
       "details":       $details
     }]')
}

add_issue() {
  local id="$1" category="$2" severity="$3" description="$4" url="$5"
  local fix_action="${6:-none}"
  ISSUES_JSON=$(printf '%s' "$ISSUES_JSON" | jq \
    --arg id    "$id"          \
    --arg cat   "$category"    \
    --arg sev   "$severity"    \
    --arg desc  "$description" \
    --arg url   "$url"         \
    --arg fix   "$fix_action"  \
    '. += [{
       "id":          $id,
       "category":    $cat,
       "severity":    $sev,
       "description": $desc,
       "url":         $url,
       "fix_action":  $fix
     }]')
}

# ─── Defaults ────────────────────────────────────────────────────────────────
BASE_URL="${BASE_URL:-https://kelionai.app}"
DRY_RUN=false
RESPONSE_TIME_LIMIT=3   # seconds

for arg in "$@"; do
  case "$arg" in
    --base-url=*) BASE_URL="${arg#*=}" ;;
    --dry-run)    DRY_RUN=true ;;
  esac
done

# ─── Tool check ──────────────────────────────────────────────────────────────
for tool in curl jq openssl; do
  if ! command -v "$tool" &>/dev/null; then
    echo -e "${RED}❌  Required tool not found: $tool${NC}"
    exit 1
  fi
done

# ─── Banner ──────────────────────────────────────────────────────────────────
header "KelionAI v2 — Live Site Scanner"
info "Base URL   : $BASE_URL"
info "Timestamp  : $TIMESTAMP_ISO"
info "Log        : $LOG_FILE"
info "JSON       : $JSON_REPORT"
info "Markdown   : $MD_REPORT"

# ─── Dry-run mode ────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  info "[DRY-RUN] Skipping all HTTP requests — generating empty report"

  jq -n \
    --arg ts      "$TIMESTAMP_ISO" \
    --arg base    "$BASE_URL"      \
    '{timestamp: $ts, base_url: $base,
      summary: {total: 0, pass: 0, fail: 0, warn: 0, score: "N/A"},
      checks: [], issues: []}' > "$JSON_REPORT"

  printf '# KelionAI Live Scan Report\n\n**DRY-RUN** — no checks performed.\n' \
    > "$MD_REPORT"

  ok "Dry-run complete"
  exit 0
fi

# ═════════════════════════════════════════════════════════════════════════════
# HTTP ENDPOINT CHECKS
# ═════════════════════════════════════════════════════════════════════════════
header "HTTP Endpoint Checks"

check_http() {
  local id="$1" path="$2" name="$3" expected_code="${4:-200}"
  local url="${BASE_URL}${path}"
  local tmp
  tmp=$(mktemp)

  local result http_code elapsed
  result=$(curl -s -o "$tmp" -w "%{http_code} %{time_total}" \
    --max-time 15 -L --max-redirs 5 "$url" 2>/dev/null || echo "000 0")
  http_code=$(echo "$result" | awk '{print $1}')
  elapsed=$(echo "$result" | awk '{print $2}')
  rm -f "$tmp"

  if [[ "$http_code" == "000" ]]; then
    fail "[$http_code] $name ($url) — connection failed"
    add_check "$id" "http" "$name" "$url" "fail" "$http_code" "$elapsed" \
      "Connection failed"
    add_issue "${id}.conn" "http" "fail" \
      "Cannot connect to $url" "$url" "none"
    return
  fi

  if [[ "$http_code" != "$expected_code" ]]; then
    fail "[$http_code] $name ($url) — expected HTTP $expected_code"
    add_check "$id" "http" "$name" "$url" "fail" "$http_code" "$elapsed" \
      "Expected $expected_code, got $http_code"
    add_issue "${id}.status" "http" "fail" \
      "Unexpected HTTP $http_code on $url (expected $expected_code)" "$url" "none"
    return
  fi

  # Response time check
  local elapsed_ms
  elapsed_ms=$(echo "$elapsed" | awk '{printf "%d", $1 * 1000}')
  if [[ "$elapsed_ms" -ge "$((RESPONSE_TIME_LIMIT * 1000))" ]]; then
    warn "[$http_code] $name ($url) — slow: ${elapsed}s (>${RESPONSE_TIME_LIMIT}s threshold)"
    add_check "$id" "http" "$name" "$url" "warn" "$http_code" "$elapsed" \
      "Response time ${elapsed}s exceeds ${RESPONSE_TIME_LIMIT}s"
    add_issue "${id}.slow" "http" "warn" \
      "Slow response (${elapsed}s) on $url" "$url" "none"
    return
  fi

  ok "[$http_code] $name ($url) — ${elapsed}s"
  add_check "$id" "http" "$name" "$url" "pass" "$http_code" "$elapsed" "OK"
}

check_http "http.homepage"    "/"                "Homepage"                  "200"
check_http "http.health"      "/api/health"      "API Health"                "200"
check_http "http.pricing"     "/pricing/"        "Pricing page"              "200"
check_http "http.settings"    "/settings"        "Settings page"             "200"
check_http "http.developer"   "/developer"       "Developer page"            "200"
check_http "http.onboarding"  "/onboarding.html" "Onboarding page"           "200"
check_http "http.manifest"    "/manifest.json"   "Web App Manifest"          "200"
check_http "http.sw"          "/sw.js"           "Service Worker"            "200"
check_http "http.error"       "/error.html"      "Error page"                "200"
check_http "http.404"         "/404.html"        "404 page"                  "200"

# Unknown URL — must not 5xx (SPA catch-all or 404 page)
unknown_url="${BASE_URL}/totally-unknown-xyz-page-test-404abc"
unknown_code=$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 15 "$unknown_url" 2>/dev/null || echo "000")
if [[ "${unknown_code:0:1}" == "5" ]]; then
  fail "Unknown page returns 5xx ($unknown_code) on $unknown_url"
  add_check "http.unknown" "http" "Unknown page — no 5xx" "$unknown_url" \
    "fail" "$unknown_code" "" "Returns 5xx instead of SPA/404"
  add_issue "http.unknown.5xx" "http" "fail" \
    "Unknown pages return 5xx ($unknown_code)" "${BASE_URL}/*" "none"
else
  ok "Unknown page returns $unknown_code — no 5xx ($unknown_url)"
  add_check "http.unknown" "http" "Unknown page — no 5xx" "$unknown_url" \
    "pass" "$unknown_code" "" "Returns $unknown_code (no 5xx)"
fi

# Zero 5xx checks on key routes
header "Zero 5xx Checks"
for path in "/api/health" "/" "/api/payments/plans" "/api/legal/terms" "/pricing/"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 15 "${BASE_URL}${path}" 2>/dev/null || echo "000")
  if [[ "${code:0:1}" == "5" ]]; then
    fail "5xx detected on $path ($code)"
    add_issue "http.5xx$(echo "$path" | tr '/' '_')" "http" "fail" \
      "5xx response ($code) on $path" "${BASE_URL}${path}" "none"
  else
    ok "No 5xx on $path ($code)"
  fi
done

# ═════════════════════════════════════════════════════════════════════════════
# SECURITY HEADER CHECKS
# ═════════════════════════════════════════════════════════════════════════════
header "Security Header Checks"

HEADERS_URL="${BASE_URL}/"
RESP_HEADERS=$(curl -sI --max-time 15 "$HEADERS_URL" 2>/dev/null || true)

check_header() {
  local id="$1" header_name="$2" expected_value="${3:-}" fix_action="${4:-none}"

  if echo "$RESP_HEADERS" | grep -qi "^${header_name}:"; then
    local present_value
    present_value=$(echo "$RESP_HEADERS" | grep -i "^${header_name}:" | head -1 | cut -d: -f2- | xargs)
    if [[ -n "$expected_value" ]] && ! echo "$present_value" | grep -qi "$expected_value"; then
      warn "$header_name present but unexpected value: '$present_value' (expected: '$expected_value')"
      add_check "$id" "security" "$header_name" "$HEADERS_URL" "warn" "" "" \
        "Present but value '$present_value' does not match '$expected_value'"
      add_issue "$id.value" "security" "warn" \
        "$header_name has unexpected value: '$present_value'" "$HEADERS_URL" "none"
    else
      ok "$header_name: $present_value"
      add_check "$id" "security" "$header_name" "$HEADERS_URL" "pass" "" "" \
        "Present: $present_value"
    fi
  else
    fail "$header_name MISSING on $HEADERS_URL"
    add_check "$id" "security" "$header_name" "$HEADERS_URL" "fail" "" "" \
      "Header missing"
    add_issue "$id" "security" "fail" \
      "$header_name header missing" "$HEADERS_URL" "$fix_action"
  fi
}

check_header "sec.x_frame_options"  "X-Frame-Options"           ""        \
  "add_security_header:X-Frame-Options:DENY"
check_header "sec.x_content_type"   "X-Content-Type-Options"    "nosniff" \
  "add_security_header:X-Content-Type-Options:nosniff"
check_header "sec.hsts"             "Strict-Transport-Security" ""        \
  "add_hsts"
check_header "sec.csp"              "Content-Security-Policy"   ""        \
  "add_csp"
check_header "sec.referrer_policy"  "Referrer-Policy"           ""        \
  "add_security_header:Referrer-Policy:no-referrer-when-downgrade"

# HTTPS functional + HTTP → HTTPS redirect
if [[ "$BASE_URL" == https://* ]]; then
  http_base="${BASE_URL/https:\/\//http:\/\/}"
  https_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 15 "$BASE_URL/" 2>/dev/null || echo "000")
  if [[ "$https_code" == "200" ]] || [[ "${https_code:0:1}" == "3" ]]; then
    ok "HTTPS functional (HTTP $https_code)"
    add_check "sec.https" "security" "HTTPS functional" "$BASE_URL/" "pass" \
      "$https_code" "" "HTTPS responding"
  else
    fail "HTTPS not responding (HTTP $https_code)"
    add_check "sec.https" "security" "HTTPS functional" "$BASE_URL/" "fail" \
      "$https_code" "" "HTTPS not responding"
    add_issue "sec.https" "security" "fail" "HTTPS not responding" "$BASE_URL/" "none"
  fi

  redir_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 15 --max-redirs 0 "${http_base}/" 2>/dev/null || echo "000")
  if [[ "$redir_code" == "301" ]] || [[ "$redir_code" == "302" ]]; then
    ok "HTTP → HTTPS redirect: $redir_code"
    add_check "sec.http_redirect" "security" "HTTP→HTTPS redirect" \
      "${http_base}/" "pass" "$redir_code" "" "Redirect working"
  else
    warn "HTTP → HTTPS redirect not detected (HTTP $redir_code from ${http_base}/)"
    add_check "sec.http_redirect" "security" "HTTP→HTTPS redirect" \
      "${http_base}/" "warn" "$redir_code" "" "No redirect detected"
    add_issue "sec.http_redirect" "security" "warn" \
      "HTTP not redirecting to HTTPS (got $redir_code)" "${http_base}/" \
      "add_https_redirect"
  fi
fi

# ═════════════════════════════════════════════════════════════════════════════
# SSL CERTIFICATE CHECK
# ═════════════════════════════════════════════════════════════════════════════
header "SSL Certificate Check"

HOST="${BASE_URL#*://}"
HOST="${HOST%%/*}"
HOST="${HOST%%:*}"

CERT_INFO=$(echo | timeout 10 openssl s_client \
  -connect "${HOST}:443" -servername "$HOST" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null || echo "error")

if echo "$CERT_INFO" | grep -q "notAfter"; then
  EXPIRY_STR=$(echo "$CERT_INFO" | grep "notAfter" | cut -d= -f2)
  # Cross-platform epoch from date string; empty string signals parse failure
  EXPIRY_EPOCH=$(date -d "$EXPIRY_STR" +%s 2>/dev/null \
    || date -j -f "%b %d %T %Y %Z" "$EXPIRY_STR" +%s 2>/dev/null \
    || true)

  if [[ -z "$EXPIRY_EPOCH" ]]; then
    warn "Could not parse SSL certificate expiry date: '$EXPIRY_STR'"
    add_check "ssl.cert" "ssl" "Certificate validity" "$BASE_URL" "warn" "" "" \
      "Could not parse expiry date: $EXPIRY_STR"
  else
    NOW_EPOCH=$(date +%s)
    DAYS_REMAINING=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

    if [[ "$DAYS_REMAINING" -lt 0 ]]; then
      fail "SSL certificate EXPIRED on $EXPIRY_STR"
      add_check "ssl.cert" "ssl" "Certificate validity" "$BASE_URL" "fail" "" "" \
        "Certificate expired on $EXPIRY_STR"
      add_issue "ssl.cert.expired" "ssl" "fail" \
        "SSL certificate expired on $EXPIRY_STR" "$BASE_URL" "none"
    elif [[ "$DAYS_REMAINING" -lt 30 ]]; then
      warn "SSL certificate expires in $DAYS_REMAINING days ($EXPIRY_STR) — ALERT"
      add_check "ssl.cert" "ssl" "Certificate validity" "$BASE_URL" "warn" "" "" \
        "Expires in $DAYS_REMAINING days on $EXPIRY_STR"
      add_issue "ssl.cert.expiring" "ssl" "warn" \
        "SSL certificate expires in $DAYS_REMAINING days ($EXPIRY_STR)" \
        "$BASE_URL" "none"
    else
      ok "SSL certificate valid — expires in $DAYS_REMAINING days ($EXPIRY_STR)"
      add_check "ssl.cert" "ssl" "Certificate validity" "$BASE_URL" "pass" "" "" \
        "Valid, expires in $DAYS_REMAINING days"
    fi
  fi
else
  warn "Could not retrieve SSL certificate info for $HOST"
  add_check "ssl.cert" "ssl" "Certificate validity" "$BASE_URL" "warn" "" "" \
    "Could not retrieve certificate info"
fi

# ═════════════════════════════════════════════════════════════════════════════
# PERFORMANCE CHECKS
# ═════════════════════════════════════════════════════════════════════════════
header "Performance Checks"

# Gzip / Brotli compression
COMP_HEADERS=$(curl -sI --max-time 15 \
  -H "Accept-Encoding: gzip, br" "$BASE_URL/" 2>/dev/null || true)
if echo "$COMP_HEADERS" | grep -qi \
  "content-encoding: gzip\|content-encoding: br\|content-encoding: deflate"; then
  ok "Compression (gzip/Brotli) active on homepage"
  add_check "perf.compression" "performance" "Compression (gzip/Brotli)" \
    "$BASE_URL/" "pass" "" "" "Compression active"
else
  warn "Compression not detected on homepage (no content-encoding header)"
  add_check "perf.compression" "performance" "Compression (gzip/Brotli)" \
    "$BASE_URL/" "warn" "" "" "No compression header detected"
  add_issue "perf.compression" "performance" "warn" \
    "gzip/Brotli compression not active" "$BASE_URL/" "none"
fi

# Cache headers on static assets (manifest.json)
CACHE_HEADERS=$(curl -sI --max-time 15 \
  "${BASE_URL}/manifest.json" 2>/dev/null || true)
if echo "$CACHE_HEADERS" | grep -qi "cache-control\|etag\|last-modified"; then
  ok "Cache headers present on static assets (manifest.json)"
  add_check "perf.cache" "performance" "Cache headers on static assets" \
    "${BASE_URL}/manifest.json" "pass" "" "" "Cache headers present"
else
  warn "No cache headers on static asset manifest.json"
  add_check "perf.cache" "performance" "Cache headers on static assets" \
    "${BASE_URL}/manifest.json" "warn" "" "" "No cache headers detected"
  add_issue "perf.cache" "performance" "warn" \
    "No cache headers on static assets" "${BASE_URL}/manifest.json" "none"
fi

# ═════════════════════════════════════════════════════════════════════════════
# CONTENT CHECKS
# ═════════════════════════════════════════════════════════════════════════════
header "Content Checks"

check_content() {
  local id="$1" url="$2" name="$3" pattern="$4"
  local body
  body=$(curl -s --max-time 15 "$url" 2>/dev/null || true)
  if echo "$body" | grep -qiE "$pattern"; then
    ok "$name — pattern found"
    add_check "$id" "content" "$name" "$url" "pass" "" "" "Pattern found"
  else
    fail "$name — pattern '$pattern' NOT found on $url"
    add_check "$id" "content" "$name" "$url" "fail" "" "" \
      "Pattern '$pattern' not found"
    add_issue "$id" "content" "fail" \
      "$name: pattern '$pattern' not found on $url" "$url" "none"
  fi
}

check_content "content.canvas"     "${BASE_URL}/"             \
  "Homepage — avatar canvas"    "canvas|avatar-canvas"
check_content "content.pricing"    "${BASE_URL}/pricing/"     \
  "Pricing — plan cards"        "Free|Pro|Premium"
check_content "content.onboarding" "${BASE_URL}/onboarding.html" \
  "Onboarding — setup steps"   "step|setup|onboard"
check_content "content.navbar"     "${BASE_URL}/"             \
  "Homepage — navbar"           "<nav|navbar|header"
check_content "content.footer"     "${BASE_URL}/"             \
  "Homepage — footer"           "<footer|footer"

# manifest.json content-type must be application/json
MANIFEST_CT=$(curl -sI --max-time 15 "${BASE_URL}/manifest.json" 2>/dev/null \
  | grep -i "^content-type:" | head -1 | cut -d: -f2- | xargs || true)
if echo "$MANIFEST_CT" | grep -qi "application/json\|application/manifest"; then
  ok "manifest.json Content-Type: $MANIFEST_CT"
  add_check "content.manifest_ct" "content" "manifest.json Content-Type" \
    "${BASE_URL}/manifest.json" "pass" "" "" "Correct JSON content-type"
else
  warn "manifest.json unexpected Content-Type: '${MANIFEST_CT:-not set}'"
  add_check "content.manifest_ct" "content" "manifest.json Content-Type" \
    "${BASE_URL}/manifest.json" "warn" "" "" \
    "Unexpected content-type: ${MANIFEST_CT:-not set}"
  add_issue "content.manifest_ct" "content" "warn" \
    "manifest.json Content-Type: '${MANIFEST_CT:-not set}'" \
    "${BASE_URL}/manifest.json" "fix_manifest_content_type"
fi

# ═════════════════════════════════════════════════════════════════════════════
# GENERATE REPORTS
# ═════════════════════════════════════════════════════════════════════════════
header "Generating Reports"

TOTAL=$((PASS + FAIL + WARN))
if [[ "$TOTAL" -gt 0 ]]; then
  SCORE=$(( (PASS * 100) / TOTAL ))
else
  SCORE=100
fi

# ── JSON report ───────────────────────────────────────────────────────────────
jq -n \
  --arg  ts       "$TIMESTAMP_ISO" \
  --arg  base_url "$BASE_URL"      \
  --argjson total  "$TOTAL"        \
  --argjson pass   "$PASS"         \
  --argjson fail   "$FAIL"         \
  --argjson warn   "$WARN"         \
  --arg  score    "${SCORE}%"      \
  --argjson checks "$CHECKS_JSON"  \
  --argjson issues "$ISSUES_JSON"  \
  '{
    timestamp: $ts,
    base_url:  $base_url,
    summary: {
      total: $total,
      pass:  $pass,
      fail:  $fail,
      warn:  $warn,
      score: $score
    },
    checks: $checks,
    issues: $issues
  }' > "$JSON_REPORT"

ok "JSON report written: $JSON_REPORT"

# ── Markdown report ───────────────────────────────────────────────────────────
{
  printf '# KelionAI Live Scan Report\n\n'
  printf '**Timestamp:** %s  \n' "$TIMESTAMP_ISO"
  printf '**Base URL:** %s  \n' "$BASE_URL"
  printf '**Score:** %s%% (%d passed, %d failed, %d warnings / %d total)\n\n' \
    "$SCORE" "$PASS" "$FAIL" "$WARN" "$TOTAL"
  printf '## Summary\n\n'
  printf '| Status | Count |\n|--------|-------|\n'
  printf '| ✅ PASS | %d |\n| ❌ FAIL | %d |\n| ⚠️ WARN | %d |\n| **Total** | **%d** |\n\n' \
    "$PASS" "$FAIL" "$WARN" "$TOTAL"

  printf '## Issues Found\n\n'
  if [[ "$FAIL" -gt 0 ]] || [[ "$WARN" -gt 0 ]]; then
    printf '%s' "$ISSUES_JSON" | jq -r \
      '.[] | "- **[\(.severity | ascii_upcase)]** \(.description)  \n  URL: `\(.url)`  \n  Fix: `\(.fix_action)`\n"'
  else
    printf '_No issues found — all checks passed._\n'
  fi

  printf '\n## All Checks\n\n'
  printf '| ID | Category | Name | Status | HTTP | Time | Details |\n'
  printf '|----|----------|------|--------|------|------|---------|\n'
  printf '%s' "$CHECKS_JSON" | jq -r \
    '.[] | "| \(.id) | \(.category) | \(.name) | \(.status) | \(.http_code) | \(.response_time) | \(.details) |"'
} > "$MD_REPORT"

ok "Markdown report written: $MD_REPORT"

# ═════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ═════════════════════════════════════════════════════════════════════════════
header "Scan Summary"
log "${GREEN}  PASS : $PASS${NC}"
log "${RED}  FAIL : $FAIL${NC}"
log "${YELLOW}  WARN : $WARN${NC}"
log "${BOLD}  TOTAL: $TOTAL — Score: ${SCORE}%${NC}"
log ""
info "JSON report : $JSON_REPORT"
info "MD report   : $MD_REPORT"
log ""

if [[ "$FAIL" -eq 0 ]]; then
  log "${BOLD}${GREEN}  ✅ All checks passed! Score: ${SCORE}%${NC}"
  exit 0
else
  log "${BOLD}${RED}  ❌ ${FAIL} check(s) failed. Score: ${SCORE}%${NC}"
  exit 1
fi
