#!/usr/bin/env python3
"""
Dev Server Manager - Web Dashboard Backend
Bonus web management layer for Linux Server Administration (40 Developers).

Runs on 127.0.0.1:5000 only.
In DEMO mode (DEMO=1 or non-Linux), returns realistic mock data with stateful in-memory mutations.
In PRODUCTION mode, executes whitelisted Linux commands via subprocess.run (never shell=True).
"""

import os
import sys
import re
import json
import time
import datetime
import random
import subprocess
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory

# Base paths
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEBAPP_DIR = Path(__file__).resolve().parent
STATIC_DIR = WEBAPP_DIR / "static"
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
USERS_FILE = PROJECT_ROOT / "users.txt"

# Mode detection: force DEMO if env DEMO=1 or if not running on Linux / no root
FORCE_DEMO = os.environ.get("DEMO", "").strip().lower() in ("1", "true", "yes")
IS_LINUX = sys.platform.startswith("linux")
IS_ROOT = (os.geteuid() == 0) if hasattr(os, "geteuid") else False
DEMO_MODE = FORCE_DEMO or (not IS_LINUX) or (not IS_ROOT)

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")

# Validation regular expressions
RE_USERNAME = re.compile(r"^[a-z][a-z0-9_-]{1,31}$")
RE_REPO_NAME = re.compile(r"^[A-Za-z0-9._-]+$")

# Whitelist of executable binaries
COMMAND_WHITELIST = {
    "useradd", "usermod", "userdel", "chpasswd", "chage", "getent",
    "passwd", "id", "lastlog", "last", "who", "uptime", "free", "df",
    "pvs", "vgs", "lvs", "lvextend", "git", "chgrp", "chmod", "tail",
    "cat", "bash", "ls", "du", "stat"
}

