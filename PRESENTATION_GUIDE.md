# Dev Server Manager — Complete Presentation & Technical Defense Master Guide

---

## 1. Executive Summary & Project Architecture

### 1.1 What We Built
The **Dev Server Manager** is a complete, enterprise-grade Linux administration suite engineered for an IT organization supporting **40 software developers**. It solves the real-world operational challenges of managing developer environments on Ubuntu Linux (22.04/24.04 LTS).

The system provides:
1. **Automated User Lifecycle:** Bulk provisioning of 40 developers, security groups, forced password resets, and account locking.
2. **Collaborative Git Storage:** Centralized bare Git repositories enforcing group ownership via the Linux **setgid** bit (`2775`).
3. **Enterprise Storage via LVM:** Logical Volume Management with dedicated slices for code and backups, intentionally reserving pool capacity for **zero-downtime online storage expansion**.
4. **Automated Maintenance via Cron:** Automated monitoring every 5 minutes, daily backups at 02:00, and weekly disk cleanup on Sundays.
5. **Dual Interface:** An interactive menu-driven **Bash Admin Panel** (`admin_panel.sh`) and a real-time **Flask DevOps Web Dashboard** (`webapp/`) with live telemetry and terminal audit logging.

```
                              ARCHITECTURE DIAGRAM
                             
               +-------------------------------------------------+
               |              ADMIN INTERFACES                   |
               |   Terminal Menu (sudo ./admin_panel.sh)         |
               |   Web Dashboard (http://127.0.0.1:5000)         |
               +-----------------------+-------------------------+
                                       |
                     +-----------------+-----------------+
                     |                                   |
                     v                                   v
        +-------------------------+         +-------------------------+
        |   USERS & PERMISSIONS   |         |    LVM STORAGE POOL     |
        | - Group: developers     |         | - Volume Group: vg_dev  |
        | - 40 Devs (dev01..dev40)|         | - lv_repos  (/srv/repos)|
        | - Setgid 2775 on repos  |         | - lv_backup (/srv/back) |
        +-------------------------+         +-------------------------+
                     |                                   |
                     +-----------------+-----------------+
                                       |
                                       v
        +-------------------------------------------------------------+
        |                  AUTOMATION & OBSERVABILITY                 |
        | - Cron Engine: /etc/cron.d/devserver                        |
        | - scripts/monitor.sh (Load, RAM %, Disk %, Alerts)          |
        | - scripts/backup.sh  (tar -czf, verify -tzf, 7-day prune)   |
        | - scripts/cleanup.sh (find -delete, gzip logs, df tracking) |
        | - Central Logs: /var/log/devserver/{activity,monitor}.log   |
        +-------------------------------------------------------------+
```

---

## 2. Master Presentation Script (Team Lead / Full Walkthrough)

> **Delivery Tone:** Professional, confident, and systems-focused. Emphasize automation, Linux fundamentals, security boundaries, and zero-downtime operations.

### Slide 1: Introduction & Problem Statement
> *"Good morning/afternoon, professors and evaluators. Today, our team is presenting the **Dev Server Manager**—an automated infrastructure administration system designed for a software development team of 40 engineers on Ubuntu Linux.*
>
> *In any growing engineering team, manual server administration leads to configuration drift, permission conflicts in shared code repositories, disk exhaustion, missed backups, and human error. Our objective was to create a centralized, resilient, and fully automated solution that manages users, shared Git repositories, storage expansion, scheduled tasks, and system health through both a secure CLI control panel and an administrative web console."*

### Slide 2: High-Level Architecture & Components
> *"Our project is structured around five core pillars:*
> 1. *First, **User & Security Management**: Managing 40 developer accounts using Linux PAM, shadow passwords, and group access controls.*
> 2. *Second, **Shared Repositories**: Solving multi-user collaboration using the Linux **setgid sticky permission** (`2775`) on `/srv/repos` so all developer commits inherit group ownership.*
> 3. *Third, **Dynamic Storage Management**: Implementing **Logical Volume Management (LVM)**, allowing us to grow partitions while mounted—completely online with zero downtime.*
> 4. *Fourth, **Background Automation**: Operating via `/etc/cron.d/devserver` for non-interactive health checks, verified backups, and disk cleanup.*
> 5. *Fifth, **Observability**: Real-time logging under `/var/log/devserver/` and a REST-powered Web Dashboard running Flask with an explicit command auditor.*
>
> *Let us now walk through all 22 administrative features built into our system."*

---

## 3. Deep Dive: All 22 Features, Implementation, & Technical Defense

---

### FEATURE 1: Create Group + 40 Developers (Bulk Provisioning)
- **What it does:** Creates the `developers` system group and reads `users.txt` to bulk-create 40 user accounts (`dev01` through `dev40`). Sets temporary passwords (`Welcome@123`) and enforces an immediate password reset on their first login.
- **How it is implemented:**
  ```bash
  groupadd developers
  useradd -m -s /bin/bash -c "Full Name" -G developers dev01
  echo "dev01:Welcome@123" | chpasswd
  chage -d 0 dev01
  ```
  Parses `users.txt` using a `while IFS=, read -r u full` loop, trims `\r` (CRLF) characters, skips blank lines or comments (`#`), and checks `id "$u"` to skip existing accounts safely.
