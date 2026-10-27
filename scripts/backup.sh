#!/bin/bash
# Backup shared repos + account files, verify the archive, delete old backups.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh" || { echo "config.sh missing"; exit 1; }
mkdir -p "$BACKUP_DIR" || { echo "Cannot create $BACKUP_DIR"; exit 1; }
[ -d "$REPO_DIR" ] || { echo "[ERROR] $REPO_DIR does not exist - nothing to back up."; log ERROR "backup failed: no repo dir"; exit 1; }

file="$BACKUP_DIR/backup_$(date +%F_%H%M%S).tar.gz"
if tar -czf "$file" -C / "${REPO_DIR#/}" etc/passwd etc/group 2>/dev/null; then
    if tar -tzf "$file" >/dev/null 2>&1; then
        echo "[OK] Backup created and verified: $file ($(du -h "$file" | cut -f1))"
        log INFO "backup ok: $file"
    else
        echo "[ERROR] Archive failed verification"; rm -f "$file"; log ERROR "backup corrupt"; exit 1
    fi
else
    echo "[ERROR] tar failed"; rm -f "$file"; log ERROR "backup tar failed"; exit 1
fi
old=$(find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +"$KEEP_BACKUPS_DAYS" | wc -l)
find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +"$KEEP_BACKUPS_DAYS" -delete
echo "[OK] Retention: removed $old backup(s) older than $KEEP_BACKUPS_DAYS days."
