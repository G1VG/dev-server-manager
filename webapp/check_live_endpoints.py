#!/usr/bin/env python3
"""Safely check live dashboard endpoints from the Ubuntu host."""

import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = "http://127.0.0.1:5000"
READ_TIMEOUT_SECONDS = 15


def request_json(path, method="GET", body=None):
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    request = Request(
        f"{BASE_URL}{path}",
        data=payload,
        method=method,
        headers={"Content-Type": "application/json"} if payload is not None else {},
    )
    try:
        with urlopen(request, timeout=READ_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
            return response.status, result
    except HTTPError as error:
        try:
            result = json.loads(error.read().decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            result = {}
        return error.code, result


def require_endpoint(path, method="GET", body=None):
    status, result = request_json(path, method, body)
    if status != 200:
        raise RuntimeError(f"{method} {path}: HTTP {status}: {result.get('error', 'request failed')}")
    if result.get("ok") is not True:
        raise RuntimeError(f"{method} {path}: {result.get('error', 'API returned ok=false')}")
    if "data" not in result or "command" not in result or "output" not in result:
        raise RuntimeError(f"{method} {path}: response is missing standard API envelope fields")
    return result["data"], result


def main():
    checks = [
        ("/api/status", lambda data: isinstance(data, dict) and "disks" in data, "status data"),
        ("/api/users", lambda data: isinstance(data, list), "developer list"),
        ("/api/repos", lambda data: isinstance(data, list), "repository list"),
        (
            "/api/lvm",
            lambda data: isinstance(data, dict) and (
                data.get("configured") is False
                or all(key in data for key in ("pv", "vg", "lvs", "vg_free_mb"))
            ),
            "LVM data or unconfigured-state message",
        ),
        ("/api/cron", lambda data: isinstance(data, list), "configured cron jobs (empty is OK)"),
        ("/api/backups", lambda data: isinstance(data, list), "backup list"),
        (
            "/api/logs?file=activity&lines=10",
            lambda data: isinstance(data, dict) and isinstance(data.get("entries"), list),
            "activity log",
        ),
        (
            "/api/logs?file=monitor&lines=10",
            lambda data: isinstance(data, dict) and isinstance(data.get("entries"), list),
            "monitor log",
        ),
    ]

    failures = 0
    for path, validate, description in checks:
        try:
            data, _ = require_endpoint(path)
            if not validate(data):
                raise RuntimeError(f"GET {path}: unexpected response data shape")
            print(f"[PASS] GET {path} - {description}")
        except (RuntimeError, URLError, TimeoutError, json.JSONDecodeError) as error:
            failures += 1
            print(f"[FAIL] GET {path} - {error}")

    try:
        data, response = require_endpoint("/api/cleanup", "POST", {"dry_run": True})
        if not isinstance(data, dict) or data.get("dry_run") is not True:
            raise RuntimeError("POST /api/cleanup: server did not confirm dry-run mode")
        if "PREVIEW" not in response["output"].upper():
            raise RuntimeError("POST /api/cleanup: preview confirmation was not present")
        print("[PASS] POST /api/cleanup - dry-run preview only; no files should be deleted")
    except (RuntimeError, URLError, TimeoutError, json.JSONDecodeError) as error:
        failures += 1
        print(f"[FAIL] POST /api/cleanup - {error}")

    passed = len(checks) + 1 - failures
    print(f"\n{passed}/{len(checks) + 1} live checks passed.")
    if failures:
        return 1
    print("No users, repositories, backups, or volumes were changed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (URLError, TimeoutError) as error:
        print(f"Cannot connect to {BASE_URL}: {error}", file=sys.stderr)
        print("Start the dashboard on the Ubuntu VM, then run this check there.", file=sys.stderr)
        sys.exit(1)