- **Technical Questions & Answers:**
  - **Q:** *Why use `chage -d 0` instead of letting users keep the default password?*  
    **A:** `chage -d 0` sets the last password change date to the epoch (Jan 1, 1970). Linux PAM recognizes this as an expired password and forces the user to choose a secure, private password immediately upon their first SSH or shell login before giving them terminal access.
  - **Q:** *What is the difference between `-G` and `-g` in `useradd`?*  
    **A:** `-g` assigns the user's primary group. `-G` assigns supplementary (secondary) groups. We keep each user's private primary group and add them to `developers` as a secondary group.

---

### FEATURE 2: Add a Single Developer
- **What it does:** Interactively prompts for a username and full name, validates the input format, and provisions a single developer into the `developers` group.
- **How it is implemented:**
  Validates username against regex `^[a-z][a-z0-9_-]{1,31}$`. Checks if group `developers` exists via `getent group developers`. If missing, creates it. Runs `useradd`, pipes initial password to `chpasswd`, and calls `chage -d 0`. Logs action to `/var/log/devserver/activity.log`.
- **Technical Questions & Answers:**
  - **Q:** *Why enforce regex `^[a-z][a-z0-9_-]{1,31}$`?*  
    **A:** POSIX and Linux username standards require usernames to begin with a lowercase letter and contain only alphanumeric characters, underscores, or hyphens up to 32 characters to prevent command-line parsing bugs and security issues.

---

### FEATURE 3: Delete a Developer
- **What it does:** Safely removes a developer account and purges their home directory after confirmation, while strictly blocking the deletion of system accounts.
- **How it is implemented:**
  ```bash
  [ "$(id -u "$u")" -lt 1000 ] && { echo "Refusing to delete system account"; return 1; }
  userdel -r "$u"
  ```
  The `-r` flag instructs `userdel` to remove the user's home directory (`/home/<user>`) and their mail spool.
- **Technical Questions & Answers:**
  - **Q:** *Why is the UID check `[ "$(id -u "$u")" -lt 1000 ]` critical?*  
    **A:** On Debian/Ubuntu systems, UIDs below 1000 are reserved for system services (`root`, `daemon`, `systemd`, `www-data`). Preventing deletion of accounts with UID < 1000 prevents catastrophic accidental bricking of the OS.

---

### FEATURE 4: List Developers
- **What it does:** Displays all developer accounts currently registered in the `developers` group along with a numbered index and total account count.
- **How it is implemented:**
  ```bash
  getent group developers | cut -d: -f4 | tr ',' '\n' | sort | nl
  ```
- **Technical Questions & Answers:**
  - **Q:** *Why use `getent group` instead of just reading `/etc/group` with grep?*  
    **A:** `/etc/group` only holds local file records. `getent` queries the Name Service Switch (NSS), which means if the server is later joined to LDAP, FreeIPA, or Active Directory, `getent` will continue to return network users transparently.

---

### FEATURE 5: Lock / Unlock Developer Account
- **What it does:** Temporarily suspends or reinstates a developer's login ability without deleting their files or home directory.
- **How it is implemented:**
  ```bash
  usermod -L dev01    # Lock
  usermod -U dev01    # Unlock
  passwd -S dev01     # Query status
  ```
- **Technical Questions & Answers:**
  - **Q:** *How does `usermod -L` actually lock an account in Linux?*  
    **A:** It places an exclamation mark (`!`) in front of the encrypted password hash in `/etc/shadow`. Because no valid cryptographic hash begins with `!`, no entered password can ever match it, preventing password authentication.

---

### FEATURE 6: Setup Shared Repository Directory
- **What it does:** Creates `/srv/repos` and applies group ownership and the **setgid** bit so all developers can collaborate seamlessly without permission clashes.
- **How it is implemented:**
  ```bash
  mkdir -p /srv/repos
  chgrp developers /srv/repos
  chmod 2775 /srv/repos
  git config --system --add safe.directory '*'
  ```
- **Technical Questions & Answers:**
  - **Q:** *What does the `2` in `chmod 2775` do?*  
    **A:** The `2` sets the **setgid (Set Group ID)** bit on the directory. When a file or folder is created inside a directory with setgid enabled, its group ownership is automatically set to the directory's group (`developers`), rather than the primary group of the user who created it. This guarantees that files created by `dev01` can be updated or committed to by `dev02`.
  - **Q:** *What permissions do `775` grant?*  
    **A:** `rwxrwxr-x`: Read/write/execute for user (owner) and group (`developers`), and read/execute for others.

---

### FEATURE 7: Create a Shared Bare Git Repository
- **What it does:** Initializes a centralized bare Git repository inside `/srv/repos/` with group sharing enabled.
- **How it is implemented:**
  ```bash
  git init --bare --shared=group /srv/repos/<repo_name>.git
  chgrp -R developers /srv/repos/<repo_name>.git
  ```
