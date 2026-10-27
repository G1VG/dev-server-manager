#!/bin/bash
# ==========================================================================
#  DEV SERVER MANAGER - Linux server administration panel for 40 developers
#  Covers: users, shared repos, packages, LVM, cleanup, cron, monitoring,
#          backup/restore, logging.   Run with:  sudo ./admin_panel.sh
# ==========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh" || { echo "config.sh not found next to admin_panel.sh"; exit 1; }
USERS_FILE="$SCRIPT_DIR/users.txt"

if [ "$EUID" -ne 0 ]; then
    echo "This panel manages users, disks and cron - run it with: sudo ./admin_panel.sh"
    exit 1
fi
mkdir -p "$LOG_DIR"

# ------------------------------ helpers ---------------------------------
ok()   { echo -e "\e[32m  [OK]\e[0m $*"; }
err()  { echo -e "\e[31m  [ERROR]\e[0m $*"; }
warn() { echo -e "\e[33m  [WARN]\e[0m $*"; }
hdr()  { echo -e "\n\e[1;36m=== $* ===\e[0m"; }
pause() { echo; read -rp "Press Enter to return to the menu..." _ || exit 0; }
confirm() { local a; read -rp "  $1 (y/n): " a; [[ "$a" =~ ^[Yy]$ ]]; }

# read_required "Prompt" varname -> loops until input is non-empty
read_required() {
    local val
    while true; do
        read -rp "$1" val || { echo; echo "Input closed. Exiting."; exit 1; }
        val=$(echo "$val" | sed 's/^[ \t]*//;s/[ \t]*$//')
        [ -n "$val" ] && { printf -v "$2" '%s' "$val"; return; }
        err "Value cannot be empty."
    done
}

valid_user() { [[ "$1" =~ ^[a-z][a-z0-9_-]{1,31}$ ]]; }

# ================================ 1. USERS ===============================
ensure_group() {
    if getent group "$GROUP" >/dev/null; then return 0; fi
    groupadd "$GROUP" && { ok "Group '$GROUP' created"; log INFO "group $GROUP created"; }
}

create_user() {   # create_user <username> [full name]  -> 0 ok, 1 error, 2 already exists
    local u="$1" full="${2:-$1}"
    valid_user "$u" || { err "Invalid username '$u' (lowercase letters/digits/_/-, start with a letter)"; return 1; }
    id "$u" &>/dev/null && { warn "User '$u' already exists - skipped"; return 2; }
    if useradd -m -s /bin/bash -c "$full" -G "$GROUP" "$u"; then
        echo "$u:$DEFAULT_PASS" | chpasswd && chage -d 0 "$u"     # force password change at first login
        log INFO "user created: $u"
        ok "Created $u ($full)"
        return 0
    fi
    err "useradd failed for '$u'"; return 1
}

bulk_users() {
    hdr "Create group + bulk-create developers from users.txt"
    ensure_group
    [ -f "$USERS_FILE" ] || { err "File not found: $USERS_FILE"; return; }
    [ -s "$USERS_FILE" ] || { err "File is empty: $USERS_FILE"; return; }
    local created=0 skipped=0 failed=0 u full
    while IFS=, read -r u full; do
        u=${u//$'\r'/}; full=${full//$'\r'/}
        [[ -z "$u" || "$u" == \#* ]] && continue
        create_user "$u" "$full" >/dev/null; rc=$?
        case $rc in 0) ((created++));; 2) ((skipped++));; *) ((failed++)); err "Could not create '$u'";; esac
    done < "$USERS_FILE"
    echo "  Summary -> created: $created | already existed: $skipped | failed: $failed"
    echo "  Default password: $DEFAULT_PASS (users must change it at first login)"
}

add_user() {
    hdr "Add a single developer"
    local u full
    ensure_group
    read_required "  Username: " u
    read -rp "  Full name (optional): " full
    create_user "$u" "${full:-$u}"
}

delete_user() {
    hdr "Delete a developer"
    local u
    read_required "  Username to delete: " u
    valid_user "$u" || { err "Invalid username format."; return; }
    id "$u" &>/dev/null || { err "User '$u' does not exist."; return; }
    [ "$(id -u "$u")" -lt 1000 ] && { err "Refusing to delete system account '$u'."; return; }
    confirm "Delete '$u' and their home directory?" || { echo "  Cancelled."; return; }
    userdel -r "$u" 2>/dev/null && { ok "User '$u' deleted"; log INFO "user deleted: $u"; } || err "Could not delete '$u'"
}

