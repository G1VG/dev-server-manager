#!/bin/bash
# Server monitoring. Usage: monitor.sh [--dashboard]   (no argument = append one line to the log + alerts)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../config.sh" || { echo "config.sh missing"; exit 1; }
mkdir -p "$LOG_DIR" 2>/dev/null

cores=$(nproc)
load=$(awk "{print \$1}" /proc/loadavg)
mem=$(free | awk "/^Mem:/ {printf \"%d\", \$3*100/\$2}")
users_in=$(who | wc -l)
disk_root=$(df -P / | awk "NR==2 {gsub(\"%\",\"\",\$5); print \$5}")

bar() {  # bar <percent>
    local p=$1 f i out=""
    f=$((p / 5)); for ((i=0;i<20;i++)); do [ $i -lt $f ] && out+="#" || out+="-"; done
    echo "[$out] ${p}%"
}
disks() { df -P -x tmpfs -x devtmpfs -x squashfs | awk "NR>1 {gsub(\"%\",\"\",\$5); print \$5, \$6}"; }

alerts=()
awk -v l="$load" -v c="$cores" "BEGIN{exit !(l>c)}" && alerts+=("High CPU load: $load (cores: $cores)")
[ "$mem" -ge "$MEM_LIMIT" ] && alerts+=("High memory usage: ${mem}%")
while read -r use mp; do
    [ "$use" -ge "$DISK_LIMIT" ] && alerts+=("Disk $mp is ${use}% full")
done < <(disks)

if [ "$1" = "--dashboard" ]; then
    echo "================ SERVER HEALTH DASHBOARD ================"
    echo "Host     : $(hostname)    Uptime: $(uptime -p)"
    echo "Load avg : $load (cores: $cores)"
    echo "Memory   : $(bar "$mem")"
    echo "Users in : $users_in logged in"
    echo
    echo "--- Disk usage (alert at ${DISK_LIMIT}%) ---"
    disks | while read -r use mp; do printf "  %-18s %s\n" "$mp" "$(bar "$use")"; done
    echo
    echo "--- Top 5 processes by CPU ---"
    ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -6
    echo
    echo "--- Logged-in users ---"
    [ "$users_in" -eq 0 ] && echo "  (nobody)" || who | awk "{print \"  \" \$1 \" on \" \$2 \" since \" \$3 \" \" \$4}"
    if [ -r /var/log/auth.log ]; then
        echo; echo "--- Failed SSH logins in auth.log: $(grep -c "Failed password" /var/log/auth.log) ---"
    fi
    echo
    if [ ${#alerts[@]} -gt 0 ]; then
        for a in "${alerts[@]}"; do echo "  [ALERT] $a"; done
    else
        echo "  All checks passed - server healthy."
    fi
else
    echo "$(date "+%F %T") load=$load mem=${mem}% disk(/)=${disk_root}% users=$users_in" >> "$MON_LOG"
    for a in "${alerts[@]}"; do echo "$(date "+%F %T") ALERT $a" >> "$MON_LOG"; done
fi