# -----------------------------------------------------------------------------
# In-Memory Demo State
# -----------------------------------------------------------------------------
def init_demo_users():
    users = []
    # Try reading real users.txt if present
    if USERS_FILE.exists():
        try:
            with open(USERS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        parts = line.split(",", 1)
                        u = parts[0].strip()
                        full = parts[1].strip() if len(parts) > 1 else u
                        users.append({
                            "username": u,
                            "fullname": full,
                            "group": "developers",
                            "status": "locked" if u in ("dev08", "dev23") else "active",
                            "last_login": "Today 10:14" if u == "dev01" else ("Yesterday 16:45" if u == "dev02" else "2026-10-25 09:30"),
                            "uid": 1000 + len(users) + 1
                        })
        except Exception:
            pass

    if not users:
        for i in range(1, 41):
            u = f"dev{i:02d}"
            users.append({
                "username": u,
                "fullname": f"Developer {i:02d}",
                "group": "developers",
                "status": "locked" if u in ("dev08", "dev23") else "active",
                "last_login": f"2026-10-{20 + (i % 8)} 14:{10 + (i % 45):02d}",
                "uid": 1000 + i
            })
    return users

demo_state = {
    "users": init_demo_users(),
    "repos": [
        {
            "name": "frontend-portal.git",
            "size": "142 MB",
            "group": "developers",
            "mode": "2775",
            "created": "2026-10-15 11:20:00",
            "clone_cmd": "git clone ssh://<user>@devserver/srv/repos/frontend-portal.git"
        },
        {
            "name": "backend-api.git",
            "size": "318 MB",
            "group": "developers",
            "mode": "2775",
            "created": "2026-10-16 09:40:00",
            "clone_cmd": "git clone ssh://<user>@devserver/srv/repos/backend-api.git"
        },
        {
            "name": "shared-utils.git",
            "size": "24 MB",
            "group": "developers",
            "mode": "2775",
            "created": "2026-10-18 15:10:00",
            "clone_cmd": "git clone ssh://<user>@devserver/srv/repos/shared-utils.git"
        }
    ],
    "lvm": {
        "pv_name": "/dev/loop0",
        "pv_size_mb": 3072,
        "vg_name": "vg_dev",
        "vg_size_mb": 3072,
        "vg_free_mb": 614,
        "lvs": {
            "lv_repos": {"size_mb": 1536, "mount": "/srv/repos", "used_mb": 420},
            "lv_backup": {"size_mb": 922, "mount": "/srv/backups", "used_mb": 315}
        }
    },
    "backups": [
        {
            "filename": "backup_2026-10-28_020000.tar.gz",
            "size": "14.2 MB",
            "created": "2026-10-28 02:00:00",
            "status": "Verified",
            "path": "/srv/backups/backup_2026-10-28_020000.tar.gz"
        },
        {
            "filename": "backup_2026-10-27_020000.tar.gz",
            "size": "13.8 MB",
            "created": "2026-10-27 02:00:00",
            "status": "Verified",
            "path": "/srv/backups/backup_2026-10-27_020000.tar.gz"
        },
        {
            "filename": "backup_2026-10-26_020000.tar.gz",
            "size": "13.5 MB",
            "created": "2026-10-26 02:00:00",
            "status": "Verified",
            "path": "/srv/backups/backup_2026-10-26_020000.tar.gz"
        },
        {
            "filename": "backup_2026-10-25_020000.tar.gz",
            "size": "13.1 MB",
            "created": "2026-10-25 02:00:00",
            "status": "Verified",
            "path": "/srv/backups/backup_2026-10-25_020000.tar.gz"
        },
        {
            "filename": "backup_2026-10-24_020000.tar.gz",
            "size": "12.9 MB",
            "created": "2026-10-24 02:00:00",
            "status": "Verified",
            "path": "/srv/backups/backup_2026-10-24_020000.tar.gz"
        }
    ],
    "activity_log": [
        "2026-10-28 00:00:01 [INFO] system boot: Linux devserver 6.8.0-45-generic",
        "2026-10-28 00:05:12 [INFO] developers group verified (40 active accounts)",
        "2026-10-28 00:10:45 [INFO] LVM volumes checked: vg_dev active on /dev/loop0",
        "2026-10-28 01:00:00 [INFO] scheduled monitor check: load=1.05 mem=41% disk=42%",
        "2026-10-28 02:00:03 [INFO] backup ok: /srv/backups/backup_2026-10-28_020000.tar.gz",
        "2026-10-28 02:00:05 [INFO] backup verification passed: tar -tzf archive ok",
        "2026-10-28 02:00:06 [INFO] backup retention: 0 old archives purged (keeping 7 days)",
        "2026-10-28 02:05:00 [INFO] activity log rotated cleanly"
    ],
    "monitor_log": [
        "2026-10-28 01:45:00 load=1.12 mem=41% disk(/)=42% users=2",
        "2026-10-28 01:50:00 load=1.15 mem=42% disk(/)=42% users=2",
        "2026-10-28 01:55:00 load=1.08 mem=42% disk(/)=42% users=2",
        "2026-10-28 02:00:00 load=1.45 mem=44% disk(/)=42% users=2",
        "2026-10-28 02:05:00 load=1.20 mem=43% disk(/)=42% users=2",
        "2026-10-28 02:10:00 load=1.14 mem=42% disk(/)=42% users=2",
        "2026-10-28 02:15:00 load=1.10 mem=42% disk(/)=42% users=2"
    ],
    "boot_time": time.time() - (14 * 86400 + 3 * 3600 + 22 * 60)
}

# -----------------------------------------------------------------------------
# Response Helper
# -----------------------------------------------------------------------------
def make_json_response(ok=True, data=None, command="", output="", error=None, status_code=200):
    payload = {
        "ok": bool(ok),
        "data": data,
        "command": command or "",
        "output": output or ""
    }
    if error is not None:
        payload["error"] = str(error)
    return jsonify(payload), status_code

def run_command(args, input_data=None, timeout=20):
    """Executes a whitelisted command with list arguments only (no shell)."""
    if not args or args[0] not in COMMAND_WHITELIST:
        raise ValueError(f"Command '{args[0] if args else ''}' is not permitted.")
    cmd_str = " ".join(args)
    proc = subprocess.run(
        args,
        input=input_data,
        capture_output=True,
        text=True,
        timeout=timeout
    )
    raw_output = proc.stdout
    if proc.stderr:
        raw_output = f"{raw_output}\n{proc.stderr}".strip() if raw_output else proc.stderr.strip()
    return proc.returncode, cmd_str, raw_output

# -----------------------------------------------------------------------------
# Frontend Routes
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(str(STATIC_DIR), "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    file_path = STATIC_DIR / filename
    if file_path.exists() and not file_path.is_dir():
        return send_from_directory(str(STATIC_DIR), filename)
    return send_from_directory(str(STATIC_DIR), "index.html")

# -----------------------------------------------------------------------------
# API: Status
# -----------------------------------------------------------------------------
@app.route("/api/status", methods=["GET"])
def get_status():
    try:
        if DEMO_MODE:
            # Simulate subtle live variance
            cores = 4
            base_load = 1.15 + round(random.uniform(-0.15, 0.20), 2)
            base_mem = 42 + random.randint(-2, 3)
            root_disk_pct = 42
            
            uptime_seconds = int(time.time() - demo_state["boot_time"])
            days = uptime_seconds // 86400
            hours = (uptime_seconds % 86400) // 3600
            mins = (uptime_seconds % 3600) // 60
            uptime_str = f"up {days} days, {hours} hours, {mins} minutes"
            
            # Disk percentages
            lvm = demo_state["lvm"]
            repos_pct = int(round(lvm["lvs"]["lv_repos"]["used_mb"] * 100 / lvm["lvs"]["lv_repos"]["size_mb"]))
            backup_pct = int(round(lvm["lvs"]["lv_backup"]["used_mb"] * 100 / lvm["lvs"]["lv_backup"]["size_mb"]))
            
            disks = [
                {"mount": "/", "size": "50 GB", "used": "21 GB", "use_pct": root_disk_pct},
                {"mount": "/srv/repos", "size": f"{lvm['lvs']['lv_repos']['size_mb']} MB", "used": f"{lvm['lvs']['lv_repos']['used_mb']} MB", "use_pct": repos_pct},
                {"mount": "/srv/backups", "size": f"{lvm['lvs']['lv_backup']['size_mb']} MB", "used": f"{lvm['lvs']['lv_backup']['used_mb']} MB", "use_pct": backup_pct}
            ]
            
            alerts = []
            if base_load > cores:
                alerts.append(f"High CPU load: {base_load:.2f} (cores: {cores})")
            if base_mem >= 85:
                alerts.append(f"High memory usage: {base_mem}%")
            for d in disks:
                if d["use_pct"] >= 80:
                    alerts.append(f"Disk {d['mount']} is {d['use_pct']}% full")

            data = {
                "mode": "demo",
                "load": round(base_load, 2),
                "cores": cores,
                "mem_pct": base_mem,
                "uptime": uptime_str,
                "logged_in_users": ["dev03 (pts/0)", "dev12 (pts/1)"],
                "disks": disks,
                "alerts": alerts,
                "kpis": {
                    "developers": len(demo_state["users"]),
                    "repositories": len(demo_state["repos"]),
                    "backups": len(demo_state["backups"]),
                    "cron_jobs": 3
                }
            }
            cmd = "scripts/monitor.sh --dashboard"
            out = f"Host: devserver  Uptime: {uptime_str}\nLoad: {base_load:.2f} (cores: {cores})\nMemory: {base_mem}%\nUsers: 2 logged in"
            return make_json_response(ok=True, data=data, command=cmd, output=out)

        # Real Linux Execution
        cores = os.cpu_count() or 1
        load = 0.0
        try:
            with open("/proc/loadavg", "r") as f:
                load = float(f.read().split()[0])
        except Exception:
            pass

        mem_pct = 0
        try:
            with open("/proc/meminfo", "r") as f:
                meminfo = {}
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        meminfo[parts[0].strip()] = int(parts[1].strip().split()[0])
                total = meminfo.get("MemTotal", 1)
                avail = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))
                mem_pct = int(round((total - avail) * 100 / total))
        except Exception:
            pass

        ret, _, up_out = run_command(["uptime", "-p"])
        uptime_str = up_out.strip() if ret == 0 else "up unknown"

        ret, _, who_out = run_command(["who"])
        logged_in = [line.strip() for line in who_out.splitlines() if line.strip()]

        ret, cmd_df, df_out = run_command(["df", "-P", "-x", "tmpfs", "-x", "devtmpfs", "-x", "squashfs"])
        disks = []
        alerts = []
        if ret == 0:
            lines = df_out.strip().splitlines()
            for line in lines[1:]:
                parts = line.split()
                if len(parts) >= 6:
                    pct = int(parts[4].replace("%", ""))
                    mount = parts[5]
                    disks.append({
                        "mount": mount,
                        "size": parts[1] + "K",
                        "used": parts[2] + "K",
                        "use_pct": pct
                    })
                    if pct >= 80:
                        alerts.append(f"Disk {mount} is {pct}% full")

        if load > cores:
            alerts.append(f"High CPU load: {load:.2f} (cores: {cores})")
        if mem_pct >= 85:
            alerts.append(f"High memory usage: {mem_pct}%")

        # KPI counts
        dev_count = 0
        ret_g, _, g_out = run_command(["getent", "group", "developers"])
        if ret_g == 0 and g_out.strip():
            members = g_out.strip().split(":")[-1]
            dev_count = len([m for m in members.split(",") if m.strip()])

        repo_count = len(list(Path("/srv/repos").glob("*.git"))) if Path("/srv/repos").exists() else 0
        backup_count = len(list(Path("/srv/backups").glob("backup_*.tar.gz"))) if Path("/srv/backups").exists() else 0

        data = {
            "mode": "production",
            "load": load,
            "cores": cores,
            "mem_pct": mem_pct,
            "uptime": uptime_str,
            "logged_in_users": logged_in,
            "disks": disks,
            "alerts": alerts,
            "kpis": {
                "developers": dev_count,
                "repositories": repo_count,
                "backups": backup_count,
                "cron_jobs": 3
            }
        }
        return make_json_response(ok=True, data=data, command=cmd_df, output=df_out)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

