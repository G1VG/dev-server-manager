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

# Auto Disk Management & Auto-Grow Thresholds
AUTO_EXTEND_THRESHOLD=80              # % usage to trigger automatic online LVM growth
AUTO_EXTEND_MB=300                    # MB to automatically add via lvextend -r
EMERGENCY_CLEANUP_THRESHOLD=90        # % usage to trigger automated emergency cleanup

# Load Balancer & Clustering
LB_PORT=8080
BACKEND_PORTS=(5001 5002 5003)

# Docker Resource Limits
DOCKER_DEFAULT_MEM="512m"
DOCKER_MAX_MEM="2g"

log() { mkdir -p "$LOG_DIR" 2>/dev/null; echo "$(date '+%F %T') [$1] $2" >> "$LOG_FILE" 2>/dev/null; }