- **Technical Questions & Answers:**
  - **Q:** *What is a bare repository, and why is it required on a server?*  
    **A:** A bare repository contains only Git version history, trees, and commit objects (`HEAD`, `refs/`, `objects/`), without a working tree (no checked-out files to edit). Central servers must use bare repos because pushing to a non-bare repository can cause conflicts with locally modified files in the working directory.
  - **Q:** *What does `--shared=group` do?*  
    **A:** It configures the repository's `.git/config` with `core.sharedRepository = group`, making the repository group-writable and ensuring all objects and packfiles created during `git push` inherit group permissions.

---

### FEATURE 8: List Repositories
- **What it does:** Enumerates all bare Git repositories in `/srv/repos/`, displaying the repository name, disk usage size, and group ownership.
- **How it is implemented:**
  Iterates through `/srv/repos/*.git`, extracting human-readable sizes with `du -sh` and group ownership with `stat -c %G`.
- **Technical Questions & Answers:**
  - **Q:** *Why use `du -sh` instead of `ls -l` for directory sizes?*  
    **A:** In Linux, `ls -l` on a directory only reports the size of the directory's inode metadata (typically 4096 bytes), not the content inside. `du -sh` recursively sums the actual disk blocks occupied by all files and packfiles inside the tree.

---

### FEATURE 9: Install Developer Toolchain
- **What it does:** Non-interactively installs the complete set of required compilers, runtimes, editors, and system tools.
- **How it is implemented:**
  Sources the `PACKAGES` array from `config.sh`:
  `git`, `build-essential`, `python3`, `python3-pip`, `nodejs`, `npm`, `default-jdk`, `vim`, `curl`, `rsync`, `lvm2`, `cron`.
  Checks each package with `dpkg -s <pkg>`. If missing, installs via:
  ```bash
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq <package>
  ```
- **Technical Questions & Answers:**
  - **Q:** *Why set `DEBIAN_FRONTEND=noninteractive`?*  
    **A:** It suppresses interactive curses/ncurses configuration prompts (e.g., keyboard layout, timezone, service restart prompts) that would pause or hang an automated installation script.

---

### FEATURE 10: Check Package Status
- **What it does:** Audits the system to verify whether each required development package is installed and queries its exact installed version.
- **How it is implemented:**
  Uses `dpkg-query -W -f='${Version}' <package>` to fetch the exact installed package version string from the local dpkg status database without network requests.
- **Technical Questions & Answers:**
  - **Q:** *How is `dpkg -s` different from `apt` for checking status?*  
    **A:** `dpkg` checks the local installed database (`/var/lib/dpkg/status`) instantly without needing internet access or updating package indexes, making it fast and reliable in offline or air-gapped environments.

---

### FEATURE 11: LVM Setup (PV -> VG -> LV -> Mount)
- **What it does:** Sets up a complete Logical Volume Management infrastructure with a Physical Volume (PV), Volume Group (`vg_dev`), and two Logical Volumes (`lv_repos` and `lv_backup`). Formats them as ext4 and mounts them.
- **How it is implemented:**
  Supports real disk (e.g., `/dev/sdb`) or a 3 GB loopback virtual disk (`/var/lib/devserver/disk.img` via `losetup -f --show`).
  ```bash
  pvcreate -ff -y "$DEV"
  vgcreate vg_dev "$DEV"
  lvcreate -y -l 50%VG -n lv_repos vg_dev      # 50% for repos
  lvcreate -y -l 30%VG -n lv_backup vg_dev     # 30% for backups (20% free!)
  mkfs.ext4 -q /dev/vg_dev/lv_repos
  mkfs.ext4 -q /dev/vg_dev/lv_backup
  mount /dev/vg_dev/lv_repos /srv/repos
  mount /dev/vg_dev/lv_backup /srv/backups
  ```
- **Technical Questions & Answers:**
  - **Q:** *Why allocate only 50% and 30%, leaving 20% free in the Volume Group?*  
    **A:** This is standard storage engineering. If a volume fills up, LVM allows you to extend the volume online using the unallocated pool space without buying new disks or repartitioning.
  - **Q:** *What is a loop device (`losetup`)?*  
    **A:** A loop device is a pseudo-device in the Linux kernel that exposes a regular file (like `disk.img`) as a block device. This enables partition tables, LVM, and filesystems to be tested safely inside a virtual file.

---

### FEATURE 12: LVM Status
- **What it does:** Reports the health and utilization of the storage architecture across all three LVM layers (Physical Volumes, Volume Groups, Logical Volumes) plus actual filesystem usage.
- **How it is implemented:**
  Automatically executes `pvs`, `vgs vg_dev`, `lvs vg_dev`, and `df -h /srv/repos /srv/backups`. If loopback mode was used and rebooted, it auto-detects and runs `losetup` and `vgchange -ay` to re-attach the volume.
