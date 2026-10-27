# Dev Server Manager — Web Dashboard

The **Dev Server Manager Web Dashboard** is a web-based DevOps management layer built on top of the Linux Server Administration project (Ubuntu 22.04/24.04 VM, 40 developers).

It is designed as an interface layer that **leaves the original Bash management suite (`admin_panel.sh`, `config.sh`, and `scripts/`) completely untouched**. Both the interactive Bash menu and this Web Dashboard can run side-by-side on the server.

---

## Architecture & Features

```
                               +-----------------------------+
                               |     Web Browser (Client)    |
                               | (Dark DevOps Console Theme) |
                               +--------------+--------------+
                                              | REST JSON (127.0.0.1:5000)
                                              v
                               +-----------------------------+
                               |     webapp/app.py (Flask)   |
                               |  - Whitelisted subprocess   |
                               |  - Strict Regex Validation  |
                               |  - Command/Output Auditor   |
                               +--------------+--------------+
                                              |
                     +------------------------+------------------------+
                     | (Production: sudo)                              | (DEMO=1)
                     v                                                 v
    +--------------------------------+                +--------------------------------+
    |   Ubuntu Host Linux Commands   |                |     In-Memory Demo Engine      |
    | - useradd / usermod / userdel  |                | - 40 Developers dev01..dev40   |
    | - git init --bare --shared     |                | - 3 Shared Repositories        |
    | - LVM: pvs / vgs / lvextend -r |                | - LVM Topology (vg_dev 3GB)    |
    | - scripts/cleanup.sh, backup.sh|                | - Stateful mutations & logs    |
    | - /var/log/devserver/*.log     |                | - Simulated Command Drawer     |
    +--------------------------------+                +--------------------------------+
```

### Key Capabilities
- **Overview Telemetry**: Real-time KPI cards (developer count, repository count, backup status, cron count), live animated gauges for CPU load, memory, and root disk, and a **60-point rolling line chart** powered by Chart.js.
- **Developer Management**: Searchable and sortable table of the 40 developer accounts (`dev01`..`dev40`), with account status toggles (lock/unlock via `usermod -L/-U`), deletion (`userdel -r`), and an **Add Developer** modal enforcing username policy and temporary passwords (`Welcome@123` with `chage -d 0`).
- **Shared Repositories**: Visual grid of shared bare Git repositories located in `/srv/repos/*.git`, displaying group ownership (`developers`), setgid mode (`2775`), and one-click copyable clone commands.
- **Storage Management (LVM)**: Visual topology diagram depicting `PV (/dev/loop0) -> VG (vg_dev) -> LVs (lv_repos, lv_backup)`, plus an **Online Volume Grow Console** that previews before/after allocation and executes zero-downtime expansion via `lvextend -r -L +<mb>M`.
- **System Automation**: Visual cron timeline displaying `/etc/cron.d/devserver` jobs in plain English, with on-demand controls to run **Disk Cleanup Dry-Run** (`cleanup.sh --dry-run`) or **Full Cleanup**.
- **Backup & Recovery**: Audit list of verified archives in `/srv/backups/`, retention enforcement (7 days), and one-click **Backup Now** execution.
- **System Log Viewer**: Tabbed monospace viewer for `activity.log` and `monitor.log` with real-time text filtering, auto-scroll, and **red alert highlighting** for threshold warnings.
- **Terminal Command Inspector**: A collapsible bottom drawer that displays the **exact Linux command that ran** and its **raw stdout/stderr output** for every single interaction. This lets evaluators see the underlying Linux commands powering each action.

---

## Quick Start: Running the Dashboard

### 1. Install Dependencies
The backend requires Python 3 and Flask only:
```bash
pip install -r webapp/requirements.txt
```

### 2. Demo Mode (Laptop / Non-Root Development)
In Demo Mode, every endpoint returns realistic mock data for 40 developers, 3 repositories, healthy LVM partitions, and system logs. All mutations (adding users, locking accounts, growing LVM volumes, running cleanups, creating backups) update an in-memory copy so the dashboard feels alive.

**Linux / macOS:**
```bash
cd webapp
DEMO=1 python3 app.py
```

**Windows (PowerShell):**
```powershell
cd webapp
$env:DEMO="1"; python app.py
```

Open your browser to:
```
http://127.0.0.1:5000
```

## Screenshots & 2-Minute Demo

### Capture screenshots

Run the dashboard in Demo Mode (the in-memory data makes the walkthrough safe
and repeatable), open `http://127.0.0.1:5000`, and set the browser viewport to
about 1440 × 900. Capture the page with your browser or operating-system
screenshot tool and save the images locally; no screenshot or browser extension
is required by the project.

Suggested shots:

1. **Overview** — show the health banner, KPI cards, gauges, and live chart.
2. **About / Architecture** — show the Browser → Flask API → Bash scripts →
   Linux diagram and the feature-to-command table.
3. **Developers or Repositories** — show the searchable list and a management
   action.
4. **Automation or Logs** — show the cleanup preview, scheduled jobs, or live
   log viewer, with the command drawer expanded if useful.

### Walkthrough script (about 2 minutes)

Start the app in Demo Mode using the instructions above. All changes during
this walkthrough are in-memory demo data and disappear when the server restarts.

