#!/usr/bin/env python3
"""Consent-gated local bridge daemon for HuggingClaw/OpenClaw.

Designed for cloud-orchestrated + local-execution flows with persistent consent.
"""
from __future__ import annotations

import json
import os
import secrets
import subprocess
import time
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request

APP = Flask(__name__)

MODE = os.getenv("HC_LOCAL_BRIDGE_MODE", "disabled").strip().lower()
WORKDIR = Path(os.getenv("HC_LOCAL_BRIDGE_HOME", str(Path.home() / ".huggingclaw" / "local-bridge")))
STATE_FILE = WORKDIR / "state.json"
POLICY_FILE = WORKDIR / "policy.json"

DEFAULT_POLICY = {
    "allow_shell": True,
    "allow_read": True,
    "allow_write": False,
    "allow_delete": False,
    "allowlist_cmd_prefixes": ["pwd", "ls", "echo", "cat", "python3 --version"],
    "allowed_paths": ["~/.huggingclaw", "~/Downloads", "~/Documents"],
    "deny_paths": ["~/.ssh", "~/.gnupg", "~/.aws", "~/.config/Google", "~/.config/chromium"],
    "max_output_chars": 12000,
    "max_write_bytes": 200000,
}

MODE_POLICY_PATCHES = {
    "disabled": {
        "allow_shell": False,
        "allow_read": False,
        "allow_write": False,
        "allow_delete": False,
    },
    "paired": {
        "allow_shell": True,
        "allow_read": True,
        "allow_write": False,
        "allow_delete": False,
    },
    "trusted": {
        "allow_shell": True,
        "allow_read": True,
        "allow_write": True,
        "allow_delete": True,
    },
}


def _effective_policy() -> dict[str, Any]:
    policy = _read_json(POLICY_FILE)
    patch = MODE_POLICY_PATCHES.get(MODE, {})
    for key, value in patch.items():
        policy[key] = value
    return policy


def _ensure_state() -> None:
    WORKDIR.mkdir(parents=True, exist_ok=True)
    if not POLICY_FILE.exists():
        POLICY_FILE.write_text(json.dumps(DEFAULT_POLICY, indent=2), encoding="utf-8")
    if not STATE_FILE.exists():
        state = {
            "created_at": int(time.time()),
            "trusted_tokens": [],
            "provisioning_token": os.getenv("HC_LOCAL_BRIDGE_PROVISIONING_TOKEN", ""),
            "last_rotation_at": None,
        }
        _save_json(STATE_FILE, state)


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _resolve(path: str) -> Path:
    return Path(path).expanduser().resolve()


def _path_allowed(path: str, policy: dict[str, Any]) -> tuple[bool, str]:
    resolved = _resolve(path)
    deny = [_resolve(p) for p in policy.get("deny_paths", [])]
    allow = [_resolve(p) for p in policy.get("allowed_paths", [])]

    for blocked in deny:
        if str(resolved).startswith(str(blocked)):
            return False, "path denied"

    if allow and not any(str(resolved).startswith(str(a)) for a in allow):
        return False, "path outside allowed_paths"

    return True, "ok"


def _trusted_auth() -> bool:
    if MODE == "disabled":
        return False
    state = _read_json(STATE_FILE)
    token = request.headers.get("x-hc-bridge-token", "")
    return token and token in state.get("trusted_tokens", [])


def _provision_auth() -> bool:
    state = _read_json(STATE_FILE)
    supplied = request.headers.get("x-hc-provisioning-token", "")
    expected = state.get("provisioning_token") or os.getenv("HC_LOCAL_BRIDGE_PROVISIONING_TOKEN", "")
    return bool(expected) and supplied == expected


@APP.get("/health")
def health() -> Any:
    return jsonify({"ok": True, "mode": MODE})


@APP.get("/consent/status")
def consent_status() -> Any:
    state = _read_json(STATE_FILE)
    return jsonify(
        {
            "mode": MODE,
            "trusted_tokens_count": len(state.get("trusted_tokens", [])),
            "provisioning_configured": bool(state.get("provisioning_token") or os.getenv("HC_LOCAL_BRIDGE_PROVISIONING_TOKEN", "")),
        }
    )


