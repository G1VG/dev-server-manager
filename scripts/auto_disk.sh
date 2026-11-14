#!/bin/bash
# ==============================================================================
# Auto Disk Management System
# Features:
#   1. Automatic LVM Online Volume Expansion when threshold (80%) is exceeded.
#   2. Emergency Automated Disk Cleanup when critical threshold (90%) is exceeded.
# Usage:
#   sudo ./scripts/auto_disk.sh [--check | --test-grow | --status]
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh" 2>/dev/null || source "$SCRIPT_DIR/config.sh" 2>/dev/null || {
    GROUP="developers"
    REPO_DIR="/srv/repos"
    BACKUP_DIR="/srv/backups"
    VG="vg_dev"
    LV_REPOS="lv_repos"
    LV_BACKUP="lv_backup"
    LOG_DIR="/var/log/devserver"
    LOG_FILE="$LOG_DIR/activity.log"
    AUTO_EXTEND_THRESHOLD=80
    AUTO_EXTEND_MB=300
    EMERGENCY_CLEANUP_THRESHOLD=90
    log() { mkdir -p "$LOG_DIR" 2>/dev/null; echo "$(date '+%F %T') [$1] $2" >> "$LOG_FILE" 2>/dev/null; }
}

AUTO_EXTEND_THRESHOLD="${AUTO_EXTEND_THRESHOLD:-80}"
AUTO_EXTEND_MB="${AUTO_EXTEND_MB:-300}"
EMERGENCY_CLEANUP_THRESHOLD="${EMERGENCY_CLEANUP_THRESHOLD:-90}"

ok()   { echo -e "\e[32m  [OK]\e[0m $*"; }
warn() { echo -e "\e[33m  [WARN]\e[0m $*"; }
err()  { echo -e "\e[31m  [ERROR]\e[0m $*"; }
info() { echo -e "\e[36m  [INFO]\e[0m $*"; }

mkdir -p "$LOG_DIR" 2>/dev/null

get_disk_pct() {
    local mp="$1"
    if mountpoint -q "$mp" 2>/dev/null; then
        df -P "$mp" | awk 'NR==2 {gsub("%","",$5); print $5}'
    else
        echo "-1"
    fi
}

check_and_auto_expand() {
    local lv="$1" mp="$2"
    local pct
    pct=$(get_disk_pct "$mp")
    [ "$pct" -eq -1 ] && return

    echo "  Checking $mp ($lv): current usage is ${pct}% (Auto-expand threshold: ${AUTO_EXTEND_THRESHOLD}%)"

    if [ "$pct" -ge "$AUTO_EXTEND_THRESHOLD" ]; then
        warn "Volume $lv at $mp exceeded ${AUTO_EXTEND_THRESHOLD}% (currently ${pct}%)!"
        if ! vgs "$VG" &>/dev/null; then
            err "Volume group '$VG' not active. Cannot auto-expand."
            return
        fi

        local free
        free=$(vgs --noheadings --units m --nosuffix -o vg_free "$VG" 2>/dev/null | awk '{printf "%d", $1}')
        info "Free space remaining in volume group '$VG': ${free} MB"

        if [ "$free" -ge "$AUTO_EXTEND_MB" ]; then
            info "Triggering AUTOMATIC ONLINE EXPANSION: growing $lv by +${AUTO_EXTEND_MB}MB..."
            if lvextend -r -L +"${AUTO_EXTEND_MB}M" "/dev/$VG/$lv" >/dev/null 2>&1; then
                local new_pct
                new_pct=$(get_disk_pct "$mp")
                ok "Auto-expansion succeeded! $lv enlarged by ${AUTO_EXTEND_MB}MB. New usage: ${new_pct}%"
                log "AUTO-GROW" "Volume $lv ($mp) automatically extended by ${AUTO_EXTEND_MB}MB (was at ${pct}%, now at ${new_pct}%)"
            else
                err "lvextend failed for $lv"
                log "ERROR" "Auto-expansion failed for $lv"
            fi
        else
            err "Insufficient pool space in $VG (${free}MB free, needed ${AUTO_EXTEND_MB}MB). Triggering emergency cleanup..."
            emergency_cleanup
        fi
    else
        ok "$mp ($lv) usage (${pct}%) is healthy."
    fi
}