| Time | Demo |
|---|---|
| 0:00–0:20 | Open **Overview**. Point out the system health summary, account/repository KPIs, resource gauges, and rolling chart. |
| 0:20–0:40 | Open **About / Architecture**. Follow a request from the browser through Flask and the existing scripts to Linux, then scan the command map. |
| 0:40–1:00 | Open **Developers**. Search or filter the account list and show the add-user dialog; optionally create a clearly named demo account. |
| 1:00–1:20 | Open **Repositories** and show shared repository details. Optionally create a demo-only repository to demonstrate the interaction. |
| 1:20–1:40 | Open **Storage (LVM)** and show the volume topology and resize preview. In Demo Mode, an optional resize changes only simulated data. |
| 1:40–2:00 | Open **Automation**, run **Dry Run** only, then show **System Logs** and expand the command drawer to explain the API output. |

For a real production server, do not use this demo script as authorization to
perform mutations: user/repository creation, LVM extension, backup creation,
and full cleanup affect the host. Review each operation and its impact first.

### 3. Production Mode (On Ubuntu 22.04/24.04 VM as Root)
On the target Linux VM, run the backend with `sudo` so it can execute system administration binaries (`useradd`, `lvextend`, `systemctl`, etc.):

```bash
cd webapp
sudo python3 app.py
```

The web server will automatically detect Linux root privileges and operate in live mode.

---

## Security Model

The backend includes security safeguards designed for server administration interfaces:

1. **Localhost Binding Only**:
   The Flask server is explicitly hardcoded to bind to `127.0.0.1:5000`. It is never exposed directly on `0.0.0.0`. If remote access is desired, access should be proxied through an authenticated SSH tunnel (`ssh -L 5000:localhost:5000 user@server`) or a hardened reverse proxy (e.g. Nginx with TLS and HTTP basic authentication).

2. **No Shell Execution (`shell=False`)**:
   Every command is executed using `subprocess.run` with discrete argument lists (`["useradd", "-m", "-s", "/bin/bash", ...]`). `shell=True` is **never** used, eliminating command chaining and shell injection vulnerabilities.

3. **Strict Whitelist of Binaries**:
   Only pre-approved administrative binaries can be called:
   `useradd`, `usermod`, `userdel`, `chpasswd`, `chage`, `getent`, `passwd`, `id`, `lastlog`, `uptime`, `free`, `df`, `who`, `pvs`, `vgs`, `lvs`, `lvextend`, `git`, `chgrp`, `chmod`, `tail`, `cat`, and `bash` (restricted to scripts in `./scripts/`).

4. **Strict Input Validation**:
   All user parameters are strictly validated before execution:
   - **Usernames**: Must match regex `^[a-z][a-z0-9_-]{1,31}$` (lowercase letter start, 1-32 chars).
   - **Repository Names**: Must match regex `^[A-Za-z0-9._-]+$`.
   - **LVM Extension**: Must be a positive integer and cannot exceed current volume group free space.

5. **System Account Protection**:
   All user modification and deletion endpoints (`/api/users/<username>/lock`, `unlock`, and `DELETE`) query the target account UID via `id -u <username>`. Any attempt to modify or delete a system account (`UID < 1000`) is blocked and returns HTTP 403 Forbidden.

---

## API Reference

Every endpoint returns a standard JSON envelope:
```json
{
  "ok": true,
  "data": { ... },
  "command": "exact linux command that ran",
  "output": "raw stdout/stderr output"
}
```

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | Telemetry: CPU load, cores, memory %, uptime, active users, mount points, and threshold alerts |
| `GET` | `/api/users` | List members of group `developers` with full name, lock status, and last login |
| `POST` | `/api/users` | Create developer account, assign to `developers`, set temp password `Welcome@123` |
| `POST` | `/api/users/<user>/lock` | Lock account via `usermod -L` (protects UID < 1000) |
| `POST` | `/api/users/<user>/unlock` | Unlock account via `usermod -U` (protects UID < 1000) |
| `DELETE` | `/api/users/<user>` | Remove user and home directory via `userdel -r` (protects UID < 1000) |
| `GET` | `/api/repos` | List bare Git repositories in `/srv/repos/` with size and group |
| `POST` | `/api/repos` | Initialize bare shared repository with group `developers` and setgid (`2775`) |
| `GET` | `/api/lvm` | Parsed LVM topology (`pvs`, `vgs`, `lvs`) with available free space; returns `configured: false` and a helpful message when `vg_dev` or LVM tools are unavailable |
| `POST` | `/api/lvm/extend` | Online grow of `lv_repos` or `lv_backup` via `lvextend -r -L +<mb>M` |
| `GET` | `/api/cron` | Parsed schedules from `/etc/cron.d/devserver`; returns an empty list when no jobs are configured |
| `POST` | `/api/cleanup` | Execute cleanup dry-run (`--dry-run`) or actual cleanup (`scripts/cleanup.sh`) |
| `POST` | `/api/backup` | Execute immediate verified backup archive (`scripts/backup.sh`) |
| `GET` | `/api/backups` | List backup archives in `/srv/backups/` sorted newest first |
| `GET` | `/api/logs` | Fetch tail of `/var/log/devserver/activity.log` or `monitor.log` |

Production-path read endpoints and safe dry-runs can be checked without changing
the host by running `python3 test_production_endpoints.py` from this directory.
The tests mock Linux command output and do not modify users, repositories,
volumes, backups, logs, or cleanup targets.

To check the live endpoints on the Ubuntu VM, leave the dashboard running and
run `python3 check_live_endpoints.py` from this directory on the VM. This checks
the read-only endpoints and runs cleanup in dry-run mode only. It does not
create users, repositories, or backups, and does not resize LVM.