- **Technical Questions & Answers:**
  - **Q:** *What does `vgchange -ay` do?*  
    **A:** It activates (`-a y`) the volume group in the Linux kernel, creating the device-mapper nodes under `/dev/vg_dev/` and `/dev/mapper/`.

---

### FEATURE 13: Extend Volume Online (Zero-Downtime Growth)
- **What it does:** Dynamically expands a mounted Logical Volume and grows its filesystem online without unmounting or restarting services.
- **How it is implemented:**
  Queries free megabytes in the VG using `vgs --noheadings --units m -o vg_free vg_dev`. Validates user request does not exceed free space.
  ```bash
  lvextend -r -L +${mb}M /dev/vg_dev/$lv
  ```
- **Technical Questions & Answers:**
  - **Q:** *What does the `-r` flag in `lvextend` do? Why is it crucial?*  
    **A:** `-r` stands for `--resizefs`. Without `-r`, `lvextend` only enlarges the underlying logical block device, leaving the ext4 filesystem at its old size (requiring a separate `resize2fs` command). With `-r`, LVM automatically invokes `resize2fs` while the filesystem remains mounted, expanding the filesystem online safely.

---

### FEATURE 14: Cleanup PREVIEW (Dry-Run Mode)
- **What it does:** Audits directories for old temporary files, core dumps, and stale logs without deleting anything, providing safe operational visibility.
- **How it is implemented:**
  Executes `scripts/cleanup.sh --dry-run`. Sets `DRY=1`, which runs `find <dir> -xdev -type f -name <pat> -mtime +<days>` and pipes to `sed "s/^/ would delete: /"`.
- **Technical Questions & Answers:**
  - **Q:** *Why is a dry-run feature essential in server administration?*  
    **A:** It adheres to the principle of least disruption. An admin can audit regex patterns and age thresholds to verify that active project files won't be purged before committing to a permanent deletion run.

---

### FEATURE 15: Run Cleanup Now
- **What it does:** Deletes temporary files older than 7 days in `/tmp` and `/home`, deletes stale logs older than 30 days in `/var/log`, compresses active logs with `gzip`, runs `apt-get clean`, and reports the exact megabytes of disk space freed.
- **How it is implemented:**
  Measures disk blocks used before and after via `df --output=used -k /`.
  Uses `find ... -delete` to purge files atomically.
  Compresses old logs: `find "$LOG_DIR" -name "*.log" -mtime +7 -exec gzip -f {} \;`.
  Computes freed megabytes: `freed=$(( (before - after) / 1024 ))`.
- **Technical Questions & Answers:**
  - **Q:** *What does the `-xdev` flag in `find` do?*  
    **A:** `-xdev` (cross-device) restricts the search to the current filesystem mount. It prevents `find` from crossing over into separate mounts (like NFS shares or `/srv/repos`), ensuring cleanup only deletes files on the intended partition.

---

### FEATURE 16: Install Cron Jobs
- **What it does:** Installs automated cron jobs into `/etc/cron.d/devserver` and enables the systemd cron service.
- **How it is implemented:**
  Writes a system cron configuration:
  ```cron
  */5 * * * * root /opt/dev-server-manager/scripts/monitor.sh >/dev/null 2>&1
  0 2 * * *   root /opt/dev-server-manager/scripts/backup.sh  >> /var/log/devserver/backup.log 2>&1
  0 3 * * 0   root /opt/dev-server-manager/scripts/cleanup.sh >> /var/log/devserver/cleanup.log 2>&1
  ```
  Sets permissions to `chmod 644` and runs `systemctl enable --now cron`.
- **Technical Questions & Answers:**
  - **Q:** *Why place the job in `/etc/cron.d/` instead of user crontabs (`crontab -e`)?*  
    **A:** Files in `/etc/cron.d/` are system-wide, modular, can be version-controlled, and include an explicit username column (`root`), making deployments predictable without mutating user crontab files.

---

### FEATURE 17: Server Health Dashboard (Monitoring)
- **What it does:** Generates a real-time terminal dashboard showing CPU load average, RAM percentage bar, mounted disk usage, top 5 processes by CPU, active logged-in users, failed SSH attempts, and alerts.
- **How it is implemented:**
  Invokes `scripts/monitor.sh --dashboard`. Reads `/proc/loadavg`, calculates memory usage via `free | awk '/^Mem:/ {printf "%d", $3*100/$2}'`, reads `/proc/net` or `df`, scans `/var/log/auth.log` for failed passwords, and renders text visual bars `[#####-----] 50%`.
- **Technical Questions & Answers:**
  - **Q:** *What does load average mean in Linux?*  
    **A:** Load average is the average number of processes that are either running on a CPU or waiting in the uninterruptible run queue (disk I/O wait). If load average exceeds the total CPU core count, the system is experiencing CPU or I/O contention.

---