list_devs() {
    hdr "Members of group '$GROUP'"
    getent group "$GROUP" >/dev/null || { warn "Group '$GROUP' does not exist yet (run option 1)."; return; }
    local members
    members=$(getent group "$GROUP" | cut -d: -f4 | tr ',' '\n' | sed '/^$/d' | sort)
    [ -z "$members" ] && { warn "No developers yet."; return; }
    echo "$members" | nl -w3 -s'. ' | column -c 100 2>/dev/null || echo "$members" | nl
    echo "  Total developers: $(echo "$members" | wc -l)"
}

lock_unlock() {
    hdr "Lock / unlock a developer account"
    local u a
    read_required "  Username: " u
    id "$u" &>/dev/null || { err "User '$u' does not exist."; return; }
    read -rp "  (l)ock or (u)nlock? " a
    case "$a" in
        l|L) usermod -L "$u" && ok "Locked $u"   && log INFO "locked $u";;
        u|U) usermod -U "$u" && ok "Unlocked $u" && log INFO "unlocked $u";;
        *)   err "Enter l or u."; return;;
    esac
    passwd -S "$u"
}

# ============================ 2. SHARED REPOS ============================
setup_repos() {
    hdr "Set up shared repository directory"
    ensure_group
    mkdir -p "$REPO_DIR" || { err "Cannot create $REPO_DIR"; return; }
    chgrp "$GROUP" "$REPO_DIR" && chmod 2775 "$REPO_DIR"     # 2 = setgid: new files inherit the group
    if command -v git >/dev/null; then
        git config --system --get-all safe.directory | grep -qx '\*' || git config --system --add safe.directory '*'
    fi
    ok "$REPO_DIR ready (group=$GROUP, mode 2775 = setgid + rwxrwxr-x)"
    ls -ld "$REPO_DIR"
    log INFO "repo dir configured"
}

create_repo() {
    hdr "Create a shared bare Git repository"
    command -v git >/dev/null || { err "git is not installed (run option 9)."; return; }
    [ -d "$REPO_DIR" ] || { err "$REPO_DIR missing - run option 6 first."; return; }
    local n
    read_required "  Repository name: " n
    n=${n%.git}
    [[ "$n" =~ ^[A-Za-z0-9._-]+$ ]] || { err "Use only letters, digits, dot, dash, underscore."; return; }
    [ -d "$REPO_DIR/$n.git" ] && { err "Repository '$n' already exists."; return; }
    git init --bare --shared=group -q "$REPO_DIR/$n.git" || { err "git init failed"; return; }
    chgrp -R "$GROUP" "$REPO_DIR/$n.git"
    ok "Created $REPO_DIR/$n.git"
    echo "  Developers clone with:  git clone ssh://<user>@$(hostname)$REPO_DIR/$n.git"
    echo "  (or locally:            git clone $REPO_DIR/$n.git)"
    log INFO "repo created: $n"
}