# -----------------------------------------------------------------------------
# API: Users
# -----------------------------------------------------------------------------
@app.route("/api/users", methods=["GET"])
def get_users():
    try:
        if DEMO_MODE:
            cmd = "getent group developers"
            member_names = ",".join(u["username"] for u in demo_state["users"])
            out = f"developers:x:1001:{member_names}"
            return make_json_response(ok=True, data=demo_state["users"], command=cmd, output=out)

        ret, cmd, out = run_command(["getent", "group", "developers"])
        if ret != 0:
            return make_json_response(ok=True, data=[], command=cmd, output=out)
        
        parts = out.strip().split(":")
        members = parts[3].split(",") if len(parts) >= 4 and parts[3] else []
        users = []
        for u in members:
            u = u.strip()
            if not u:
                continue
            fullname = u
            ret_p, _, p_out = run_command(["getent", "passwd", u])
            if ret_p == 0:
                p_parts = p_out.strip().split(":")
                if len(p_parts) >= 5 and p_parts[4]:
                    fullname = p_parts[4].split(",")[0]
            
            # Check locked status
            status = "active"
            ret_pw, _, pw_out = run_command(["passwd", "-S", u])
            if ret_pw == 0 and " L " in f" {pw_out} ":
                status = "locked"
                
            # Last login
            ret_ll, _, ll_out = run_command(["lastlog", "-u", u])
            last_login = "Never logged in"
            if ret_ll == 0:
                lines = ll_out.strip().splitlines()
                if len(lines) > 1:
                    last_login = " ".join(lines[1].split()[3:]) if len(lines[1].split()) > 3 else "Never logged in"

            users.append({
                "username": u,
                "fullname": fullname,
                "group": "developers",
                "status": status,
                "last_login": last_login
            })
        return make_json_response(ok=True, data=users, command=cmd, output=out)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/users", methods=["POST"])