### FEATURE 18: Backup Now
- **What it does:** Creates an immediate compressed archive of all shared repositories and user account definitions, verifies archive integrity, and enforces a 7-day retention policy.
- **How it is implemented:**
  Invokes `scripts/backup.sh`.
  ```bash
  tar -czf "$BACKUP_DIR/backup_$(date +%F_%H%M%S).tar.gz" -C / srv/repos etc/passwd etc/group
  tar -tzf "$file" >/dev/null 2>&1   # Verification
  find "$BACKUP_DIR" -name "backup_*.tar.gz" -mtime +7 -delete # Retention
  ```
- **Technical Questions & Answers:**
  - **Q:** *Why backup `/etc/passwd` and `/etc/group` along with `/srv/repos`?*  
    **A:** File permissions in Linux store numerical UIDs and GIDs. Backing up the repo files without the user and group mapping files would make it impossible to restore proper file ownership if recovering on a new operating system.

---

### FEATURE 19: Restore / Inspect Backup
- **What it does:** Lists all available backup archives, lets the administrator select an archive by number, and safely extracts it into an isolated temporary directory for inspection.
- **How it is implemented:**
  Loads archives using `mapfile -t files < <(ls -1t "$BACKUP_DIR"/backup_*.tar.gz)`.
  Prompts user for index.
  Extracts into `/tmp/restore_$(date +%H%M%S)` using `tar -xzf <archive> -C <dest>`.
  Displays restored contents and prints the explicit `cp -a` command needed to restore to production.
- **Technical Questions & Answers:**
  - **Q:** *Why extract to a temporary folder instead of extracting directly to `/srv/repos`?*  
    **A:** Overwriting production data directly during a restore attempt is high-risk. A safe staging restore allows the admin to verify file integrity and inspect commit trees before selectively copying data into production.

---

### FEATURE 20: View Logs
- **What it does:** Displays the last 8 lines of both `/var/log/devserver/activity.log` and `/var/log/devserver/monitor.log` for immediate troubleshooting.
- **How it is implemented:**
  Uses `tail -n 8` on both log paths. If files don't exist yet, it reports `(no log yet)` gracefully.
- **Technical Questions & Answers:**
  - **Q:** *Why is structured logging vital for system administration?*  
    **A:** Every log entry includes an ISO timestamp, a severity level (`[INFO]`, `[ERROR]`, `[ALERT]`), and a descriptive message. This allows parsing by security audit tools, Logstash, or SIEM systems.

---

### FEATURE 21: View / Remove Cron Jobs
- **What it does:** Inspects the current `/etc/cron.d/devserver` configuration, reports whether the systemd cron daemon is active, and provides a confirmation prompt to remove the schedule.
- **How it is implemented:**
  Queries `systemctl is-active cron`, displays file contents via `cat`, and if the admin confirms with `y`, removes the file with `rm -f /etc/cron.d/devserver`.
- **Technical Questions & Answers:**
  - **Q:** *Does removing the cron file stop running tasks immediately?*  
    **A:** Removing the file ensures no future jobs are spawned. Any currently running script processes finish their execution cycle.

---

### FEATURE 22: FULL AUTOMATIC SETUP
- **What it does:** Orchestrates end-to-end server provisioning in one command: installs packages, provisions 40 users, sets up LVM, configures shared repo folders, creates a sample repo, installs cron jobs, runs an initial verified backup, and displays the health dashboard.
- **How it is implemented:**
  Sequentially invokes internal functions:
  `install_packages -> bulk_users -> lvm_setup -> setup_repos -> create sample demo-project.git -> install_cron -> backup_now -> monitor.sh --dashboard`.
- **Technical Questions & Answers:**
  - **Q:** *How is idempotency maintained across this sequential execution?*  
    **A:** Each sub-function checks for pre-existing state before acting: `dpkg -s` checks packages, `id "$u"` checks users, `vgs "$VG"` checks storage, and `git config` checks safe directories. Re-running the script will not corrupt existing data or duplicate users.

---

### FEATURE 23: Auto Disk Management (LVM Auto-Grow & Emergency Cleanup)
- **What it does:** Solves Evaluator Feedback #2 by monitoring mounted partitions every 5 minutes in cron. When `/srv/repos` or `/srv/backups` reaches 80% capacity, it automatically extends the logical volume by +300MB using free space in `vg_dev`. If any partition hits 90%, it triggers emergency automated self-cleaning.
- **How it is implemented:**
  `scripts/auto_disk.sh` queries mount usage via `df -P`.
  If usage $\ge 80\%$, checks free space in `vg_dev` using `vgs --noheadings -o vg_free`. Runs `lvextend -r -L +${AUTO_EXTEND_MB}M /dev/vg_dev/$lv` and logs `[AUTO-GROW]` to `/var/log/devserver/activity.log`.
  If usage $\ge 90\%$, calls `cleanup.sh`, prunes Docker cache (`docker system prune -f`), and compresses stale logs.