list_repos() {
    hdr "Shared repositories"
    ls -d "$REPO_DIR"/*.git &>/dev/null || { warn "No repositories found in $REPO_DIR"; return; }
    for r in "$REPO_DIR"/*.git; do
        printf "  %-30s %8s   group=%s\n" "$(basename "$r")" "$(du -sh "$r" | cut -f1)" "$(stat -c %G "$r")"
    done
    echo "  Total: $(ls -d "$REPO_DIR"/*.git | wc -l) repositories"
}

# ============================== 3. PACKAGES ==============================
install_packages() {
    hdr "Install developer toolchain (this can take a few minutes)"
    apt-get update -qq || { err "apt update failed - check internet connection."; return; }
    local p ok_n=0 fail_n=0
    for p in "${PACKAGES[@]}"; do
        if dpkg -s "$p" &>/dev/null; then echo "  $p: already installed"; ((ok_n++)); continue; fi
        echo "  installing $p ..."
        if DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$p" >/dev/null 2>&1; then ok "$p installed"; ((ok_n++))
        else err "$p failed"; ((fail_n++)); fi
    done
    echo "  Summary -> ok: $ok_n | failed: $fail_n"
    log INFO "package install: ok=$ok_n fail=$fail_n"
}

check_packages() {
    hdr "Package status"
    local p
    printf "  %-18s %-12s %s\n" PACKAGE STATUS VERSION
    for p in "${PACKAGES[@]}"; do
        if dpkg -s "$p" &>/dev/null; then
            printf "  %-18s %-12s %s\n" "$p" "installed" "$(dpkg-query -W -f='${Version}' "$p")"
        else
            printf "  %-18s %-12s %s\n" "$p" "MISSING" "-"
        fi
    done
}

# ================================ 4. LVM =================================
lvm_setup() {
    hdr "LVM setup (PV -> VG -> LV -> filesystem -> mount)"
    command -v pvcreate >/dev/null || { warn "Installing lvm2..."; apt-get install -y -qq lvm2 >/dev/null 2>&1; }
    command -v pvcreate >/dev/null || { err "lvm2 not available."; return; }
    vgs "$VG" &>/dev/null && { warn "Volume group '$VG' already exists - use options 12/13."; return; }
    ensure_group
    echo "  1) Use a real spare disk (e.g. /dev/sdb)"
    echo "  2) Demo mode: virtual disk file via loop device (safe)"
    local m dev c persist=0
    read -rp "  Choice: " m
    case "$m" in
        1)  lsblk -dpno NAME,SIZE,TYPE | grep disk
            read_required "  Device path (e.g. /dev/sdb): " dev
            [ -b "$dev" ] || { err "$dev is not a block device."; return; }
            lsblk -no MOUNTPOINT "$dev" | grep -q . && { err "$dev (or a partition) is mounted - refusing."; return; }
            confirm "ALL DATA ON $dev WILL BE ERASED. Continue?" || return
            read -rp "  Type YES to confirm: " c; [ "$c" = "YES" ] || { echo "  Cancelled."; return; }
            persist=1;;
        2)  [ -f "$LOOP_IMG" ] && { err "Demo image already exists ($LOOP_IMG). Use option 12 (re-attach) instead."; return; }
            mkdir -p "$(dirname "$LOOP_IMG")"
            truncate -s 3G "$LOOP_IMG" || { err "Cannot create image"; return; }
            dev=$(losetup -f --show "$LOOP_IMG") || { err "losetup failed"; return; }
            ok "Virtual disk $dev created from $LOOP_IMG";;
        *)  err "Invalid choice."; return;;
    esac

    pvcreate -ff -y "$dev" >/dev/null && ok "Physical volume on $dev"          || { err "pvcreate failed"; return; }
    vgcreate "$VG" "$dev"  >/dev/null && ok "Volume group $VG"                 || { err "vgcreate failed"; return; }
    lvcreate -y -l 50%VG -n "$LV_REPOS"  "$VG" >/dev/null && ok "LV $LV_REPOS  (50% of VG)"
    lvcreate -y -l 30%VG -n "$LV_BACKUP" "$VG" >/dev/null && ok "LV $LV_BACKUP (30% of VG, 20% left free for growth)"
    mkfs.ext4 -q "/dev/$VG/$LV_REPOS" && mkfs.ext4 -q "/dev/$VG/$LV_BACKUP" && ok "ext4 filesystems created"
    mkdir -p "$REPO_DIR" "$BACKUP_DIR"
    mount "/dev/$VG/$LV_REPOS" "$REPO_DIR" && mount "/dev/$VG/$LV_BACKUP" "$BACKUP_DIR" && ok "Mounted on $REPO_DIR and $BACKUP_DIR"
    chgrp "$GROUP" "$REPO_DIR"; chmod 2775 "$REPO_DIR"; chmod 750 "$BACKUP_DIR"
    if [ $persist -eq 1 ]; then
        grep -q "/dev/mapper/$VG-$LV_REPOS" /etc/fstab  || echo "/dev/mapper/$VG-$LV_REPOS $REPO_DIR ext4 defaults,nofail 0 2" >> /etc/fstab
        grep -q "/dev/mapper/$VG-$LV_BACKUP" /etc/fstab || echo "/dev/mapper/$VG-$LV_BACKUP $BACKUP_DIR ext4 defaults,nofail 0 2" >> /etc/fstab
        ok "Added to /etc/fstab (mounts automatically at boot)"
    else
        warn "Demo mode: after a reboot use option 12 to re-attach the virtual disk."
    fi
    log INFO "LVM configured on $dev"
    lvm_status
}

lvm_reattach() {
    [ -f "$LOOP_IMG" ] || return 1
    losetup -j "$LOOP_IMG" | grep -q . || { losetup -f "$LOOP_IMG" && ok "Virtual disk re-attached"; }
    pvscan >/dev/null 2>&1; vgchange -ay "$VG" >/dev/null 2>&1
    mountpoint -q "$REPO_DIR"   || mount "/dev/$VG/$LV_REPOS"  "$REPO_DIR"  2>/dev/null
    mountpoint -q "$BACKUP_DIR" || mount "/dev/$VG/$LV_BACKUP" "$BACKUP_DIR" 2>/dev/null
}

lvm_status() {
    hdr "LVM status"
    if ! vgs "$VG" &>/dev/null; then
        lvm_reattach
        vgs "$VG" &>/dev/null || { warn "No LVM configured yet - run option 11."; return; }
    fi
    echo "--- Physical volumes ---"; pvs
    echo "--- Volume group ---";     vgs "$VG"
    echo "--- Logical volumes ---";  lvs "$VG"
    echo "--- Mounted usage ---";    df -h "$REPO_DIR" "$BACKUP_DIR" 2>/dev/null
}

lvm_extend() {
    hdr "Grow a logical volume ONLINE (no downtime)"
    vgs "$VG" &>/dev/null || { err "Volume group '$VG' not found - run option 11 first."; return; }
    local free c lv mb
    free=$(vgs --noheadings --units m --nosuffix -o vg_free "$VG" | awk '{printf "%d", $1}')
    echo "  Free space in $VG: ${free} MB"
    [ "$free" -gt 0 ] || { err "No free space left in the volume group."; return; }
    echo "  1) $LV_REPOS   2) $LV_BACKUP"
    read -rp "  Which volume? " c
    case "$c" in 1) lv="$LV_REPOS";; 2) lv="$LV_BACKUP";; *) err "Invalid choice."; return;; esac
    read_required "  Extend by how many MB? " mb
    [[ "$mb" =~ ^[0-9]+$ ]] && [ "$mb" -gt 0 ] || { err "Enter a positive whole number."; return; }
    [ "$mb" -le "$free" ] || { err "Only ${free} MB available."; return; }
    echo "  BEFORE:"; lvs --noheadings -o lv_name,lv_size "$VG/$lv"
    lvextend -r -L +"${mb}M" "/dev/$VG/$lv" >/dev/null 2>&1 && ok "Extended $lv by ${mb} MB and resized the filesystem" || { err "lvextend failed"; return; }
    echo "  AFTER:";  lvs --noheadings -o lv_name,lv_size "$VG/$lv"
    log INFO "extended $lv by ${mb}MB"
}

# ======================= 5. CLEANUP  6. CRON  7. MONITOR =================
run_script() {   # run_script <name> [args]
    local s="$SCRIPT_DIR/scripts/$1"; shift
    [ -f "$s" ] || { err "Script missing: $s"; return; }
    bash "$s" "$@"
}

install_cron() {
    hdr "Install cron jobs (/etc/cron.d/devserver)"
    command -v cron >/dev/null || { warn "Installing cron..."; apt-get install -y -qq cron >/dev/null 2>&1; }
    chmod +x "$SCRIPT_DIR"/scripts/*.sh 2>/dev/null
    cat > /etc/cron.d/devserver <<EOF
# Dev Server Manager automation   (min hour day month weekday user command)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
*/5 * * * * root $SCRIPT_DIR/scripts/monitor.sh >/dev/null 2>&1
0 2 * * *   root $SCRIPT_DIR/scripts/backup.sh  >> $LOG_DIR/backup.log 2>&1
0 3 * * 0   root $SCRIPT_DIR/scripts/cleanup.sh >> $LOG_DIR/cleanup.log 2>&1
EOF
    chmod 644 /etc/cron.d/devserver
    systemctl enable --now cron >/dev/null 2>&1
    ok "Cron jobs installed:"
    grep -v '^#' /etc/cron.d/devserver | grep root
    echo "  -> monitor every 5 min | backup daily 02:00 | cleanup Sundays 03:00"
    log INFO "cron installed"
}