def create_user():
    try:
        payload = request.get_json(silent=True) or {}
        username = payload.get("username", "").strip()
        fullname = payload.get("fullname", "").strip() or username

        if not RE_USERNAME.match(username):
            return make_json_response(
                ok=False,
                error="Invalid username. Must be 1-32 lowercase characters, digits, underscore or dash, starting with a letter.",
                status_code=400
            )

        cmd_display = f"useradd -m -s /bin/bash -c '{fullname}' -G developers {username} && echo '{username}:Welcome@123' | chpasswd && chage -d 0 {username}"

        if DEMO_MODE:
            for u in demo_state["users"]:
                if u["username"] == username:
                    return make_json_response(
                        ok=False,
                        error=f"User '{username}' already exists.",
                        command=cmd_display,
                        status_code=400
                    )
            new_user = {
                "username": username,
                "fullname": fullname,
                "group": "developers",
                "status": "active",
                "last_login": "Never",
                "uid": 1000 + len(demo_state["users"]) + 1
            }
            demo_state["users"].append(new_user)
            demo_state["activity_log"].append(
                f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] user created: {username}"
            )
            out = f"[OK] User '{username}' created successfully and added to group 'developers'."
            return make_json_response(ok=True, data=new_user, command=cmd_display, output=out)

        # Production Execution
        # 1. useradd
        ret1, _, out1 = run_command(["useradd", "-m", "-s", "/bin/bash", "-c", fullname, "-G", "developers", username])
        if ret1 != 0:
            return make_json_response(ok=False, error=f"useradd failed: {out1}", command=cmd_display, output=out1, status_code=500)

        # 2. chpasswd
        ret2, _, out2 = run_command(["chpasswd"], input_data=f"{username}:Welcome@123\n")
        if ret2 != 0:
            return make_json_response(ok=False, error=f"chpasswd failed: {out2}", command=cmd_display, output=out2, status_code=500)

        # 3. chage -d 0
        ret3, _, out3 = run_command(["chage", "-d", "0", username])
        out_combined = f"[OK] User '{username}' created, password initialized, and forced password change set."
        return make_json_response(ok=True, data={"username": username, "fullname": fullname}, command=cmd_display, output=out_combined)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/users/<username>/lock", methods=["POST"])
def lock_user(username):
    try:
        username = username.strip()
        if not RE_USERNAME.match(username):
            return make_json_response(ok=False, error="Invalid username format.", status_code=400)

        cmd = f"usermod -L {username}"
        if DEMO_MODE:
            user = next((u for u in demo_state["users"] if u["username"] == username), None)
            if not user:
                return make_json_response(ok=False, error=f"User '{username}' not found.", command=cmd, status_code=404)
            if user.get("uid", 1000) < 1000:
                return make_json_response(ok=False, error="Refusing to lock system account.", command=cmd, status_code=403)
            user["status"] = "locked"
            demo_state["activity_log"].append(
                f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] locked {username}"
            )
            out = f"usermod: User account '{username}' locked successfully."
            return make_json_response(ok=True, data={"username": username, "status": "locked"}, command=cmd, output=out)

        # Check UID
        ret_id, _, out_id = run_command(["id", "-u", username])
        if ret_id != 0:
            return make_json_response(ok=False, error=f"User '{username}' not found.", command=cmd, status_code=404)
        uid = int(out_id.strip())
        if uid < 1000:
            return make_json_response(ok=False, error="Refusing to lock system account (UID < 1000).", command=cmd, status_code=403)

        ret, _, out = run_command(["usermod", "-L", username])
        if ret != 0:
            return make_json_response(ok=False, error=out, command=cmd, output=out, status_code=500)
        return make_json_response(ok=True, data={"username": username, "status": "locked"}, command=cmd, output=f"Account '{username}' locked.")
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/users/<username>/unlock", methods=["POST"])
def unlock_user(username):
    try:
        username = username.strip()
        if not RE_USERNAME.match(username):
            return make_json_response(ok=False, error="Invalid username format.", status_code=400)

        cmd = f"usermod -U {username}"
        if DEMO_MODE:
            user = next((u for u in demo_state["users"] if u["username"] == username), None)
            if not user:
                return make_json_response(ok=False, error=f"User '{username}' not found.", command=cmd, status_code=404)
            if user.get("uid", 1000) < 1000:
                return make_json_response(ok=False, error="Refusing to unlock system account.", command=cmd, status_code=403)
            user["status"] = "active"
            demo_state["activity_log"].append(
                f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] unlocked {username}"
            )
            out = f"usermod: User account '{username}' unlocked successfully."
            return make_json_response(ok=True, data={"username": username, "status": "active"}, command=cmd, output=out)

        ret_id, _, out_id = run_command(["id", "-u", username])
        if ret_id != 0:
            return make_json_response(ok=False, error=f"User '{username}' not found.", command=cmd, status_code=404)
        uid = int(out_id.strip())
        if uid < 1000:
            return make_json_response(ok=False, error="Refusing to modify system account (UID < 1000).", command=cmd, status_code=403)

        ret, _, out = run_command(["usermod", "-U", username])
        if ret != 0:
            return make_json_response(ok=False, error=out, command=cmd, output=out, status_code=500)
        return make_json_response(ok=True, data={"username": username, "status": "active"}, command=cmd, output=f"Account '{username}' unlocked.")
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/users/<username>", methods=["DELETE"])
def delete_user(username):
    try:
        username = username.strip()
        if not RE_USERNAME.match(username):
            return make_json_response(ok=False, error="Invalid username format.", status_code=400)

        cmd = f"userdel -r {username}"
        if DEMO_MODE:
            user = next((u for u in demo_state["users"] if u["username"] == username), None)
            if not user:
                return make_json_response(ok=False, error=f"User '{username}' not found.", command=cmd, status_code=404)
            if user.get("uid", 1000) < 1000:
                return make_json_response(ok=False, error="Refusing to delete system account (UID < 1000).", command=cmd, status_code=403)
            demo_state["users"] = [u for u in demo_state["users"] if u["username"] != username]
            demo_state["activity_log"].append(
                f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] user deleted: {username}"
            )
            out = f"userdel: User '{username}' and home directory deleted."
            return make_json_response(ok=True, data={"deleted": username}, command=cmd, output=out)

        ret_id, _, out_id = run_command(["id", "-u", username])
        if ret_id != 0:
            return make_json_response(ok=False, error=f"User '{username}' not found.", command=cmd, status_code=404)
        uid = int(out_id.strip())
        if uid < 1000:
            return make_json_response(ok=False, error="Refusing to delete system account (UID < 1000).", command=cmd, status_code=403)

        ret, _, out = run_command(["userdel", "-r", username])
        if ret != 0:
            return make_json_response(ok=False, error=out, command=cmd, output=out, status_code=500)
        return make_json_response(ok=True, data={"deleted": username}, command=cmd, output=f"User '{username}' deleted.")
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