- **Technical Questions & Answers:**
  - **Q:** *Why is automated disk expansion superior to static partition sizes?*  
    **A:** It eliminates the #1 cause of repository write failures (`ENOSPC: No space left on device`). Instead of paging on-call sysadmins at 2 AM, the kernel and LVM expand the ext4 filesystem online dynamically.
  - **Q:** *What happens if the Volume Group `vg_dev` runs out of unallocated extents?*  
    **A:** The script detects that free space is less than `AUTO_EXTEND_MB`, logs a warning alert, and triggers emergency cleanup to reclaim space while notifying administrators.

---

### FEATURE 24: Docker Dynamic Memory Allocation & LVM Integration
- **What it does:** Solves Evaluator Feedback #1 by containerizing developer environments and backend services with dynamic memory allocation, and binding host LVM volumes (`/srv/repos` and `/srv/backups`) directly into Docker containers.
- **How it is implemented:**
  `scripts/docker_manager.sh` and `docker-compose.yml`:
  - **Dynamic Memory:** Containers start with baseline reservations (`--memory-reservation 256m`) and hard limits (`--memory 512m`). Runtime memory is scaled dynamically on the fly without stopping containers using `docker update --memory <size> <container>`.
  - **LVM Mounts:** Direct volume bind mount: `-v /srv/repos:/workspace/repos:rw`. All code written inside containers is stored directly on the host's LVM ext4 partition, inheriting setgid permissions (`2775`) and auto-expansion capabilities.
- **Technical Questions & Answers:**
  - **Q:** *How does Docker dynamically change memory limits without restarting the container?*  
    **A:** Docker leverages Linux **cgroups v2** (control groups). When `docker update --memory 1024m` is executed, the Docker daemon updates `/sys/fs/cgroup/memory.max` for that container's cgroup slice in the kernel. The kernel memory controller immediately updates the threshold without terminating processes.
  - **Q:** *Why mount host LVM volumes into Docker containers instead of standard Docker named volumes?*  
    **A:** Standard Docker volumes live in `/var/lib/docker` on the root disk. Mapping host LVM volumes (`/srv/repos`) into containers decouples code storage from Docker daemon lifecycle, allows online LVM expansion (`lvextend -r`), and lets host-level backups (`backup.sh`) capture container data cleanly.

---

### FEATURE 25: Nginx Load Balancer Cluster & High Availability
- **What it does:** Solves Evaluator Feedback #2 by deploying a multi-worker backend cluster (ports 5001, 5002, 5003) fronted by an Nginx reverse proxy load balancer running the `least_conn` distribution algorithm.
- **How it is implemented:**
  `scripts/load_balancer.sh` spawns 3 isolated backend app instances. Nginx is configured with:
  ```nginx
  upstream devserver_cluster {
      least_conn;
      server 127.0.0.1:5001 max_fails=2 fail_timeout=10s;
      server 127.0.0.1:5002 max_fails=2 fail_timeout=10s;
      server 127.0.0.1:5003 max_fails=2 fail_timeout=10s;
  }
  ```
  The `--test-traffic` command fires 15 concurrent requests and inspects the `X-Backend-Server` response header to verify even traffic distribution.
- **Technical Questions & Answers:**
  - **Q:** *What is the difference between `round_robin` and `least_conn`?*  
    **A:** `round_robin` passes requests sequentially in a ring. `least_conn` inspects active connection counts and routes incoming requests to the worker currently processing the fewest active requests, preventing bottlenecks when handling heavy administrative operations (like LVM resizing or tar verification).
  - **Q:** *How does this architecture achieve High Availability (HA)?*  
    **A:** If worker 5001 crashes or hangs, Nginx marks it failed (`max_fails=2 fail_timeout=10s`) and transparently retries the request on 5002 or 5003 with zero dropped requests to the client.

---

## 4. Deep Conceptual Ideas Behind the Implementation

### 4.1 How Developer Accounts and Security Work
1. **User Identity:** Each developer (`dev01`..`dev40`) has a unique UID (starting at 1001) in `/etc/passwd`.
2. **Password Security:** Passwords are never stored in plaintext. They are hashed using SHA-512 with a salt and saved in `/etc/shadow`, readable only by `root`.
3. **Password Aging:** `chage -d 0` forces password expiry. At first SSH login, PAM triggers `pam_unix.so` to force an interactive password change before spawning `/bin/bash`.
4. **Group Permissions:** All developers belong to the secondary group `developers`.

### 4.2 How the Shared Git Architecture Works
1. **The Concurrency Problem:** When Developer A creates a commit, default permissions set file group ownership to Developer A's primary group. Developer B would be unable to push or edit that file.
2. **The Solution (Setgid `2775`):**
   - We set `/srv/repos` permissions to `2775`.
   - The leading `2` is the setgid bit. All files created within inherit group `developers`.
   - Group permission `7` (`rwx`) gives full read, write, and traverse access.
3. **Bare Git Repos:** Initialized with `--bare --shared=group`. Bare repositories do not possess a working tree, preventing checkout conflicts during remote `git push` operations.

