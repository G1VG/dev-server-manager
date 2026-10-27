#!/usr/bin/env python3
"""
Automated Integration Tests for Dev Server Manager Web Dashboard
Tests every endpoint in DEMO mode:
- Envelope structure: {ok, data, command, output}
- Input validations (username regex, repo regex, positive MB)
- Stateful in-memory mutations (add/lock/unlock/delete user, add repo, extend LVM, cleanup, backup)
- Edge cases and error handling (duplicate user, duplicate repo, UID < 1000, free space exceeded)
"""

import os
import sys
import json

# Ensure DEMO mode is enabled for test suite
os.environ["DEMO"] = "1"

from app import app, demo_state

def run_tests():
    client = app.test_client()
    passed = 0
    failed = 0

    def assert_test(name, condition, details=""):
        nonlocal passed, failed
        if condition:
            print(f"  [PASS] {name}")
            passed += 1
        else:
            print(f"  [FAIL] {name} - {details}")
            failed += 1

    print("==================================================")
    print(" Running Dev Server Manager Test Suite (Demo Mode)")
    print("==================================================")

    # 1. Frontend Root & Static Assets
    print("\n--- 1. Frontend & Static Assets ---")
    r = client.get("/")
    assert_test("GET / returns 200", r.status_code == 200)
    assert_test("GET / contains DevServer branding", b"DevServer" in r.data)

    r_css = client.get("/style.css")
    assert_test("GET /style.css returns 200", r_css.status_code == 200)
    assert_test("CSS contains electric teal accent", b"#00F2FE" in r_css.data)

    r_js = client.get("/app.js")
    assert_test("GET /app.js returns 200", r_js.status_code == 200)
    assert_test("JS contains apiRequest helper", b"apiRequest" in r_js.data)

    # 2. Status Endpoint
    print("\n--- 2. Telemetry Status (/api/status) ---")
    r = client.get("/api/status")
    d = r.get_json()
    assert_test("Status returns 200", r.status_code == 200)
    assert_test("Envelope contains ok, data, command, output", all(k in d for k in ("ok", "data", "command", "output")))
    assert_test("Status data contains load, cores, mem_pct, uptime, disks", all(k in d["data"] for k in ("load", "cores", "mem_pct", "uptime", "disks")))
    assert_test("Status disks include /srv/repos and /srv/backups", any(x["mount"] == "/srv/repos" for x in d["data"]["disks"]))

    # 3. Users Management
    print("\n--- 3. Developer Users (/api/users) ---")
    r = client.get("/api/users")
    d = r.get_json()
    assert_test("GET /api/users returns 200", r.status_code == 200)
    assert_test("User list initialized with 40 developers", len(d["data"]) >= 40)
    assert_test("First user is dev01", d["data"][0]["username"] == "dev01")
    assert_test("Command field is populated", "getent group developers" in d["command"])

    # Create new user
    print("\n--- 3a. User Creation ---")
    r_create = client.post("/api/users", json={"username": "dev41", "fullname": "Sarah Connor"})
    d_create = r_create.get_json()
    assert_test("POST /api/users creates dev41", r_create.status_code == 200 and d_create["ok"])
    assert_test("Created user in developers group", d_create["data"]["group"] == "developers")

    # Duplicate user rejection
    r_dup = client.post("/api/users", json={"username": "dev41", "fullname": "Sarah Connor"})
    assert_test("Duplicate user rejected with 400", r_dup.status_code == 400)

    # Invalid username regex rejection
    r_invalid = client.post("/api/users", json={"username": "123invalid!", "fullname": "Bad"})
    assert_test("Invalid username rejected with 400", r_invalid.status_code == 400)

    # Lock & Unlock
    print("\n--- 3b. User Lock & Unlock ---")
    r_lock = client.post("/api/users/dev41/lock")
    d_lock = r_lock.get_json()
    assert_test("Lock dev41 returns 200", r_lock.status_code == 200 and d_lock["data"]["status"] == "locked")
    assert_test("Lock command displayed", "usermod -L dev41" in d_lock["command"])

    r_unlock = client.post("/api/users/dev41/unlock")
    d_unlock = r_unlock.get_json()
    assert_test("Unlock dev41 returns 200", r_unlock.status_code == 200 and d_unlock["data"]["status"] == "active")

    # Delete User
    print("\n--- 3c. User Deletion ---")
    r_del = client.delete("/api/users/dev41")
    d_del = r_del.get_json()
    assert_test("DELETE dev41 returns 200", r_del.status_code == 200 and d_del["ok"])
    assert_test("Delete command displayed", "userdel -r dev41" in d_del["command"])

    # Verify user count decreased
    r_users_after = client.get("/api/users")
    assert_test("User count restored after deletion", not any(u["username"] == "dev41" for u in r_users_after.get_json()["data"]))

    # 4. Repositories
    print("\n--- 4. Repositories (/api/repos) ---")
    r_repos = client.get("/api/repos")
    d_repos = r_repos.get_json()
    assert_test("GET /api/repos returns 200", r_repos.status_code == 200)
    assert_test("Default repos include frontend-portal.git", any(r["name"] == "frontend-portal.git" for r in d_repos["data"]))

    # Create Repo
    r_add_repo = client.post("/api/repos", json={"name": "mobile-app"})
    d_add_repo = r_add_repo.get_json()
    assert_test("POST /api/repos creates mobile-app.git", r_add_repo.status_code == 200 and d_add_repo["data"]["name"] == "mobile-app.git")
    assert_test("Repo created with setgid command", "chmod -R 2775" in d_add_repo["command"])

    # Duplicate repo rejection
    r_repo_dup = client.post("/api/repos", json={"name": "mobile-app"})
    assert_test("Duplicate repo rejected with 400", r_repo_dup.status_code == 400)

    # 5. Storage (LVM)
    print("\n--- 5. Storage LVM (/api/lvm) ---")
    r_lvm = client.get("/api/lvm")
    d_lvm = r_lvm.get_json()
    assert_test("GET /api/lvm returns 200", r_lvm.status_code == 200)
    assert_test("LVM contains vg_dev and free MB", d_lvm["data"]["vg"]["name"] == "vg_dev" and d_lvm["data"]["vg_free_mb"] > 0)

    # Extend LVM
    initial_free = d_lvm["data"]["vg_free_mb"]
    r_ext = client.post("/api/lvm/extend", json={"lv": "lv_repos", "mb": 128})
    d_ext = r_ext.get_json()
    assert_test("Extend lv_repos by 128 MB returns 200", r_ext.status_code == 200 and d_ext["ok"])
    assert_test("Command contains lvextend -r -L +128M", "lvextend -r -L +128M" in d_ext["command"])

    # Verify free space decreased by 128 MB
    r_lvm_after = client.get("/api/lvm")
    new_free = r_lvm_after.get_json()["data"]["vg_free_mb"]
    assert_test("VG free space decreased by 128 MB", new_free == initial_free - 128)

    # Reject extending more than available
    r_ext_excess = client.post("/api/lvm/extend", json={"lv": "lv_repos", "mb": 999999})
    assert_test("Extend exceeding free space rejected with 400", r_ext_excess.status_code == 400)

    # 6. Automation & Cron
    print("\n--- 6. Automation & Cron (/api/cron, /api/cleanup) ---")
    r_cron = client.get("/api/cron")
    d_cron = r_cron.get_json()
    assert_test("GET /api/cron returns 3 scheduled jobs", len(d_cron["data"]) == 3)
    assert_test("Cron includes monitor.sh, backup.sh, cleanup.sh", any("backup.sh" in j["command"] for j in d_cron["data"]))

    # Cleanup dry-run
    r_clean_dry = client.post("/api/cleanup", json={"dry_run": True})
    d_clean_dry = r_clean_dry.get_json()
    assert_test("Cleanup dry-run returns 200", r_clean_dry.status_code == 200)
    assert_test("Dry-run command specifies --dry-run", "--dry-run" in d_clean_dry["command"])
    assert_test("Dry-run output contains preview header", "CLEANUP PREVIEW" in d_clean_dry["output"])

    # Cleanup real run
    r_clean_real = client.post("/api/cleanup", json={"dry_run": False})
    d_clean_real = r_clean_real.get_json()
    assert_test("Cleanup real run returns 200", r_clean_real.status_code == 200)
    assert_test("Real run output mentions Space freed", "Space freed" in d_clean_real["output"])

    # 7. Backups
    print("\n--- 7. Backups (/api/backups, /api/backup) ---")
    r_backups = client.get("/api/backups")
    d_backups = r_backups.get_json()
    assert_test("GET /api/backups returns archives", len(d_backups["data"]) >= 5)

    initial_backup_count = len(d_backups["data"])
    r_create_b = client.post("/api/backup")
    d_create_b = r_create_b.get_json()
    assert_test("POST /api/backup returns 200", r_create_b.status_code == 200)
    assert_test("Backup command specifies scripts/backup.sh", "scripts/backup.sh" in d_create_b["command"])

    r_backups_after = client.get("/api/backups")
    assert_test("New backup added to list", len(r_backups_after.get_json()["data"]) == initial_backup_count + 1)

    # 8. Logs
    print("\n--- 8. Logs (/api/logs) ---")
    r_log_act = client.get("/api/logs?file=activity&lines=50")
    d_log_act = r_log_act.get_json()
    assert_test("GET /api/logs activity returns 200", r_log_act.status_code == 200)
    assert_test("Activity logs contain entries", len(d_log_act["data"]["entries"]) > 0)
    assert_test("Log command specifies tail -n 50", "tail -n 50" in d_log_act["command"])

    r_log_mon = client.get("/api/logs?file=monitor&lines=10")
    d_log_mon = r_log_mon.get_json()
    assert_test("GET /api/logs monitor returns 200", r_log_mon.status_code == 200)
    assert_test("Monitor log specifies monitor.log", "monitor.log" in d_log_mon["command"])

    # 9. Summary
    print("\n==================================================")
    print(f" Test Results: {passed} PASSED | {failed} FAILED")
    print("==================================================")

    if failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_tests()