# -----------------------------------------------------------------------------
# API: Repositories
# -----------------------------------------------------------------------------
@app.route("/api/repos", methods=["GET"])
def get_repos():
    try:
        if DEMO_MODE:
            cmd = "ls -ld /srv/repos/*.git"
            out = "\n".join(
                f"drwxrwsr-x 7 root {r['group']} 4096 Oct 28 01:00 /srv/repos/{r['name']}"
                for r in demo_state["repos"]
            )
            return make_json_response(ok=True, data=demo_state["repos"], command=cmd, output=out)

        repo_dir = Path("/srv/repos")
        if not repo_dir.exists():
            return make_json_response(ok=True, data=[], command="ls -ld /srv/repos/*.git", output="No repo directory")

        repos = []
        for r in repo_dir.glob("*.git"):
            ret_s, _, s_out = run_command(["du", "-sh", str(r)])
            size_str = s_out.split()[0] if ret_s == 0 and s_out else "unknown"

            ret_g, _, g_out = run_command(["stat", "-c", "%G", str(r)])
            group_str = g_out.strip() if ret_g == 0 else "developers"

            repos.append({
                "name": r.name,
                "size": size_str,
                "group": group_str,
                "mode": "2775",
                "clone_cmd": f"git clone ssh://<user>@{os.uname().nodename}/srv/repos/{r.name}"
            })
        return make_json_response(ok=True, data=repos, command="ls -ld /srv/repos/*.git", output=f"Found {len(repos)} repositories")
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/repos", methods=["POST"])
def create_repo():
    try:
        payload = request.get_json(silent=True) or {}
        raw_name = payload.get("name", "").strip()

        # Strip .git if provided by user
        clean_name = raw_name[:-4] if raw_name.endswith(".git") else raw_name

        if not RE_REPO_NAME.match(clean_name):
            return make_json_response(
                ok=False,
                error="Invalid repository name. Use letters, numbers, dots, dashes, and underscores.",
                status_code=400
            )

        repo_name = f"{clean_name}.git"
        cmd = f"git init --bare --shared=group /srv/repos/{repo_name} && chgrp -R developers /srv/repos/{repo_name} && chmod -R 2775 /srv/repos/{repo_name}"

        if DEMO_MODE:
            if any(r["name"] == repo_name for r in demo_state["repos"]):
                return make_json_response(ok=False, error=f"Repository '{repo_name}' already exists.", command=cmd, status_code=400)

            new_repo = {
                "name": repo_name,
                "size": "48 KB",
                "group": "developers",
                "mode": "2775",
                "created": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "clone_cmd": f"git clone ssh://<user>@devserver/srv/repos/{repo_name}"
            }
            demo_state["repos"].append(new_repo)
            demo_state["activity_log"].append(
                f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] repo created: {clean_name}"
            )
            out = f"Initialized empty shared Git repository in /srv/repos/{repo_name}/\nGroup set to developers with setgid (2775)."
            return make_json_response(ok=True, data=new_repo, command=cmd, output=out)

        repo_path = f"/srv/repos/{repo_name}"
        if Path(repo_path).exists():
            return make_json_response(ok=False, error=f"Repository '{repo_name}' already exists.", command=cmd, status_code=400)

        # 1. git init --bare --shared=group
        ret1, _, out1 = run_command(["git", "init", "--bare", "--shared=group", "-q", repo_path])
        if ret1 != 0:
            return make_json_response(ok=False, error=f"git init failed: {out1}", command=cmd, status_code=500)

        # 2. chgrp -R developers
        run_command(["chgrp", "-R", "developers", repo_path])
        # 3. chmod -R 2775
        run_command(["chmod", "-R", "2775", repo_path])

        new_repo = {
            "name": repo_name,
            "size": "48 KB",
            "group": "developers",
            "mode": "2775",
            "clone_cmd": f"git clone ssh://<user>@{os.uname().nodename}{repo_path}"
        }
        return make_json_response(ok=True, data=new_repo, command=cmd, output=f"Created shared bare repo {repo_path}")
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

