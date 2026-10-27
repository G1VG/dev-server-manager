#!/bin/bash
# Shared configuration - sourced by admin_panel.sh and every script in scripts/
GROUP="developers"
DEFAULT_PASS="Welcome@123"          # forced to change at first login
REPO_DIR="/srv/repos"
BACKUP_DIR="/srv/backups"
VG="vg_dev"
LV_REPOS="lv_repos"
LV_BACKUP="lv_backup"
LOOP_IMG="/var/lib/devserver/disk.img"   # demo "virtual disk" for LVM
LOG_DIR="/var/log/devserver"
LOG_FILE="$LOG_DIR/activity.log"
MON_LOG="$LOG_DIR/monitor.log"
DISK_LIMIT=80                        # % disk usage that raises an ALERT
MEM_LIMIT=85                         # % memory usage that raises an ALERT
KEEP_BACKUPS_DAYS=7                  # backup retention
PACKAGES=(git build-essential python3 python3-pip nodejs npm default-jdk vim curl rsync lvm2 cron)

log() { mkdir -p "$LOG_DIR" 2>/dev/null; echo "$(date '+%F %T') [$1] $2" >> "$LOG_FILE" 2>/dev/null; }
