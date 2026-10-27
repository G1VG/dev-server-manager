#!/usr/bin/env python3
"""Read-only production-path endpoint tests using mocked Linux command output."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import app as backend
from app import app


def run_tests():
    client = app.test_client()
    failures = []
    passed = 0

    def check(name, condition):
        nonlocal passed
        if condition:
            print(f"[PASS] {name}")
            passed += 1
        else:
            print(f"[FAIL] {name}")
            failures.append(name)

    with patch.object(backend, "DEMO_MODE", False):
        with patch.object(backend, "run_command") as run:
            def users_command(args, **_kwargs):
                if args[:2] == ["getent", "group"]:
                    return 0, "getent group developers", "developers:x:1001:alice,bob"
                if args[:2] == ["getent", "passwd"]:
                    return 0, "getent passwd", (
                        "alice:x:1001:1001:Alice Example:/home/alice:/bin/bash\n"
                        "bob:x:1002:1001:Bob Example:/home/bob:/bin/bash"
                    )
                if args[0] == "lastlog":
                    return 0, "lastlog", (
                        "Username         Port     From                                       Latest\n"
                        "alice            pts/0    192.0.2.1                                  Tue Oct 28 02:30:12 +0530 2026\n"
                        "bob                                                                **Never logged in**"
                    )
                raise AssertionError(f"Unexpected command: {args}")

            run.side_effect = users_command
            response = client.get("/api/users")
            users = response.get_json()["data"]
            check("Production users parse group members and login dates", response.status_code == 200 and len(users) == 2 and users[0]["fullname"] == "Alice Example" and "Tue Oct 28" in users[0]["last_login"])

        with tempfile.TemporaryDirectory() as temp_dir:
            repo_dir = Path(temp_dir) / "repos"
            (repo_dir / "service.git").mkdir(parents=True)
            with patch.object(backend, "REPO_DIR", repo_dir), patch.object(
                backend,
                "run_command",
                side_effect=[
                    (0, "du -sh", "128K\tservice.git"),
                    (0, "stat", "developers 2775")
                ]
            ):
                response = client.get("/api/repos")
            repo = response.get_json()["data"][0]
            check("Production repositories report actual group and permissions", response.status_code == 200 and repo["group"] == "developers" and repo["mode"] == "2775")

        vg_json = json.dumps({"report": [{"vg": [{
            "vg_name": " vg_dev ",
            "vg_size": "3221225472",
            "vg_free": "644245094"
        }]}]})
        lv_json = json.dumps({"report": [{"lv": [
            {"lv_name": "lv_repos", "lv_size": "1610612736", "lv_path": "/dev/vg_dev/lv_repos"},
            {"lv_name": "lv_backup", "lv_size": "966787072", "lv_path": "/dev/vg_dev/lv_backup"}
        ]}]})
        pv_json = json.dumps({"report": [{"pv": [{
            "pv_name": "/dev/sdb1",
            "pv_size": "3221225472",
            "pv_free": "644245094"
        }]}]})

        with patch.object(backend, "run_command", side_effect=[
            (0, "vgs", vg_json),
            (0, "lvs", lv_json),
            (0, "pvs", pv_json)
        ]):
            response = client.get("/api/lvm")
        lvm = response.get_json()["data"]
        check("Production LVM JSON maps to dashboard schema", response.status_code == 200 and lvm["configured"] and lvm["vg"]["name"] == "vg_dev" and lvm["vg_free_mb"] == 614 and len(lvm["lvs"]) == 2)

        with patch.object(backend, "run_command", return_value=(5, "vgs", 'Volume group "vg_dev" not found')):
            response = client.get("/api/lvm")
        empty_lvm = response.get_json()["data"]
        check("Unconfigured LVM returns a helpful empty state", response.status_code == 200 and not empty_lvm["configured"] and "not configured" in empty_lvm["message"])

        with tempfile.TemporaryDirectory() as temp_dir:
            cron_file = Path(temp_dir) / "devserver"
            with patch.object(backend, "CRON_FILE", cron_file):
                response = client.get("/api/cron")
                check("Missing cron configuration returns an empty state", response.status_code == 200 and response.get_json()["data"] == [])

                cron_file.write_text(
                    "# scheduled jobs\n"
                    "SHELL=/bin/bash\n"
                    "*/5 * * * * root /opt/dev-server-manager/scripts/monitor.sh >/dev/null 2>&1\n",
                    encoding="utf-8"
                )
                response = client.get("/api/cron")
            jobs = response.get_json()["data"]
            check("Cron parser reads the configured file without phantom jobs", response.status_code == 200 and len(jobs) == 1 and jobs[0]["user"] == "root" and jobs[0]["purpose"].startswith("System health"))

            backup_dir = Path(temp_dir) / "backups"
            backup_dir.mkdir()
            (backup_dir / "backup_test.tar.gz").write_bytes(b"archive")
            with patch.object(backend, "BACKUP_DIR", backup_dir):
                response = client.get("/api/backups")
            check("Production backup listing reads actual archive metadata", response.status_code == 200 and response.get_json()["data"][0]["filename"] == "backup_test.tar.gz")

            log_dir = Path(temp_dir) / "logs"
            log_dir.mkdir()
            (log_dir / "activity.log").write_text("entry\n", encoding="utf-8")
            with patch.object(backend, "LOG_DIR", log_dir), patch.object(
                backend, "run_command", return_value=(0, "tail", "entry")
            ):
                response = client.get("/api/logs?file=activity&lines=10")
            check("Production logs return the requested tail", response.status_code == 200 and response.get_json()["data"]["entries"] == ["entry"])

        with patch.object(backend, "run_command", return_value=(1, "tail", "Permission denied")):
            with tempfile.TemporaryDirectory() as temp_dir:
                log_dir = Path(temp_dir)
                (log_dir / "activity.log").touch()
                with patch.object(backend, "LOG_DIR", log_dir):
                    response = client.get("/api/logs?file=activity")
            check("Log permission failures are explicit, not empty success", response.status_code == 500 and not response.get_json()["ok"] and "Permission denied" in response.get_json()["error"])

        with patch.object(
            backend, "run_command", return_value=(0, "bash scripts/cleanup.sh --dry-run", "=== CLEANUP PREVIEW ===")
        ):
            response = client.post("/api/cleanup", json={"dry_run": True})
        check("Production cleanup dry-run dispatches the unchanged script", response.status_code == 200 and response.get_json()["data"]["dry_run"] is True)

        with patch.object(backend, "run_command", return_value=(0, "bash scripts/backup.sh", "[OK] Backup created")):
            response = client.post("/api/backup")
        check("Production backup endpoint dispatches the unchanged script", response.status_code == 200 and response.get_json()["ok"])

    print(f"\n{passed} passed, {len(failures)} failed")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    run_tests()