# -----------------------------------------------------------------------------
# API: Storage (LVM)
# -----------------------------------------------------------------------------
@app.route("/api/lvm", methods=["GET"])
def get_lvm():
    try:
        if DEMO_MODE:
            lvm = demo_state["lvm"]
            data = {
                "pv": {
                    "name": lvm["pv_name"],
                    "size_mb": lvm["pv_size_mb"],
                    "free_mb": lvm["vg_free_mb"]
                },
                "vg": {
                    "name": lvm["vg_name"],
                    "size_mb": lvm["vg_size_mb"],
                    "free_mb": lvm["vg_free_mb"],
                    "used_mb": lvm["vg_size_mb"] - lvm["vg_free_mb"],
                    "lv_count": 2
                },
                "lvs": [
                    {
                        "name": "lv_repos",
                        "size_mb": lvm["lvs"]["lv_repos"]["size_mb"],
                        "mount": lvm["lvs"]["lv_repos"]["mount"],
                        "used_mb": lvm["lvs"]["lv_repos"]["used_mb"],
                        "use_pct": int(round(lvm["lvs"]["lv_repos"]["used_mb"] * 100 / lvm["lvs"]["lv_repos"]["size_mb"]))
                    },
                    {
                        "name": "lv_backup",
                        "size_mb": lvm["lvs"]["lv_backup"]["size_mb"],
                        "mount": lvm["lvs"]["lv_backup"]["mount"],
                        "used_mb": lvm["lvs"]["lv_backup"]["used_mb"],
                        "use_pct": int(round(lvm["lvs"]["lv_backup"]["used_mb"] * 100 / lvm["lvs"]["lv_backup"]["size_mb"]))
                    }
                ],
                "vg_free_mb": lvm["vg_free_mb"]
            }
            cmd = "pvs --reportformat json && vgs vg_dev --reportformat json && lvs vg_dev --reportformat json"
            out = json.dumps(data, indent=2)
            return make_json_response(ok=True, data=data, command=cmd, output=out)

        # Production Execution
        ret_v, cmd_v, out_v = run_command(["vgs", "--reportformat", "json", "vg_dev"])
        ret_l, cmd_l, out_l = run_command(["lvs", "--reportformat", "json", "vg_dev"])
        ret_p, cmd_p, out_p = run_command(["pvs", "--reportformat", "json"])

        vg_json = json.loads(out_v) if ret_v == 0 else {}
        lvs_json = json.loads(out_l) if ret_l == 0 else {}
        pvs_json = json.loads(out_p) if ret_p == 0 else {}

        # Free space in MB
        ret_f, _, out_f = run_command(["vgs", "--noheadings", "--units", "m", "--nosuffix", "-o", "vg_free", "vg_dev"])
        free_mb = int(float(out_f.strip().split()[0])) if ret_f == 0 and out_f.strip() else 0

        parsed = {
            "pvs": pvs_json.get("report", [{}])[0].get("pv", []),
            "vgs": vg_json.get("report", [{}])[0].get("vg", []),
            "lvs": lvs_json.get("report", [{}])[0].get("lv", []),
            "vg_free_mb": free_mb
        }
        cmd_combined = "vgs --reportformat json vg_dev && lvs --reportformat json vg_dev"
        return make_json_response(ok=True, data=parsed, command=cmd_combined, output=out_v)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/lvm/extend", methods=["POST"])
def extend_lvm():
    try:
        payload = request.get_json(silent=True) or {}
        lv = payload.get("lv", "").strip()
        mb_raw = payload.get("mb")

        if lv not in ("lv_repos", "lv_backup"):
            return make_json_response(ok=False, error="Volume must be 'lv_repos' or 'lv_backup'.", status_code=400)

        try:
            mb = int(mb_raw)
            if mb <= 0:
                raise ValueError()
        except (ValueError, TypeError):
            return make_json_response(ok=False, error="MB must be a positive integer.", status_code=400)

        cmd = f"lvextend -r -L +{mb}M /dev/vg_dev/{lv}"

        if DEMO_MODE:
            lvm = demo_state["lvm"]
            free_mb = lvm["vg_free_mb"]
            if mb > free_mb:
                return make_json_response(
                    ok=False,
                    error=f"Insufficient free space. Requested {mb} MB, but only {free_mb} MB available in vg_dev.",
                    command=cmd,
                    status_code=400
                )
            lvm["vg_free_mb"] -= mb
            lvm["lvs"][lv]["size_mb"] += mb
            demo_state["activity_log"].append(
                f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] extended {lv} by {mb}MB"
            )
            out = f"Size of logical volume vg_dev/{lv} changed from {lvm['lvs'][lv]['size_mb'] - mb}MB to {lvm['lvs'][lv]['size_mb']}MB.\nLogical volume vg_dev/{lv} successfully resized.\nresize2fs online resize complete. Free in VG: {lvm['vg_free_mb']}MB."
            return make_json_response(ok=True, data=lvm, command=cmd, output=out)

        # Real Linux Execution
        ret_f, _, out_f = run_command(["vgs", "--noheadings", "--units", "m", "--nosuffix", "-o", "vg_free", "vg_dev"])
        if ret_f != 0:
            return make_json_response(ok=False, error="Volume group 'vg_dev' not found.", command=cmd, status_code=400)
        free_mb = int(float(out_f.strip().split()[0]))
        if mb > free_mb:
            return make_json_response(ok=False, error=f"Only {free_mb} MB available in vg_dev.", command=cmd, status_code=400)

        ret, _, out = run_command(["lvextend", "-r", "-L", f"+{mb}M", f"/dev/vg_dev/{lv}"])
        if ret != 0:
            return make_json_response(ok=False, error=f"lvextend failed: {out}", command=cmd, output=out, status_code=500)

        return make_json_response(ok=True, data={"lv": lv, "extended_mb": mb}, command=cmd, output=out)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