view_cron() {
    hdr "Cron status"
    [ -f /etc/cron.d/devserver ] || { warn "No cron jobs installed yet (option 16)."; return; }
    echo "  cron service: $(systemctl is-active cron 2>/dev/null)"
    cat /etc/cron.d/devserver
    confirm "Remove these cron jobs?" && { rm -f /etc/cron.d/devserver; ok "Cron jobs removed"; log INFO "cron removed"; }
}

backup_now()  { hdr "Backup now"; run_script backup.sh; }

restore_backup() {
    hdr "Restore / inspect a backup"
    local files n dest i=1 f
    mapfile -t files < <(ls -1t "$BACKUP_DIR"/backup_*.tar.gz 2>/dev/null)
    [ ${#files[@]} -gt 0 ] || { warn "No backups in $BACKUP_DIR - run option 18."; return; }
    for f in "${files[@]}"; do printf "  %d) %s (%s)\n" "$i" "$(basename "$f")" "$(du -h "$f" | cut -f1)"; ((i++)); done
    read -rp "  Select backup number: " n
    [[ "$n" =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le ${#files[@]} ] || { err "Invalid selection."; return; }
    dest="/tmp/restore_$(date +%H%M%S)"; mkdir -p "$dest"
    if tar -xzf "${files[$((n-1))]}" -C "$dest"; then
        ok "Restored to $dest (test restore - live data untouched)"
        ls "$dest/${REPO_DIR#/}" 2>/dev/null | sed 's/^/    /'
        echo "  To restore for real:  cp -a $dest/${REPO_DIR#/}/. $REPO_DIR/"
        log INFO "restore test to $dest"
    else err "Extraction failed - archive may be corrupt."; fi
}

view_logs() {
    hdr "Recent logs"
    for f in "$LOG_FILE" "$MON_LOG"; do
        echo "--- $(basename "$f") (last 8 lines) ---"
        [ -f "$f" ] && tail -n 8 "$f" || echo "  (no log yet)"
    done
}

full_setup() {
    hdr "FULL AUTOMATIC SETUP"
    install_packages; bulk_users; lvm_setup; setup_repos
    [ -d "$REPO_DIR/demo-project.git" ] || { git init --bare --shared=group -q "$REPO_DIR/demo-project.git" && chgrp -R "$GROUP" "$REPO_DIR/demo-project.git" && ok "Sample repo demo-project.git created"; }
    install_cron; backup_now; run_script monitor.sh --dashboard
    ok "Server is fully configured."
}

# ================================= MENU ==================================
show_menu() {
    clear 2>/dev/null
    cat <<'EOF'
==========================================================
      DEV SERVER MANAGER  -  Linux Server for 40 Developers
==========================================================
 USERS & GROUPS           SHARED REPOSITORIES
  1. Create group + 40 devs   6. Setup shared repo directory
  2. Add one developer        7. Create bare Git repository
  3. Delete a developer       8. List repositories
  4. List developers
  5. Lock / unlock account  PACKAGES
                              9. Install dev toolchain
 STORAGE (LVM)               10. Check package status
 11. LVM setup (PV/VG/LV)
 12. LVM status              AUTOMATION
 13. Extend volume online    14. Cleanup PREVIEW (dry run)
                             15. Run cleanup now
 MONITORING & BACKUP         16. Install cron jobs
 17. Health dashboard        21. View / remove cron jobs
 18. Backup now
 19. Restore / inspect backup   22. FULL AUTO SETUP
 20. View logs                   0. Exit
==========================================================
EOF
}

while true; do
    show_menu
    read -rp "Enter your choice [0-22]: " ch || { echo; echo "Goodbye!"; exit 0; }
    echo
    case "$ch" in
        1) bulk_users;;       2) add_user;;        3) delete_user;;     4) list_devs;;
        5) lock_unlock;;      6) setup_repos;;     7) create_repo;;     8) list_repos;;
        9) install_packages;; 10) check_packages;; 11) lvm_setup;;      12) lvm_status;;
        13) lvm_extend;;      14) run_script cleanup.sh --dry-run;;     15) run_script cleanup.sh;;
        16) install_cron;;    17) run_script monitor.sh --dashboard;;   18) backup_now;;
        19) restore_backup;;  20) view_logs;;      21) view_cron;;      22) full_setup;;
        0) echo "Goodbye!"; exit 0;;
        "") err "You did not enter anything. Choose a number 0-22.";;
        *)  err "Invalid choice '$ch'. Choose a number 0-22.";;
    esac
    pause
done
