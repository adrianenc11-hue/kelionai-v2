#!/usr/bin/env bash
# backup.sh — Backup configurations and application data
# Retains backups for 30 days

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/backup_${TIMESTAMP}.tar.gz"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting backup at $TIMESTAMP"

# Collect files to back up
FILES_TO_BACKUP=()

# Configuration files (non-sensitive)
[ -f "package.json" ]     && FILES_TO_BACKUP+=("package.json")
[ -f "package-lock.json" ] && FILES_TO_BACKUP+=("package-lock.json")
[ -f "lighthouserc.js" ]  && FILES_TO_BACKUP+=("lighthouserc.js")
[ -f "playwright.config.js" ] && FILES_TO_BACKUP+=("playwright.config.js")
[ -d "server" ]           && FILES_TO_BACKUP+=("server")
[ -d "app" ]              && FILES_TO_BACKUP+=("app")
[ -d "scripts" ]          && FILES_TO_BACKUP+=("scripts")

# Export database if pg_dump is available
DUMP_FILE=""
if command -v pg_dump &>/dev/null && [ -n "${DATABASE_URL:-}" ]; then
    # Use a private temp dir (umask 077 ensures mode 600)
    DUMP_FILE=$(umask 077 && mktemp /tmp/db_dump_XXXXXX.sql)
    echo "[Backup] Exporting database..."
    if pg_dump "$DATABASE_URL" > "$DUMP_FILE"; then
        FILES_TO_BACKUP+=("$DUMP_FILE")
    else
        echo "[Backup] WARNING: pg_dump failed, skipping database backup" >&2
        rm -f "$DUMP_FILE"
        DUMP_FILE=""
    fi
fi

# Create compressed archive
tar -czf "$BACKUP_FILE" "${FILES_TO_BACKUP[@]}"
echo "[Backup] Created: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

# Remove DB dump temp file
[ -n "${DUMP_FILE}" ] && rm -f "$DUMP_FILE"

# Enforce 30-day retention
DELETED=0
while IFS= read -r -d '' OLD_FILE; do
    rm -f "$OLD_FILE"
    DELETED=$((DELETED + 1))
done < <(find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime "+${RETENTION_DAYS}" -print0)

[ "$DELETED" -gt 0 ] && echo "[Backup] Removed $DELETED backup(s) older than ${RETENTION_DAYS} days"
echo "[Backup] Done."