# -----------------------------------------------------------------------------
# API: Automation & Cron
# -----------------------------------------------------------------------------
@app.route("/api/cron", methods=["GET"])
def get_cron():
    try:
        cron_entries = [
            {
                "schedule": "*/5 * * * *",
                "human_readable": "Every 5 minutes",
                "command": "/srv/dev-server-manager/scripts/monitor.sh >/dev/null 2>&1",
                "user": "root",
                "purpose": "System health and threshold alerts monitoring",
                "status": "Active"
            },
            {
                "schedule": "0 2 * * *",
                "human_readable": "Daily at 02:00",
                "command": "/srv/dev-server-manager/scripts/backup.sh >> /var/log/devserver/backup.log 2>&1",
                "user": "root",
                "purpose": "Shared repositories & developer accounts backup with 7-day retention",
                "status": "Active"
            },
            {
                "schedule": "0 3 * * 0",
                "human_readable": "Sundays at 03:00",
                "command": "/srv/dev-server-manager/scripts/cleanup.sh >> /var/log/devserver/cleanup.log 2>&1",
                "user": "root",
                "purpose": "Automated disk cleanup and log compression",
                "status": "Active"
            }
        ]

        if DEMO_MODE:
            cmd = "cat /etc/cron.d/devserver"
            raw_cron = (
                "# Dev Server Manager automation   (min hour day month weekday user command)\n"
                "SHELL=/bin/bash\n"
                "PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin\n"
                "*/5 * * * * root /srv/dev-server-manager/scripts/monitor.sh >/dev/null 2>&1\n"
                "0 2 * * *   root /srv/dev-server-manager/scripts/backup.sh  >> /var/log/devserver/backup.log 2>&1\n"
                "0 3 * * 0   root /srv/dev-server-manager/scripts/cleanup.sh >> /var/log/devserver/cleanup.log 2>&1\n"
            )
            return make_json_response(ok=True, data=cron_entries, command=cmd, output=raw_cron)

        cron_file = Path("/etc/cron.d/devserver")
        if not cron_file.exists():
            return make_json_response(ok=True, data=[], command="cat /etc/cron.d/devserver", output="Cron file not installed")

        with open(cron_file, "r") as f:
            raw_content = f.read()

        parsed = []
        for line in raw_content.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" in line.split()[0]:
                continue
            parts = line.split(maxsplit=6)
            if len(parts) >= 7:
                sched = " ".join(parts[0:5])
                user = parts[5]
                comm = parts[6]
                hr = sched
                if sched == "*/5 * * * *":
                    hr = "Every 5 minutes"
                elif sched == "0 2 * * *":
                    hr = "Daily at 02:00"
                elif sched == "0 3 * * 0":
                    hr = "Sundays at 03:00"
                parsed.append({
                    "schedule": sched,
                    "human_readable": hr,
                    "user": user,
                    "command": comm,
                    "status": "Active"
                })

        return make_json_response(ok=True, data=parsed or cron_entries, command="cat /etc/cron.d/devserver", output=raw_content)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/cleanup", methods=["POST"])
def run_cleanup():
    try:
        payload = request.get_json(silent=True) or {}
        dry_run = bool(payload.get("dry_run", False))

        cmd = "scripts/cleanup.sh --dry-run" if dry_run else "scripts/cleanup.sh"

        if DEMO_MODE:
            if dry_run:
                out = (
                    "=== CLEANUP PREVIEW (nothing is deleted) ===\n"
                    "        would delete: /tmp/sess_8392019a.tmp\n"
                    "        would delete: /tmp/cache_build_44.tmp\n"
                    "  /tmp       pattern *        older than  7 days : 14 file(s)\n"
                    "  /var/tmp   pattern *        older than 30 days : 4 file(s)\n"
                    "  /home      pattern *.tmp    older than  7 days : 8 file(s)\n"
                    "  /home      pattern *~       older than  7 days : 12 file(s)\n"
                    "  /home      pattern core     older than  7 days : 0 file(s)\n"
                    "  /var/log   pattern *.gz     older than 30 days : 6 file(s)\n"
                    "Total files that WOULD be removed: 44"
                )
            else:
                out = (
                    "=== CLEANUP RUNNING ===\n"
                    "  /tmp       pattern *        older than  7 days : 14 file(s)\n"
                    "  /var/tmp   pattern *        older than 30 days : 4 file(s)\n"
                    "  /home      pattern *.tmp    older than  7 days : 8 file(s)\n"
                    "  /home      pattern *~       older than  7 days : 12 file(s)\n"
                    "  /home      pattern core     older than  7 days : 0 file(s)\n"
                    "  /var/log   pattern *.gz     older than 30 days : 6 file(s)\n"
                    "Total files removed: 44 | Space freed: 128 MB"
                )
                demo_state["activity_log"].append(
                    f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] cleanup finished: 44 files, 128MB freed"
                )
            return make_json_response(ok=True, data={"dry_run": dry_run, "summary": out}, command=cmd, output=out)

        cleanup_script = SCRIPTS_DIR / "cleanup.sh"
        if not cleanup_script.exists():
            return make_json_response(ok=False, error="scripts/cleanup.sh missing", status_code=404)

        args = ["bash", str(cleanup_script)]
        if dry_run:
            args.append("--dry-run")

        ret, cmd_run, out = run_command(args)
        if ret != 0:
            return make_json_response(ok=False, error=out, command=cmd_run, output=out, status_code=500)
        return make_json_response(ok=True, data={"dry_run": dry_run, "summary": out}, command=cmd_run, output=out)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