### 4.3 How Storage (LVM) and Online Growing Work
1. **Hierarchy:**
   $$\text{Physical Device (e.g. /dev/sdb or loop0)} \longrightarrow \text{Physical Volume (PV)} \longrightarrow \text{Volume Group (vg\_dev)} \longrightarrow \text{Logical Volumes (lv\_repos, lv\_backup)}$$
2. **Dynamic Sizing:** The Volume Group acts as a storage pool. By assigning only 80% total to `lv_repos` and `lv_backup`, 20% remains unallocated free extents.
3. **Online Expansion:**
   ```bash
   lvextend -r -L +300M /dev/vg_dev/lv_repos
   ```
   Under the hood:
   - Device Mapper increases the block count of the logical volume.
   - The kernel driver allocates new Physical Extents (PEs) from `vg_dev`.
   - The `-r` flag triggers `resize2fs`, which updates the ext4 superblock and block group descriptors **while the filesystem remains online and mounted**.

### 4.4 How Background Automation (Cron) Works
- Rather than running a background daemon written in Python or C, we use Linux's native `cron` daemon (`cron.service`).
- We write to `/etc/cron.d/devserver`.
- The cron daemon wakes up every minute, stat-checks `/etc/cron.d/`, parses syntax, exports standard paths (`PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin`), switches process credentials to `root`, and forks the target script.

### 4.5 How the Web Dashboard & Security Model Work
- **Technology:** Python 3 and Flask, bound strictly to `127.0.0.1:5000`.
- **Command Security:** `subprocess.run(args, shell=False)` is used everywhere. Because `shell=False` passes arguments as an array directly to the `execve` system call, shell metacharacter injection (like `; rm -rf /`) is physically impossible.
- **Whitelist Enforcement:** Only commands in `COMMAND_WHITELIST` (`useradd`, `usermod`, `lvextend`, etc.) can be called.
- **Privilege Separation:** Read and dry-run operations are safe. Modification commands verify UID $\ge 1000$ to prevent modifying system accounts.

---

## 5. Individual Team Member Presentation Scripts

---

### MEMBER 1 SCRIPT: The Backup & Disaster Recovery System
**Focus:** `scripts/backup.sh` & Admin Panel Options 18/19

#### Spoken Presentation Script:
> *"Hello everyone. I am responsible for the **Backup, Verification, and Disaster Recovery** subsystem of the Dev Server Manager.
>
> In an enterprise developer environment, losing code repositories or account configurations can halt an entire engineering division. Our backup system is designed around three strict principles: **comprehensive scope, automated verification, and safe restoration**.
>
> Let's look at how `scripts/backup.sh` works:
>
> 1. **Data Scope:** We back up `/srv/repos`, but critically, we also include `/etc/passwd` and `/etc/group`. When files are restored on Linux, file ownership relies on numerical UIDs and GIDs. Without backing up the passwd and group mappings, a restored repository on another machine might assign ownership to random accounts.
> 2. **Execution:** We generate a compressed timestamped archive:
>    `tar -czf backup_YYYY-MM-DD_HHMMSS.tar.gz -C / srv/repos etc/passwd etc/group`.
> 3. **Integrity Verification:** A backup is useless if it is corrupt. Immediately after creation, our script runs `tar -tzf` against the new file. This reads and verifies the entire tar header and gzip stream. If corruption is detected, the script removes the bad file and logs an error.
> 4. **Retention Policy:** To prevent disk exhaustion on the `/srv/backups` volume, our script automatically finds and purges archives older than 7 days using `find -mtime +7 -delete`.
> 5. **Safe Restoration (Option 19):** When an administrator tests or inspects a backup, our script **never** overwrites production files. Instead, it extracts the archive into an isolated temporary folder in `/tmp/restore_<timestamp>`, lists the extracted repos, and displays the exact command to copy files back only if verified.
>
> Thank you."*

#### Teacher / Examiner Defense Questions for Member 1:
- **Q1:** *Why did you choose `tar -czf` instead of `rsync`?*  
  **Answer:** `tar` packages multiple directories, file attributes, permissions, and directory structures into a single atomic file that can be timestamped, compressed, moved off-site, and verified. `rsync` synchronizes directories, but doesn't easily create point-in-time point-in-history snapshots unless combined with hard links.
- **Q2:** *What does `tar -tzf` do?*  
  **Answer:** `-t` lists archive contents, `-z` runs decompression through gzip, and `-f` specifies the file. By redirecting output to `/dev/null`, we test whether every block can be uncompressed and read without error. If exit code is 0, the archive is healthy.
- **Q3:** *What happens if the backup volume runs out of space during backup?*  
  **Answer:** `tar` exits with a non-zero code. Our script checks `if tar -czf ...`, catches the failure, deletes the incomplete archive with `rm -f`, and logs `[ERROR] backup tar failed` to `/var/log/devserver/activity.log`.

---

### MEMBER 2 SCRIPT: The Automated Disk Cleanup System
**Focus:** `scripts/cleanup.sh` & Admin Panel Options 14/15

