# Dev Server Manager — Linux Server for 40 Developers

A menu-driven Bash control panel that configures and maintains a Linux (Ubuntu) server for a software development company with **40 developers**: accounts, shared Git repositories, software packages, LVM storage, automated cleanup, cron jobs, monitoring, backup/restore and logging.

> Team: *<add names + roll numbers>*  |  Course: Linux Micro Project  |  Platform: Ubuntu 22.04/24.04 VM

## 1. Problem → Solution map

| Requirement | What we built | Menu option | Key commands |
|---|---|---|---|
| Developer accounts | `developers` group, bulk-create 40 users from `users.txt`, forced password change, lock/unlock, delete | 1–5 | `groupadd` `useradd` `chpasswd` `chage` `usermod -L` `userdel` `getent` |
| Shared repositories | `/srv/repos` with **setgid** (2775) + bare Git repos | 6–8 | `chmod 2775` `chgrp` `git init --bare --shared` |
| Software packages | Dev toolchain (git, gcc/make, python3, node, java, vim…) + status check | 9–10 | `apt-get` `dpkg -s` `dpkg-query` |
| Storage management | LVM: PV → VG → 2 LVs (repos, backup), ext4, mount, fstab, **online grow** | 11–13 | `pvcreate` `vgcreate` `lvcreate` `mkfs.ext4` `mount` `lvextend -r` `losetup` |
| Automated cleanup | Removes old temp/log/core files, compresses logs, dry-run mode, reports space freed | 14–15 | `find -mtime -delete` `gzip` `df` |
| Cron jobs | Monitor (5 min), backup (daily 02:00), cleanup (Sun 03:00) via `/etc/cron.d` | 16, 21 | cron syntax |
| Server monitoring | Dashboard: load, memory, disk bars, top processes, users, failed logins, **alerts** at thresholds | 17 | `free` `df` `uptime` `ps` `who` `awk` |
| Backup | Compressed tar of repos + account files, **verified**, 7-day retention, restore test | 18–19 | `tar -czf/-tzf/-xzf` `find` |
| Documentation | This README + logs in `/var/log/devserver/` | 20 | — |
| Everything at once | Full automatic setup | 22 | — |

## 2. Architecture

```
                 sudo ./admin_panel.sh   (menu, input validation, error handling)
                              |
   +----------+---------+-----+-----+-----------+------------+
   |          |         |           |           |            |
 Users &   Shared     Packages     LVM      scripts/      /var/log/
 Groups    Repos      (apt)     storage     cleanup.sh    devserver/
 (40 devs) /srv/repos            vg_dev     monitor.sh    activity.log
                                 ├ lv_repos  backup.sh     monitor.log
                                 └ lv_backup     ▲
                                              cron (/etc/cron.d/devserver)
config.sh  = shared settings (paths, thresholds, package list) used by every script
```

## 3. Project structure

```
dev-server-manager/
├── admin_panel.sh      main menu + all admin functions
├── config.sh           shared configuration + log() helper
├── users.txt           40 developers (username,Full Name)
├── scripts/
│   ├── cleanup.sh      cleanup  (--dry-run supported)
│   ├── monitor.sh      monitoring (--dashboard for live view, no args = log + alerts)
│   └── backup.sh       backup + verification + retention
└── README.md
```

## 4. Setup (Ubuntu VM)

```bash
sudo apt update && sudo apt install -y git
git clone https://github.com/<your-username>/dev-server-manager.git
cd dev-server-manager
chmod +x admin_panel.sh scripts/*.sh
sudo ./admin_panel.sh
```
For real-disk LVM, add a second virtual disk (≈5 GB, appears as `/dev/sdb`) to the VM before starting. Otherwise choose **demo mode** (virtual disk file) in option 11.

**Fastest path:** run option **22 (Full auto setup)**. Or go in order: 9 → 1 → 11 → 6 → 7 → 16 → 18 → 17.

## 5. How each part works (for explanation)

* **Users** – `useradd -m -s /bin/bash -G developers` creates the account, home and group membership. `chpasswd` sets a temporary password and `chage -d 0` forces a change at first login. Bulk creation reads `users.txt` line by line (`while IFS=, read`), skips blanks/comments/duplicates, and prints a created/skipped/failed summary.
* **Shared repos** – `chmod 2775` sets the **setgid bit**: every new file inherits group `developers`, so teammates can always edit each other's work. `git init --bare --shared=group` makes a central repository without a working tree.
* **LVM** – *PV* (physical disk) → *VG* (pool) → *LV* (slice). 20% of the pool is left free on purpose, so `lvextend -r` can grow a volume **while mounted** (`-r` also resizes the filesystem). Real disks go into `/etc/fstab` (`nofail`) to survive reboot; demo mode uses `losetup` and is re-attached automatically by option 12.
* **Cleanup** – `find DIR -type f -name PATTERN -mtime +N -delete`. Dry-run first (option 14) shows what *would* go. `df` before/after gives space freed.
* **Cron** – format `minute hour day month weekday user command`. Files in `/etc/cron.d/` need a user column.
* **Monitoring** – reads `/proc/loadavg`, `free`, `df`; `awk` compares against thresholds in `config.sh` (disk 80 %, memory 85 %, load > cores) and writes `ALERT` lines to `monitor.log`.
* **Backup** – `tar -czf` → verify with `tar -tzf` → delete archives older than 7 days. Restore (option 19) extracts to `/tmp/restore_*` so live data is never overwritten by accident.

## 6. Error handling shown in the demo

Empty input · non-numeric menu choice · invalid username · duplicate user/repo · deleting a system account (refused) · missing `users.txt` · missing repo dir · LVM disk mounted (refused) · size larger than free space · non-block device · invalid backup number · script run without `sudo` · Ctrl-D / closed input.

## 7. Live demo script (≈6 minutes)

1. `sudo ./admin_panel.sh` → type `99`, press Enter on empty → show error handling.
2. **22 Full auto setup** *(or 9, 1, 11, 6, 7)* → explain each stage as it runs.
3. **4** list developers (40) → **2** add a user, try a bad name → **5** lock one.
4. **7** create repo `webapp`; as a dev: `su - dev02`, `git clone /srv/repos/webapp.git`, commit, push.
5. **12** LVM status → **13** grow `lv_repos` by 300 MB, show BEFORE/AFTER.
6. **14** cleanup preview → **15** run it.
7. **18** backup → **19** restore test.
8. **16 / 21** show cron jobs → **17** dashboard → **20** logs.
9. Open `scripts/monitor.sh` and explain 2–3 lines.

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `bad interpreter: /bin/bash^M` | `sudo apt install dos2unix && dos2unix *.sh scripts/*.sh config.sh` |
| `Permission denied` | `chmod +x admin_panel.sh scripts/*.sh`, run with `sudo` |
| LVM demo gone after reboot | Menu option 12 re-attaches it |
| `apt` fails | Check VM network (NAT) |
| git "dubious ownership" | Option 6 already sets `safe.directory '*'` |
