#!/bin/bash
# Automated cleanup. Usage: cleanup.sh [--dry-run]
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh" || { echo "config.sh missing"; exit 1; }
DRY=0; [ "$1" = "--dry-run" ] && DRY=1
total=0
before=$(df --output=used -k / | tail -1 | tr -d " ")

clean() {  # clean <dir> <days> <name-pattern>
    local dir="$1" days="$2" pat="$3" n
    [ -d "$dir" ] || { echo "  [skip] $dir does not exist"; return; }
    n=$(find "$dir" -xdev -type f -name "$pat" -mtime +"$days" 2>/dev/null | wc -l)
    if [ "$DRY" -eq 1 ]; then
        find "$dir" -xdev -type f -name "$pat" -mtime +"$days" 2>/dev/null | head -3 | sed "s/^/        would delete: /"
    else
        find "$dir" -xdev -type f -name "$pat" -mtime +"$days" -delete 2>/dev/null
    fi
    printf "  %-10s pattern %-8s older than %2s days : %s file(s)\n" "$dir" "$pat" "$days" "$n"
    total=$((total + n))
}

[ "$DRY" -eq 1 ] && echo "=== CLEANUP PREVIEW (nothing is deleted) ===" || echo "=== CLEANUP RUNNING ==="
clean /tmp 7 "*"
clean /var/tmp 30 "*"
clean /home 7 "*.tmp"
clean /home 7 "*~"
clean /home 7 "core"
clean /var/log 30 "*.gz"

if [ "$DRY" -eq 0 ]; then
    [ -d "$LOG_DIR" ] && find "$LOG_DIR" -name "*.log" -mtime +7 -exec gzip -f {} \; 2>/dev/null   # compress old logs
    apt-get clean 2>/dev/null
    after=$(df --output=used -k / | tail -1 | tr -d " ")
    freed=$(( (before - after) / 1024 ))
    echo "Total files removed: $total | Space freed: ${freed} MB"
    log INFO "cleanup finished: $total files, ${freed}MB freed"
else
    echo "Total files that WOULD be removed: $total"
fi