#### Spoken Presentation Script:
> *"Hello everyone. I am responsible for the **Automated Disk Cleanup and Storage Maintenance** subsystem.
>
> On a developer server with 40 active users compiling code, installing packages, and running tests, temporary files, editor backups, core dumps, and uncompressed logs quickly consume disk inodes and space.
>
> Our cleanup subsystem in `scripts/cleanup.sh` addresses this cleanly:
>
> 1. **Targeted Hygiene:** We clean temporary files older than 7 days in `/tmp`, files older than 30 days in `/var/tmp`, and developer editor swap files like `*.tmp`, `*~`, and program crash `core` dumps in `/home`.
> 2. **Cross-Device Protection (`-xdev`):** When running `find`, we enforce the `-xdev` flag. This prevents the search from crossing mount boundaries, ensuring we never inadvertently delete files inside mounted repos or network drives.
> 3. **Log Compression & APT Cache:** We find `.log` files older than 7 days in our log directory and compress them with `gzip -f`, saving up to 80% log space. We also invoke `apt-get clean` to clear downloaded package archives.
> 4. **Dry-Run Preview (Option 14):** Before any real deletion, administrators can run the script with `--dry-run`. This counts and previews files that would be removed without touching the filesystem.
> 5. **Space Metric Reporting:** The script measures filesystem blocks using `df --output=used -k /` immediately before and after cleanup, calculates the difference, and prints: *'Total files removed: X | Space freed: Y MB'*, which is also recorded in our central log.
>
> Thank you."*

#### Teacher / Examiner Defense Questions for Member 2:
- **Q1:** *What is a core dump file and why clean it?*  
  **Answer:** When a C, C++, or Go program crashes with a segmentation fault, the Linux kernel dumps its memory space into a file named `core`. These can be several gigabytes in size. Removing core files older than 7 days reclaims substantial disk space.
- **Q2:** *Why use `find -delete` instead of `find | xargs rm`?*  
  **Answer:** `find -delete` is faster and safer because it performs deletion directly within the `find` process without spawning extra shells or `rm` subprocesses. Furthermore, it handles file paths containing spaces or special characters without breaking.
- **Q3:** *How does your dry-run flag work in the code?*  
  **Answer:** We set `DRY=1` if `$1` is `--dry-run`. Inside our `clean()` function, an `if [ "$DRY" -eq 1 ]` branch runs `find` and pipes the first three matches to `sed` for preview, whereas the `else` branch appends `-delete` to the `find` invocation.

---

### MEMBER 3 SCRIPT: The Server Health Monitoring & Dashboard System
**Focus:** `scripts/monitor.sh` & Admin Panel Option 17

#### Spoken Presentation Script:
> *"Hello everyone. I am responsible for the **Server Health Monitoring and Observability** subsystem.
>
> A production development server requires proactive monitoring so system administrators can detect resource saturation before it impacts users.
>
> Our monitoring system in `scripts/monitor.sh` operates in two modes:
>
> 1. **Background Telemetry Mode (Cron):** Every 5 minutes, cron runs `monitor.sh` without arguments. It reads CPU load from `/proc/loadavg`, memory utilization from `free`, disk percentages across all physical mounts from `df`, and logged-in user counts from `who`. It appends this telemetry as a structured single-line entry into `/var/log/devserver/monitor.log`.
> 2. **Threshold Alerts:** The script evaluates system metrics against limits defined in `config.sh`:
>    - If 1-minute load average exceeds the total CPU core count (`load > cores`), an alert is triggered.
>    - If memory usage exceeds 85%, an alert is triggered.
>    - If any mounted disk partition exceeds 80%, an alert is triggered.
>    Alert lines are prefixed with `[ALERT]` and recorded in the monitor log.
> 3. **Interactive Dashboard Mode (Option 17):** When run with `--dashboard`, the script prints a visual terminal console with ASCII progress bars (`[#####-----] 50%`), lists the Top 5 CPU-consuming processes using `ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu`, lists all active user sessions, and checks `/var/log/auth.log` for failed SSH login attempts to spot brute-force attacks.
>
> This telemetry also powers the live gauges and Chart.js rolling graph on our Web Dashboard. Thank you."*

#### Teacher / Examiner Defense Questions for Member 3:
- **Q1:** *Where does the script get the CPU core count and load average?*  
  **Answer:** It gets the core count from `nproc`. The load average is parsed directly from `/proc/loadavg`, where the first field represents the 1-minute exponential moving average of processes in the run queue.
- **Q2:** *How do you avoid monitoring virtual filesystems like `tmpfs`?*  
  **Answer:** In the `disks()` function, we execute `df -P -x tmpfs -x devtmpfs -x squashfs`. The `-x` flag explicitly excludes RAM disks and snap packages, ensuring alerts are only evaluated against real persistent storage partitions.
- **Q3:** *Why is monitoring failed SSH logins in `auth.log` important?*  
  **Answer:** Repeated "Failed password" occurrences indicate unauthorized access attempts or SSH dictionary brute-force attacks. Surfacing this count alerts the administrator to consider deploying tools like `fail2ban` or tightening firewall rules.