@APP.post("/consent/grant")
def consent_grant() -> Any:
    if MODE == "disabled":
        return jsonify({"error": "bridge disabled"}), 403
    if not _provision_auth():
        return jsonify({"error": "invalid provisioning token"}), 401

    body = request.get_json(silent=True) or {}
    label = str(body.get("label", "cloud-control"))
    token = secrets.token_urlsafe(32)
    state = _read_json(STATE_FILE)
    state.setdefault("trusted_tokens", []).append(token)
    state["last_rotation_at"] = int(time.time())
    _save_json(STATE_FILE, state)
    return jsonify({"token": token, "label": label, "mode": MODE})


@APP.post("/consent/revoke_all")
def consent_revoke_all() -> Any:
    if not _provision_auth():
        return jsonify({"error": "invalid provisioning token"}), 401
    state = _read_json(STATE_FILE)
    state["trusted_tokens"] = []
    _save_json(STATE_FILE, state)
    return jsonify({"ok": True})


@APP.post("/execute")
def execute() -> Any:
    if not _trusted_auth():
        return jsonify({"error": "unauthorized"}), 401

    payload = request.get_json(silent=True) or {}
    action = payload.get("action")
    policy = _effective_policy()

    if action == "shell.run":
        if not policy.get("allow_shell", False):
            return jsonify({"error": "shell disabled by policy"}), 403
        cmd = str(payload.get("cmd", "")).strip()
        if not cmd:
            return jsonify({"error": "cmd required"}), 400
        allowlist = policy.get("allowlist_cmd_prefixes", [])
        if allowlist and not any(cmd.startswith(prefix) for prefix in allowlist):
            return jsonify({"error": "command blocked by allowlist"}), 403
        proc = subprocess.run(cmd, shell=True, text=True, capture_output=True, timeout=30)
        max_chars = int(policy.get("max_output_chars", 12000))
        return jsonify({"exit_code": proc.returncode, "stdout": proc.stdout[:max_chars], "stderr": proc.stderr[:max_chars]})

    if action == "file.read":
        if not policy.get("allow_read", False):
            return jsonify({"error": "file read disabled"}), 403
        path = str(payload.get("path", "")).strip()
        ok, reason = _path_allowed(path, policy)
        if not ok:
            return jsonify({"error": reason}), 403
        data = _resolve(path).read_text(encoding="utf-8")
        return jsonify({"content": data[: int(policy.get("max_output_chars", 12000))]})

    if action == "file.write":
        if not policy.get("allow_write", False):
            return jsonify({"error": "file write disabled"}), 403
        path = str(payload.get("path", "")).strip()
        content = str(payload.get("content", ""))
        ok, reason = _path_allowed(path, policy)
        if not ok:
            return jsonify({"error": reason}), 403
        max_write = int(policy.get("max_write_bytes", 200000))
        encoded = content.encode("utf-8")
        if len(encoded) > max_write:
            return jsonify({"error": "content too large"}), 400
        target = _resolve(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return jsonify({"ok": True, "bytes": len(encoded)})

    if action == "file.delete":
        if not policy.get("allow_delete", False):
            return jsonify({"error": "file delete disabled"}), 403
        path = str(payload.get("path", "")).strip()
        ok, reason = _path_allowed(path, policy)
        if not ok:
            return jsonify({"error": reason}), 403
        target = _resolve(path)
        if target.exists() and target.is_file():
            target.unlink()
            return jsonify({"ok": True, "deleted": True})
        return jsonify({"ok": True, "deleted": False})

    return jsonify({"error": "unsupported action"}), 400


def main() -> None:
    _ensure_state()
    host = os.getenv("HC_LOCAL_BRIDGE_HOST", "127.0.0.1")
    port = int(os.getenv("HC_LOCAL_BRIDGE_PORT", "4317"))
    APP.run(host=host, port=port)


if __name__ == "__main__":
    main()