emergency_cleanup() {
    warn "EXECUTING AUTOMATED EMERGENCY DISK CLEANUP..."
    log "AUTO-CLEANUP" "Emergency cleanup initiated by auto_disk.sh"

    # 1. Run standard cleanup script
    if [ -f "$SCRIPT_DIR/cleanup.sh" ]; then
        bash "$SCRIPT_DIR/cleanup.sh" >/dev/null 2>&1
    fi

    # 2. If Docker is running, prune unused build cache and stopped containers
    if command -v docker >/dev/null 2>&1 && systemctl is-active docker >/dev/null 2>&1; then
        info "Docker detected: running automated container & build cache prune..."
        docker system prune -f --volumes >/dev/null 2>&1
        log "AUTO-CLEANUP" "Docker system prune executed"
    fi

    # 3. Compress all older logs in log directory
    if [ -d "$LOG_DIR" ]; then
        find "$LOG_DIR" -type f -name "*.log" -mtime +3 -exec gzip -f {} \; 2>/dev/null
    fi

    ok "Emergency cleanup completed."
}

check_emergency_thresholds() {
    local root_pct
    root_pct=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
    if [ "$root_pct" -ge "$EMERGENCY_CLEANUP_THRESHOLD" ]; then
        err "CRITICAL: Root filesystem (/) is at ${root_pct}%! Exceeded emergency limit (${EMERGENCY_CLEANUP_THRESHOLD}%)."
        emergency_cleanup
    fi
}

show_status() {
    echo "=========================================================="
    echo "         AUTO DISK MANAGEMENT & STORAGE HEALTH            "
    echo "=========================================================="
    echo "Policy Configuration:"
    echo "  - Auto-expand threshold    : ${AUTO_EXTEND_THRESHOLD}% usage"
    echo "  - Auto-expand growth chunk : +${AUTO_EXTEND_MB} MB"
    echo "  - Emergency clean threshold: ${EMERGENCY_CLEANUP_THRESHOLD}% usage"
    echo
    echo "--- Current Mounted Volumes ---"
    df -h / "$REPO_DIR" "$BACKUP_DIR" 2>/dev/null
    echo
    echo "--- LVM Pool Free Space (vg_dev) ---"
    if vgs "$VG" &>/dev/null; then
        local free total
        free=$(vgs --noheadings --units m --nosuffix -o vg_free "$VG" 2>/dev/null | awk '{printf "%d", $1}')
        total=$(vgs --noheadings --units m --nosuffix -o vg_size "$VG" 2>/dev/null | awk '{printf "%d", $1}')
        echo "  Volume Group : $VG"
        echo "  Total Pool   : ${total} MB"
        echo "  Free Pool    : ${free} MB ($(( free * 100 / total ))% available for auto-grow)"
    else
        warn "Volume group '$VG' not active."
    fi
    echo "=========================================================="
}

# ------------------------------ Main Execution --------------------------------
MODE="${1:---check}"

case "$MODE" in
    --status)
        show_status
        ;;
    --check)
        echo "=== Running Auto Disk Inspection ==="
        check_and_auto_expand "$LV_REPOS" "$REPO_DIR"
        check_and_auto_expand "$LV_BACKUP" "$BACKUP_DIR"
        check_emergency_thresholds
        ;;
    --test-grow)
        echo "=== Simulating Auto-Grow Condition for $LV_REPOS ==="
        AUTO_EXTEND_THRESHOLD=0 # Force trigger
        check_and_auto_expand "$LV_REPOS" "$REPO_DIR"
        ;;
    *)
        echo "Usage: $0 [--check | --test-grow | --status]"
        exit 1
        ;;
esac