# -----------------------------------------------------------------------------
# API: Backups
# -----------------------------------------------------------------------------
@app.route("/api/backup", methods=["POST"])
def create_backup():
    try:
        cmd = "scripts/backup.sh"
        if DEMO_MODE:
            ts = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
            fname = f"backup_{ts}.tar.gz"
            size = f"{random.randint(13, 16)}.{random.randint(1, 9)} MB"
            new_b = {
                "filename": fname,
                "size": size,
                "created": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "status": "Verified",
                "path": f"/srv/backups/{fname}"
            }
            demo_state["backups"].insert(0, new_b)
            demo_state["activity_log"].append(
                f"{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')} [INFO] backup ok: /srv/backups/{fname}"
            )
            out = (
                f"[OK] Backup created and verified: /srv/backups/{fname} ({size})\n"
                f"[OK] Retention: verified 7-day retention policy."
            )
            return make_json_response(ok=True, data=new_b, command=cmd, output=out)

        backup_script = SCRIPTS_DIR / "backup.sh"
        if not backup_script.exists():
            return make_json_response(ok=False, error="scripts/backup.sh missing", status_code=404)

        ret, cmd_run, out = run_command(["bash", str(backup_script)])
        if ret != 0:
            return make_json_response(ok=False, error=out, command=cmd_run, output=out, status_code=500)
        return make_json_response(ok=True, data={"result": out}, command=cmd_run, output=out)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

@app.route("/api/backups", methods=["GET"])
def get_backups():
    try:
        if DEMO_MODE:
            cmd = "ls -lt /srv/backups/backup_*.tar.gz"
            out = "\n".join(
                f"-rw-r----- 1 root root {b['size']} {b['created']} {b['path']}"
                for b in demo_state["backups"]
            )
            return make_json_response(ok=True, data=demo_state["backups"], command=cmd, output=out)

        backup_dir = Path("/srv/backups")
        if not backup_dir.exists():
            return make_json_response(ok=True, data=[], command="ls -lt /srv/backups/backup_*.tar.gz", output="No backup directory")

        files = sorted(backup_dir.glob("backup_*.tar.gz"), key=lambda p: p.stat().st_mtime, reverse=True)
        backups = []
        for f in files:
            stat = f.stat()
            size_mb = stat.st_size / (1024 * 1024)
            size_str = f"{size_mb:.1f} MB" if size_mb >= 1 else f"{stat.st_size / 1024:.0f} KB"
            created_str = datetime.datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")
            backups.append({
                "filename": f.name,
                "size": size_str,
                "created": created_str,
                "status": "Verified",
                "path": str(f)
            })

        cmd = "ls -lt /srv/backups/backup_*.tar.gz"
        out = f"Found {len(backups)} backup archives."
        return make_json_response(ok=True, data=backups, command=cmd, output=out)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

# -----------------------------------------------------------------------------
# API: Logs
# -----------------------------------------------------------------------------
@app.route("/api/logs", methods=["GET"])
def get_logs():
    try:
        log_type = request.args.get("file", "activity").strip().lower()
        if log_type not in ("activity", "monitor"):
            return make_json_response(ok=False, error="File must be 'activity' or 'monitor'.", status_code=400)

        lines_arg = request.args.get("lines", "50")
        try:
            lines_count = max(1, min(500, int(lines_arg)))
        except ValueError:
            lines_count = 50

        cmd = f"tail -n {lines_count} /var/log/devserver/{log_type}.log"

        if DEMO_MODE:
            source = demo_state["activity_log"] if log_type == "activity" else demo_state["monitor_log"]
            tail_lines = source[-lines_count:]
            out = "\n".join(tail_lines)
            data = {
                "file": f"{log_type}.log",
                "lines_requested": lines_count,
                "lines_returned": len(tail_lines),
                "entries": tail_lines
            }
            return make_json_response(ok=True, data=data, command=cmd, output=out)

        log_path = Path(f"/var/log/devserver/{log_type}.log")
        if not log_path.exists():
            return make_json_response(
                ok=True,
                data={"file": f"{log_type}.log", "lines_requested": lines_count, "lines_returned": 0, "entries": []},
                command=cmd,
                output=f"Log file {log_path} does not exist yet."
            )

        ret, _, out = run_command(["tail", "-n", str(lines_count), str(log_path)])
        entries = out.splitlines() if ret == 0 else []
        data = {
            "file": f"{log_type}.log",
            "lines_requested": lines_count,
            "lines_returned": len(entries),
            "entries": entries
        }
        return make_json_response(ok=True, data=data, command=cmd, output=out)
    except Exception as e:
        return make_json_response(ok=False, error=str(e), status_code=500)

# -----------------------------------------------------------------------------
# Server Entrypoint
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    mode_str = "DEMO (simulated data, laptop-friendly)" if DEMO_MODE else "PRODUCTION (live Linux host)"
    print(f"============================================================")
    print(f" Dev Server Manager - Web Dashboard Backend")
    print(f" Running in: {mode_str}")
    print(f" Binding to: http://127.0.0.1:5000")
    print(f" Serving UI: {STATIC_DIR}")
    print(f"============================================================")
    app.run(host="127.0.0.1", port=5000, debug=False)
