#!/usr/bin/env python3
"""
HuggingClaw workspace/state backup via huggingface_hub.

This keeps OpenClaw workspace data, app state, and optional WhatsApp
credentials inside a private HF dataset without embedding HF tokens in git
remotes or requiring a manual HF_USERNAME secret.
"""

import fcntl
import hashlib
import json
import logging
import os
import shutil
import signal
import sys
import tempfile
import threading
import time
from typing import TypeAlias
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
# huggingface_hub reads HF_HUB_VERBOSITY at import time and overrides any
# logging.getLogger().setLevel() we apply afterwards. Set it before import
# to silence the "No files have been modified..." spam from
# upload_large_folder workers (logger.warning level).
os.environ.setdefault("HF_HUB_VERBOSITY", "error")

from huggingface_hub import CommitOperationDelete, HfApi, snapshot_download, upload_folder
from huggingface_hub.errors import HfHubHTTPError, RepositoryNotFoundError

# huggingface_hub.upload_folder always appends DEFAULT_IGNORE_PATTERNS which
# hard-blocks every .git/ subtree regardless of ignore_patterns= argument.
# Work around this by escaping .git → __dot_git__ in the local snapshot before
# upload, then unescaping after snapshot_download on restore.
_GIT_ESCAPE = "__dot_git__"


def _escape_git_dirs(root: Path) -> None:
    """Rename every .git dir inside *root* to __dot_git__ so upload_folder uploads them."""
    for dirpath, dirnames, _ in os.walk(root, topdown=False):
        for dirname in list(dirnames):
            if dirname == ".git":
                src = Path(dirpath) / ".git"
                dst = Path(dirpath) / _GIT_ESCAPE
                if src.exists() and not dst.exists():
                    src.rename(dst)


def _unescape_git_dirs(root: Path) -> None:
    """Rename every __dot_git__ dir inside *root* back to .git after snapshot_download."""
    for dirpath, dirnames, _ in os.walk(root, topdown=False):
        for dirname in list(dirnames):
            if dirname == _GIT_ESCAPE:
                src = Path(dirpath) / _GIT_ESCAPE
                dst = Path(dirpath) / ".git"
                if src.exists() and not dst.exists():
                    src.rename(dst)

# Belt-and-suspenders: also raise the level after import in case the env var
# wasn't honored (older hub versions, or message logged via a sub-logger).
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)

OPENCLAW_HOME = Path("/home/node/.openclaw")
OPENCLAW_CONFIG_FILE = OPENCLAW_HOME / "openclaw.json"
WORKSPACE = OPENCLAW_HOME / "workspace"
STATUS_FILE = Path("/tmp/sync-status.json")
SYNC_LOCK_FILE = Path("/tmp/huggingclaw-sync.lock")
INTERVAL = int(os.environ.get("SYNC_INTERVAL", "180"))
INITIAL_DELAY = int(os.environ.get("SYNC_START_DELAY", "10"))
CONFIG_WATCH_INTERVAL = max(
    0.5,
    float(os.environ.get("OPENCLAW_CONFIG_WATCH_INTERVAL", "1")),
)
CONFIG_SETTLE_SECONDS = max(
    0.0,
    float(os.environ.get("OPENCLAW_CONFIG_SETTLE_SECONDS", "3")),
)
SESSIONS_MIN_SYNC_GAP = int(os.environ.get("SESSIONS_MIN_SYNC_GAP", "30"))
SYNC_LOCK_TIMEOUT = max(1.0, float(os.environ.get("SYNC_LOCK_TIMEOUT", "20")))
SYNC_UPLOAD_TIMEOUT = max(0.0, float(os.environ.get("SYNC_UPLOAD_TIMEOUT", "180")))
SYNC_UPLOAD_STRATEGY = os.environ.get("SYNC_UPLOAD_STRATEGY", "folder").strip().lower() or "folder"
HF_TOKEN = os.environ.get("HF_TOKEN", "").strip()
HF_USERNAME = os.environ.get("HF_USERNAME", "").strip()
SPACE_AUTHOR_NAME = os.environ.get("SPACE_AUTHOR_NAME", "").strip()
BACKUP_DATASET_NAME = os.environ.get("BACKUP_DATASET_NAME", "").strip() or os.environ.get("BACKUP_DATASET", "").strip() or "huggingclaw-backup"
def is_true(value):
    return str(value).strip().lower() in {"1", "true", "yes", "on"}

WHATSAPP_ENABLED = is_true(os.environ.get("WHATSAPP_ENABLED", ""))

EXCLUDED_SYNC_DIRS = {
    "node_modules", "__pycache__", ".venv", "venv",
    ".npm", ".cache", ".yarn", "dist", "build", ".next", ".nuxt",
    ".turbo", ".parcel-cache", "target", ".gradle", ".mvn",
}
MAX_FILE_SIZE_BYTES = int(os.environ.get("SYNC_MAX_FILE_BYTES", str(50 * 1024 * 1024)))
# Max stale files to delete per commit. Large single-commit deletions can
# exceed the HF API payload limit and fail silently (caught as a warning).
# 50 is conservative; each extra commit is cheap for delete-only operations.
PRUNE_BATCH_SIZE = int(os.environ.get("SYNC_PRUNE_BATCH_SIZE", "50"))

STATE_DIR = WORKSPACE / "huggingclaw-state"
OPENCLAW_STATE_BACKUP_DIR = STATE_DIR / "openclaw"
EXCLUDED_STATE_NAMES = {
    "workspace",
    "openclaw-app",
    "gateway.log",
    "browser",
    "npm",
    # Never back up or restore plugin extension dirs.  Plugin binaries are
    # environment-specific and can become stale/broken across restarts.
    # start.sh always does a fresh `openclaw plugins install` when
    # WHATSAPP_ENABLED=true, so the extensions dir is regenerated each boot.
    # Restoring a stale copy prevents that reinstall (whatsapp_plugin_runtime_ok
    # sees the old dist files and returns early), which is the root cause of
    # "WhatsApp enabled but not installing on restart".
    "extensions",
}
# Internal restore/snapshot working directories live beside the workspace under
# /home/node/.openclaw.  If a previous container is killed mid-restore, these
# hidden directories can be left behind and may contain a full copy of the
# workspace, including huggingclaw-state/openclaw itself.  Backing them up makes
# the dataset grow recursively under huggingclaw-state/openclaw and can keep the
# sync loop busy forever, which in turn blocks session deletes/updates from being
# pruned remotely.  Treat every such helper path as disposable sync scratch.
INTERNAL_TEMP_STATE_NAMES = {
    ".workspace-restore-staging",
    ".workspace-restore-old",
    ".openclaw-staging",
}
INTERNAL_TEMP_NAME_PREFIXES = (
    ".workspace-restore-",
    ".openclaw-staging",
)
SESSIONS_ROOT = OPENCLAW_HOME / "agents"
WHATSAPP_CREDS_DIR = OPENCLAW_HOME / "credentials" / "whatsapp" / "default"
WHATSAPP_BACKUP_DIR = STATE_DIR / "credentials" / "whatsapp" / "default"
RESET_MARKER = WORKSPACE / ".reset_credentials"
HF_API = HfApi(token=HF_TOKEN) if HF_TOKEN else None
STOP_EVENT = threading.Event()
_REPO_ID_CACHE: str | None = None
WorkspaceMarker: TypeAlias = tuple[int, int, int, str]
FileMarker: TypeAlias = tuple[int, int, int, int, str]
# Set True when prune fails so the next sync pass bypasses the fingerprint
# early-exit and retries the prune even if no local files changed.
_prune_needed: bool = False
_remote_temp_prune_done: bool = False

# Workspace-relative temp paths managed by this sync script.  Keep this narrow:
# user projects may legitimately contain folders with similar names, and those
# must keep syncing normally.  Only the script-owned state/restore scratch
# locations are skipped and pruned.
INTERNAL_TEMP_WORKSPACE_PREFIXES: tuple[tuple[str, ...], ...] = (
    (".workspace-restore-staging",),
    (".workspace-restore-old",),
    ("huggingclaw-state", ".openclaw-staging"),
    ("huggingclaw-state", "openclaw", ".workspace-restore-staging"),
    ("huggingclaw-state", "openclaw", ".workspace-restore-old"),
    ("huggingclaw-state", "openclaw", ".openclaw-staging"),
)


class SyncUploadTimeoutError(TimeoutError):
    pass


def write_status(status: str, message: str) -> None:
    payload = {
        "status": status,
        "message": message,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tmp_path = STATUS_FILE.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload), encoding="utf-8")
    tmp_path.replace(STATUS_FILE)


def read_status() -> dict[str, str]:
    try:
        return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def count_files(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(1 for child in path.rglob("*") if child.is_file())


def _remove_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
    else:
        path.unlink(missing_ok=True)


def _is_internal_temp_name(name: str) -> bool:
    return name in INTERNAL_TEMP_STATE_NAMES or any(
        name.startswith(prefix) for prefix in INTERNAL_TEMP_NAME_PREFIXES
    )


def _has_internal_temp_part(path: str) -> bool:
    parts = Path(path).parts
    return any(_matches_prefix(parts, prefix) for prefix in INTERNAL_TEMP_WORKSPACE_PREFIXES)


def _matches_prefix(parts: tuple[str, ...], prefix: tuple[str, ...]) -> bool:
    return len(parts) >= len(prefix) and parts[:len(prefix)] == prefix


def _should_skip_state_entry_name(name: str) -> bool:
    return (
        name in EXCLUDED_STATE_NAMES
        or name in EXCLUDED_SYNC_DIRS
        or _is_internal_temp_name(name)
    )


def _should_skip_sync_path(rel_parts: tuple[str, ...]) -> bool:
    return any(part in EXCLUDED_SYNC_DIRS for part in rel_parts) or any(
        _matches_prefix(rel_parts, prefix) for prefix in INTERNAL_TEMP_WORKSPACE_PREFIXES
    )


def _iter_sync_tree(root: Path):
    """Yield syncable paths without descending into ignored/temp directories."""
    if not root.exists():
        return

    for dirpath, dirnames, filenames in os.walk(root):
        dir_path = Path(dirpath)
        try:
            dir_rel_parts = dir_path.relative_to(root).parts
        except ValueError:
            dir_rel_parts = ()
        if dir_rel_parts == (".",):
            dir_rel_parts = ()
        dirnames[:] = sorted(
            name for name in dirnames
            if not _should_skip_sync_path(dir_rel_parts + (name,))
        )

        for dirname in dirnames:
            yield dir_path / dirname
        for filename in sorted(filenames):
            if _should_skip_sync_path(dir_rel_parts + (filename,)):
                continue
            yield dir_path / filename


def _iter_sync_files(root: Path):
    for path in _iter_sync_tree(root):
        if path.is_file():
            yield path


def cleanup_internal_temp_paths() -> None:
    """Remove stale sync/restore scratch dirs that must never be backed up."""
    for root in (OPENCLAW_HOME, STATE_DIR):
        if not root.exists() or not root.is_dir():
            continue
        try:
            children = list(root.iterdir())
        except OSError:
            continue
        for child in children:
            if not _is_internal_temp_name(child.name):
                continue
            try:
                _remove_path(child)
                print(f"Removed stale sync scratch path: {child}")
            except OSError as exc:
                print(f"Warning: could not remove stale sync scratch path {child}: {exc}")


def _copy_hot_directory_snapshot(source_path: Path, tmp_path: Path) -> bool:
    """Best-effort mirror of a hot directory into *tmp_path*.

    OpenClaw session files under .openclaw/agents can be rewritten or removed
    while the sync process is copying them. A single raced file must not make the
    whole agents tree keep its old backup forever, so copy files independently
    and preserve the previous staged version only for paths that failed while
    still existing in the source tree.
    """
    had_copy_failures = False
    protected_rel_paths: set[Path] = set()

    try:
        discovered_paths = sorted(
            source_path.rglob("*"),
            key=lambda child: child.relative_to(source_path).as_posix(),
        )
    except OSError:
        discovered_paths = []
        had_copy_failures = True

    for source_child in discovered_paths:
        try:
            rel = source_child.relative_to(source_path)
        except ValueError:
            continue
        target_child = tmp_path / rel

        try:
            if source_child.is_symlink():
                link_target = os.readlink(source_child)
                target_child.parent.mkdir(parents=True, exist_ok=True)
                if target_child.exists() or target_child.is_symlink():
                    _remove_path(target_child)
                os.symlink(link_target, target_child)
            elif source_child.is_dir():
                if target_child.exists() and not target_child.is_dir():
                    _remove_path(target_child)
                target_child.mkdir(parents=True, exist_ok=True)
            elif source_child.is_file():
                target_child.parent.mkdir(parents=True, exist_ok=True)
                tmp_file = target_child.parent / f".{target_child.name}.copy-tmp-{os.getpid()}"
                try:
                    shutil.copy2(source_child, tmp_file)
                    if target_child.is_dir() and not target_child.is_symlink():
                        _remove_path(target_child)
                    tmp_file.replace(target_child)
                finally:
                    tmp_file.unlink(missing_ok=True)
        except OSError:
            had_copy_failures = True
            # If the file/dir still exists, treat this as a hot-file race and
            # keep the previously seeded backup for this exact path. If it no
            # longer exists, the stale-prune pass below can remove it.
            if source_child.exists() or source_child.is_symlink():
                protected_rel_paths.add(rel)
            continue

    for staged_child in sorted(tmp_path.rglob("*"), key=lambda child: len(child.parts), reverse=True):
        try:
            rel = staged_child.relative_to(tmp_path)
        except ValueError:
            continue
        if rel in protected_rel_paths:
            continue
        source_child = source_path / rel
        if source_child.exists() or source_child.is_symlink():
            continue
        _remove_path(staged_child)

    return had_copy_failures


def copy_state_entry_with_retry(source_path: Path, backup_path: Path, attempts: int = 3) -> bool:
    """Copy one top-level .openclaw entry with short retries for hot files/dirs.

    The state staging dir is seeded from the last known-good backup before this
    function runs. Never delete that seeded entry until a fresh copy has fully
    succeeded; hot session files can change mid-copy, and a failed copy must not
    turn into a deletion that later prunes valid remote session data.

    Returns True when an individual hot-file copy had to be skipped while the
    rest of the entry was still refreshed.
    """
    last_exc: Exception | None = None
    parent = backup_path.parent
    for attempt in range(1, attempts + 1):
        tmp_path = parent / f".{backup_path.name}.snapshot-tmp-{os.getpid()}-{attempt}"
        old_path = parent / f".{backup_path.name}.snapshot-old-{os.getpid()}-{attempt}"
        for cleanup_path in (tmp_path, old_path):
            if cleanup_path.exists() or cleanup_path.is_symlink():
                _remove_path(cleanup_path)
        try:
            entry_had_copy_failures = False
            if source_path.is_dir():
                if backup_path.is_dir() and not backup_path.is_symlink():
                    shutil.copytree(backup_path, tmp_path, symlinks=True)
                else:
                    tmp_path.mkdir(parents=True, exist_ok=True)
                entry_had_copy_failures = _copy_hot_directory_snapshot(source_path, tmp_path)
            elif source_path.is_file():
                tmp_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, tmp_path)
            else:
                return False

            if backup_path.exists() or backup_path.is_symlink():
                backup_path.rename(old_path)
            tmp_path.rename(backup_path)
            if old_path.exists() or old_path.is_symlink():
                _remove_path(old_path)
            return entry_had_copy_failures
        except Exception as exc:
            last_exc = exc
            if tmp_path.exists() or tmp_path.is_symlink():
                _remove_path(tmp_path)
            if (old_path.exists() or old_path.is_symlink()) and not backup_path.exists():
                old_path.rename(backup_path)
            if attempt < attempts:
                time.sleep(0.2 * attempt)
                continue
            raise last_exc

def snapshot_state_into_workspace() -> bool:
    had_copy_failures = False
    try:
        cleanup_internal_temp_paths()
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        # Atomic snapshot: copy to a staging dir first, then rename.
        # This prevents a half-written (or empty) backup if we crash mid-copy,
        # which would otherwise be uploaded and overwrite the real HF backup.
        staging_dir = STATE_DIR / ".openclaw-staging"
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)
        if OPENCLAW_STATE_BACKUP_DIR.exists():
            shutil.copytree(OPENCLAW_STATE_BACKUP_DIR, staging_dir)
        else:
            staging_dir.mkdir(parents=True, exist_ok=True)

        skipped_entries: list[tuple[str, Exception]] = []
        copied_entry_names: set[str] = set()
        for source_path in OPENCLAW_HOME.iterdir():
            if _should_skip_state_entry_name(source_path.name):
                continue

            backup_path = staging_dir / source_path.name
            try:
                entry_had_copy_failures = copy_state_entry_with_retry(source_path, backup_path)
                if entry_had_copy_failures:
                    had_copy_failures = True
                    print(
                        f"Warning: refreshed {source_path.name} with hot-file skips; "
                        "previous backup versions preserved for skipped paths."
                    )
                copied_entry_names.add(source_path.name)
            except Exception as entry_exc:
                skipped_entries.append((source_path.name, entry_exc))

        # If staging was seeded from a previous backup, remove entries that no
        # longer exist in OPENCLAW_HOME so the backup remains a true mirror of
        # current state (except entries intentionally excluded from sync).
        # BUG FIX: entries that *failed* to copy but still exist in OPENCLAW_HOME
        # keep their previous backup version in staging.  Removing them here
        # (old behaviour) caused a transient copy error to look like a deletion,
        # making prune_remote_deleted_files incorrectly delete them from the HF
        # dataset on the next sync.  Only remove an entry from staging when the
        # source has genuinely been deleted from OPENCLAW_HOME.
        for staged_path in list(staging_dir.iterdir()):
            if _should_skip_state_entry_name(staged_path.name):
                if staged_path.exists() or staged_path.is_symlink():
                    _remove_path(staged_path)
                continue
            if staged_path.name in copied_entry_names:
                continue
            # Source still exists → copy failed transiently; keep the previous
            # backup version so the remote is not pruned on a transient error.
            if (OPENCLAW_HOME / staged_path.name).exists():
                continue
            # Source no longer exists → entry was genuinely deleted; remove it
            # from staging so the remote is pruned on the next sync.
            if staged_path.exists():
                if staged_path.is_dir():
                    shutil.rmtree(staged_path, ignore_errors=True)
                else:
                    staged_path.unlink(missing_ok=True)

        # If any top-level state entries could not be copied, keep the last
        # known-good version for only those entries (staging was seeded from
        # previous backup). This preserves forward progress for the rest.
        if skipped_entries:
            had_copy_failures = True
            for name, entry_exc in skipped_entries:
                print(f"Warning: keeping previous state entry {name}: {entry_exc}")
            print(
                "Warning: OpenClaw state snapshot had copy failures; updated remaining state entries."
            )
        # Atomically swap staging → real backup dir
        if OPENCLAW_STATE_BACKUP_DIR.exists():
            shutil.rmtree(OPENCLAW_STATE_BACKUP_DIR, ignore_errors=True)
        staging_dir.rename(OPENCLAW_STATE_BACKUP_DIR)
    except Exception as exc:
        # Clean up staging on failure so it doesn't interfere next time
        staging_dir = STATE_DIR / ".openclaw-staging"
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)
        print(f"Warning: could not snapshot OpenClaw state: {exc}")
        had_copy_failures = True

    try:
        if not WHATSAPP_ENABLED:
            return had_copy_failures

        STATE_DIR.mkdir(parents=True, exist_ok=True)

        if RESET_MARKER.exists():
            if WHATSAPP_BACKUP_DIR.exists():
                shutil.rmtree(WHATSAPP_BACKUP_DIR, ignore_errors=True)
                print("Removed backed-up WhatsApp credentials after reset request.")
            RESET_MARKER.unlink(missing_ok=True)
            return had_copy_failures

        if not WHATSAPP_CREDS_DIR.exists():
            return had_copy_failures

        file_count = count_files(WHATSAPP_CREDS_DIR)
        if file_count < 2:
            if file_count > 0:
                print(f"WhatsApp backup skipped: credentials incomplete ({file_count} files).")
            return had_copy_failures

        # Preserve the previous credentials backup unless the fresh copy fully
        # succeeds. A hot WhatsApp session can change files while copying; that
        # must not erase the last known-good session backup.
        replace_path_atomically(WHATSAPP_CREDS_DIR, WHATSAPP_BACKUP_DIR)
    except Exception as exc:
        print(f"Warning: could not snapshot WhatsApp state: {exc}")
        had_copy_failures = True
    return had_copy_failures


def replace_path_atomically(source_path: Path, target_path: Path) -> None:
    """Replace one restored state entry without deleting the live copy first.

    A failed copy of openclaw.json/credentials must never leave existing users
    with a missing or half-restored config.  Copy into a sibling temp path first,
    move the live target aside only after the copy succeeds, then roll back if the
    final rename fails.
    """
    parent = target_path.parent
    parent.mkdir(parents=True, exist_ok=True)
    tmp_path = parent / f".{target_path.name}.restore-tmp-{os.getpid()}"
    backup_path = parent / f".{target_path.name}.restore-old-{os.getpid()}"

    for cleanup_path in (tmp_path, backup_path):
        if cleanup_path.exists():
            if cleanup_path.is_dir():
                shutil.rmtree(cleanup_path, ignore_errors=True)
            else:
                cleanup_path.unlink(missing_ok=True)

    try:
        if source_path.is_dir():
            shutil.copytree(source_path, tmp_path)
        else:
            shutil.copy2(source_path, tmp_path)

        target_existed = target_path.exists()
        if target_existed:
            target_path.rename(backup_path)
        tmp_path.rename(target_path)
        if backup_path.exists():
            if backup_path.is_dir():
                shutil.rmtree(backup_path, ignore_errors=True)
            else:
                backup_path.unlink(missing_ok=True)
    except Exception:
        if tmp_path.exists():
            if tmp_path.is_dir():
                shutil.rmtree(tmp_path, ignore_errors=True)
            else:
                tmp_path.unlink(missing_ok=True)
        if backup_path.exists() and not target_path.exists():
            backup_path.rename(target_path)
        raise


def locally_existing_large_files(root: Path) -> set[str]:
    """Files omitted from uploads only because of size, but still present locally.

    These must not be pruned from the remote backup: pruning is for user-deleted
    files, not for files that still exist but are over the upload size ceiling.
    """
    protected: set[str] = set()
    if not root.exists():
        return protected
    for path in _iter_sync_files(root):
        rel = path.relative_to(root).as_posix()
        try:
            if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                protected.add(rel)
        except OSError:
            continue
    return protected


def restore_embedded_state() -> None:
    cleanup_internal_temp_paths()
    state_backup_root = STATE_DIR / "openclaw"

    # Migration fix: old backups stored state in ".huggingclaw-state/openclaw"
    # (hidden dir). If new path doesn't exist but old hidden path does, use it
    # and migrate it to the new path so future syncs write to the right place.
    if not state_backup_root.is_dir():
        legacy_state = WORKSPACE / ".huggingclaw-state" / "openclaw"
        if legacy_state.is_dir():
            print("Found legacy state backup at .huggingclaw-state/; migrating to huggingclaw-state/...")
            try:
                STATE_DIR.mkdir(parents=True, exist_ok=True)
                shutil.copytree(legacy_state, state_backup_root)
                legacy_root = WORKSPACE / ".huggingclaw-state"
                shutil.rmtree(legacy_root, ignore_errors=True)
                print("Legacy state migrated and .huggingclaw-state/ removed.")
            except Exception as exc:
                print(f"Warning: could not migrate legacy state: {exc}")

    if state_backup_root.is_dir():
        for source_path in state_backup_root.iterdir():
            name = source_path.name
            if _should_skip_state_entry_name(name):
                if source_path.is_dir():
                    shutil.rmtree(source_path, ignore_errors=True)
                else:
                    source_path.unlink(missing_ok=True)
                continue
            target_path = OPENCLAW_HOME / name
            replace_path_atomically(source_path, target_path)
        print("OpenClaw state restored.")

    if WHATSAPP_ENABLED and WHATSAPP_BACKUP_DIR.is_dir():
        file_count = count_files(WHATSAPP_BACKUP_DIR)
        if file_count >= 2:
            # Restore credentials with the same temp-and-rename safety used for
            # openclaw.json/state entries so a copy failure cannot delete the
            # current WhatsApp session.
            replace_path_atomically(WHATSAPP_BACKUP_DIR, WHATSAPP_CREDS_DIR)
            # Lock down dir tree: 0700 on directories, 0600 on every file
            # so the WhatsApp session secrets can't be read by other users.
            os.chmod(OPENCLAW_HOME / "credentials", 0o700)
            for path in WHATSAPP_CREDS_DIR.rglob("*"):
                try:
                    if path.is_dir():
                        os.chmod(path, 0o700)
                    elif path.is_file():
                        os.chmod(path, 0o600)
                except OSError:
                    pass
            print("WhatsApp credentials restored.")
        else:
            print(f"Warning: saved WhatsApp credentials incomplete ({file_count} files), skipping restore.")


def resolve_backup_namespace() -> str:
    global _REPO_ID_CACHE
    if _REPO_ID_CACHE:
        return _REPO_ID_CACHE

    namespace = HF_USERNAME or SPACE_AUTHOR_NAME
    if not namespace and HF_API is not None:
        whoami = HF_API.whoami()
        namespace = whoami.get("name") or whoami.get("user") or ""

    namespace = str(namespace).strip()
    if not namespace:
        raise RuntimeError(
            "Could not determine the Hugging Face username for backups. "
            "Set HF_USERNAME or use a token tied to your account."
        )

    _REPO_ID_CACHE = f"{namespace}/{BACKUP_DATASET_NAME}"
    return _REPO_ID_CACHE


def ensure_repo_exists() -> str:
    repo_id = resolve_backup_namespace()
    try:
        HF_API.repo_info(repo_id=repo_id, repo_type="dataset")
    except RepositoryNotFoundError:
        HF_API.create_repo(repo_id=repo_id, repo_type="dataset", private=True)
    return repo_id


def _should_exclude(rel_posix: str, path: Path) -> bool:
    parts = Path(rel_posix).parts
    if _should_skip_sync_path(parts):
        return True
    if path.is_file():
        try:
            if path.stat().st_size > MAX_FILE_SIZE_BYTES:
                return True
        except OSError:
            pass
    return False


def file_marker(path: Path) -> FileMarker:
    try:
        stat = path.stat()
    except OSError:
        return (0, 0, 0, 0, "")

    if not path.is_file():
        return (0, 0, 0, 0, "")

    digest = ""
    try:
        hasher = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        digest = hasher.hexdigest()
    except OSError:
        # If the file is being rewritten, include ctime/mtime/size and let the
        # next watch loop re-read it.  Never pretend the marker is unchanged.
        digest = f"unreadable:{time.monotonic_ns()}"

    return (1, int(stat.st_size), int(stat.st_mtime_ns), int(stat.st_ctime_ns), digest)


def metadata_marker(root: Path) -> WorkspaceMarker:
    if not root.exists():
        return (0, 0, 0, "")

    file_count = 0
    total_size = 0
    newest_mtime = 0
    metadata_hasher = hashlib.sha256()
    for path in _iter_sync_files(root):
        rel = path.relative_to(root).as_posix()
        # BUG FIX: use directory-only exclusion here (not size-based) so that
        # deleting a large file changes the marker and triggers a sync/prune
        # pass.  Large files are still excluded from the upload snapshot via
        # _should_exclude; this only controls change-detection.
        try:
            stat = path.stat()
        except OSError:
            continue
        file_count += 1
        size = int(stat.st_size)
        mtime_ns = int(stat.st_mtime_ns)
        ctime_ns = int(stat.st_ctime_ns)
        total_size += size
        newest_mtime = max(newest_mtime, mtime_ns, ctime_ns)
        metadata_hasher.update(rel.encode("utf-8"))
        metadata_hasher.update(b"\0")
        metadata_hasher.update(str(size).encode("ascii"))
        metadata_hasher.update(b"\0")
        metadata_hasher.update(str(mtime_ns).encode("ascii"))
        metadata_hasher.update(b"\0")
        metadata_hasher.update(str(ctime_ns).encode("ascii"))
        metadata_hasher.update(b"\0")
    return (file_count, total_size, newest_mtime, metadata_hasher.hexdigest())


def fingerprint_dir(root: Path) -> str:
    hasher = hashlib.sha256()
    if not root.exists():
        return hasher.hexdigest()

    for path in _iter_sync_files(root):
        rel = path.relative_to(root).as_posix()
        # BUG FIX: use directory-only exclusion (not size-based) so that
        # creating or deleting a large file changes the fingerprint.
        # Large files are hashed by path + metadata only (no content read)
        # to avoid reading gigabytes for a change-detection hash.
        hasher.update(rel.encode("utf-8"))
        try:
            stat = path.stat()
            size = int(stat.st_size)
            if size > MAX_FILE_SIZE_BYTES:
                # Too large to upload; fingerprint via metadata only so
                # deletions and creations are detected without I/O cost.
                hasher.update(b"[large-file]\0")
                hasher.update(str(size).encode("ascii"))
                hasher.update(b"\0")
                hasher.update(str(int(stat.st_mtime_ns)).encode("ascii"))
                hasher.update(b"\0")
                continue
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    hasher.update(chunk)
        except (FileNotFoundError, IsADirectoryError, NotADirectoryError):
            # Fingerprint must represent a complete view of the workspace.
            # Retry next sync pass instead of silently hashing a partial tree.
            raise RuntimeError(
                f"Workspace changed while hashing {rel}; retrying next sync pass."
            )
    return hasher.hexdigest()


def create_snapshot_dir(source_root: Path) -> Path:
    staging_root = Path(tempfile.mkdtemp(prefix="huggingclaw-sync-"))
    for path in _iter_sync_tree(source_root):
        rel = path.relative_to(source_root)
        rel_posix = rel.as_posix()
        if _should_exclude(rel_posix, path):
            continue
        target = staging_root / rel
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(path, target)
        except (FileNotFoundError, IsADirectoryError, NotADirectoryError):
            # Do not upload a partial snapshot; let caller retry on next loop.
            raise RuntimeError(
                f"Snapshot changed while copying {rel_posix}; retrying next sync pass."
            )
    # Escape .git dirs so upload_folder (which hard-blocks .git via
    # DEFAULT_IGNORE_PATTERNS) can upload them. _unescape_git_dirs is called
    # in restore_workspace after snapshot_download.
    _escape_git_dirs(staging_root)
    return staging_root


def _run_with_timeout(seconds: float, label: str, func):
    """Run *func* with a SIGALRM watchdog so hung HF calls release the sync lock."""
    if seconds <= 0 or not hasattr(signal, "SIGALRM"):
        return func()

    previous_handler = signal.getsignal(signal.SIGALRM)
    try:
        previous_timer = signal.setitimer(signal.ITIMER_REAL, 0)
    except Exception:
        previous_timer = (0.0, 0.0)

    def _timeout_handler(_sig, _frame):
        raise SyncUploadTimeoutError(f"{label} timed out after {seconds:.0f}s")

    signal.signal(signal.SIGALRM, _timeout_handler)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        return func()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        if previous_timer and previous_timer[0] > 0:
            signal.setitimer(signal.ITIMER_REAL, previous_timer[0], previous_timer[1])


def upload_snapshot(repo_id: str, snapshot_dir: Path) -> None:
    strategy = SYNC_UPLOAD_STRATEGY.replace("-", "_")
    timeout_label = "no timeout" if SYNC_UPLOAD_TIMEOUT <= 0 else f"{SYNC_UPLOAD_TIMEOUT:.0f}s timeout"
    if strategy not in {"folder", "upload_folder", "large_folder"}:
        print(f"Warning: unknown SYNC_UPLOAD_STRATEGY={SYNC_UPLOAD_STRATEGY!r}; using upload_folder.")
        strategy = "folder"

    def _upload() -> None:
        if strategy == "large_folder":
            try:
                HF_API.upload_large_folder(
                    repo_id=repo_id,
                    repo_type="dataset",
                    folder_path=str(snapshot_dir),
                    num_workers=2,
                    print_report=False,
                )
                return
            except AttributeError:
                print("Warning: upload_large_folder unavailable; falling back to upload_folder.")

        upload_folder(
            folder_path=str(snapshot_dir),
            repo_id=repo_id,
            repo_type="dataset",
            token=HF_TOKEN,
            commit_message=f"HuggingClaw sync {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
        )

    print(f"Workspace upload: strategy={strategy}, {timeout_label}")
    _run_with_timeout(SYNC_UPLOAD_TIMEOUT, "Workspace upload", _upload)


def prune_remote_deleted_files(
    repo_id: str,
    snapshot_dir: Path,
    skip_prefixes: set[str] | None = None,
    protected_paths: set[str] | None = None,
) -> None:
    """Delete files that exist on the remote dataset but no longer exist locally.

    Uses create_commit directly (instead of delete_files) to avoid a redundant
    list_repo_files call inside the HF SDK, and batches deletions into chunks of
    PRUNE_BATCH_SIZE to prevent hitting the HF API payload limit when many files
    are pruned at once.
    """
    if HF_API is None:
        return
    skip_prefixes = skip_prefixes or set()
    protected_paths = protected_paths or set()

    local_files = {
        path.relative_to(snapshot_dir).as_posix()
        for path in snapshot_dir.rglob("*")
        if path.is_file()
    }

    remote_files = list(HF_API.list_repo_files(repo_id=repo_id, repo_type="dataset"))
    stale_files = [
        path for path in remote_files
        if path not in local_files and path not in {".gitattributes"}
        and path not in protected_paths
        and not any(path == prefix or path.startswith(prefix + "/") for prefix in skip_prefixes)
    ]
    _commit_delete_batches(repo_id, stale_files, "Prune", "stale file(s) after workspace sync")


def _commit_delete_batches(repo_id: str, paths: list[str], action: str, reason: str) -> None:
    if not paths:
        return

    total = len(paths)
    num_batches = (total + PRUNE_BATCH_SIZE - 1) // PRUNE_BATCH_SIZE
    for batch_idx in range(num_batches):
        batch = paths[batch_idx * PRUNE_BATCH_SIZE:(batch_idx + 1) * PRUNE_BATCH_SIZE]
        batch_label = f"{batch_idx + 1}/{num_batches}" if num_batches > 1 else ""
        msg = f"{action} {len(batch)} {reason}"
        if batch_label:
            msg += f" (batch {batch_label})"
        operations = [CommitOperationDelete(path_in_repo=path) for path in batch]
        HF_API.create_commit(
            repo_id=repo_id,
            repo_type="dataset",
            operations=operations,
            commit_message=msg,
        )
        if num_batches > 1:
            print(f"{action} batch {batch_label}: {len(batch)} file(s)")


def prune_remote_internal_temp_files(repo_id: str) -> None:
    """Remove old recursive scratch files from the HF backup even if nothing changed locally."""
    if HF_API is None:
        return

    remote_files = list(HF_API.list_repo_files(repo_id=repo_id, repo_type="dataset"))
    internal_temp_files = [
        path for path in remote_files
        if path != ".gitattributes" and _has_internal_temp_part(path)
    ]
    _commit_delete_batches(
        repo_id,
        internal_temp_files,
        "Prune internal sync scratch",
        "file(s) from backup",
    )


def restore_workspace() -> bool:
    if not HF_TOKEN:
        write_status("disabled", "HF_TOKEN is not configured.")
        return False

    repo_id = resolve_backup_namespace()
    write_status("restoring", f"Restoring workspace from {repo_id}")

    # Staging path for atomic restore (same filesystem as WORKSPACE so rename is atomic).
    staging = WORKSPACE.parent / ".workspace-restore-staging"
    old_workspace = WORKSPACE.parent / ".workspace-restore-old"

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            snapshot_download(
                repo_id=repo_id,
                repo_type="dataset",
                token=HF_TOKEN,
                local_dir=tmpdir,
            )

            tmp_path = Path(tmpdir)
            if not any(tmp_path.iterdir()):
                write_status("fresh", "Backup dataset is empty. Starting fresh.")
                return True

            # Undo the .git → __dot_git__ escaping applied before upload
            # (upload_folder hard-blocks .git via DEFAULT_IGNORE_PATTERNS).
            _unescape_git_dirs(tmp_path)

            # Build the restored workspace in a staging dir without touching the
            # live workspace.  Only swap once staging is fully written so a copy
            # failure mid-way can never leave the workspace in a partial state.
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
            staging.mkdir(parents=True, exist_ok=True)

            for child in tmp_path.iterdir():
                destination = staging / child.name
                if child.is_dir():
                    shutil.copytree(child, destination)
                else:
                    shutil.copy2(child, destination)

        # Atomic swap: rename current workspace aside, promote staging.
        # Both paths live under WORKSPACE.parent so rename() stays on-filesystem.
        if old_workspace.exists():
            shutil.rmtree(old_workspace, ignore_errors=True)
        WORKSPACE.mkdir(parents=True, exist_ok=True)
        WORKSPACE.rename(old_workspace)
        staging.rename(WORKSPACE)
        shutil.rmtree(old_workspace, ignore_errors=True)

        restore_embedded_state()
        write_status("restored", f"Restored workspace from {repo_id}")
        return True
    except RepositoryNotFoundError:
        write_status("fresh", f"Backup dataset {repo_id} does not exist yet.")
        return True
    except HfHubHTTPError as exc:
        if exc.response is not None and exc.response.status_code == 404:
            write_status("fresh", f"Backup dataset {repo_id} does not exist yet.")
            return True
        write_status("error", f"Restore failed: {exc}")
        print(f"Restore failed: {exc}", file=sys.stderr)
        return False
    except Exception as exc:
        write_status("error", f"Restore failed: {exc}")
        print(f"Restore failed: {exc}", file=sys.stderr)
        return False
    finally:
        # Best-effort cleanup of staging on any failure path.
        # If the rename swap already moved staging → WORKSPACE, staging no longer
        # exists here so the rmtree is a no-op.
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        # If the swap half-completed (old_workspace exists but WORKSPACE missing),
        # roll back so the container doesn't boot with an absent workspace.
        if old_workspace.exists():
            if not WORKSPACE.exists():
                try:
                    old_workspace.rename(WORKSPACE)
                    print("Warning: restore swap failed; rolled back to previous workspace.")
                except Exception:
                    pass  # best-effort; next restart will retry restore
            else:
                shutil.rmtree(old_workspace, ignore_errors=True)


def _sync_once_unlocked(
    last_fingerprint: str | None = None,
    last_marker: WorkspaceMarker | None = None,
    force_fingerprint_check: bool = False,
) -> tuple[str, WorkspaceMarker]:
    if not HF_TOKEN:
        write_status("disabled", "HF_TOKEN is not configured.")
        return (last_fingerprint or "", last_marker or (0, 0, 0, ""))

    global _prune_needed, _remote_temp_prune_done

    had_snapshot_copy_failures = snapshot_state_into_workspace()
    repo_id = ensure_repo_exists()
    if not _remote_temp_prune_done:
        try:
            prune_remote_internal_temp_files(repo_id)
            _remote_temp_prune_done = True
        except Exception as temp_prune_exc:
            # Do not block normal user-data sync if the cleanup commit fails;
            # leave the flag false so the next pass retries before taking the
            # metadata/fingerprint early exit again.
            print(f"Warning: could not prune internal sync scratch files: {temp_prune_exc}")
            _prune_needed = True
    current_marker = metadata_marker(WORKSPACE)
    # Session watcher uses content digests and can detect same-size rewrites
    # whose workspace metadata marker is unchanged.  In that case, force the
    # stronger fingerprint pass instead of returning early on metadata alone.
    if (
        last_marker is not None
        and current_marker == last_marker
        and not _prune_needed
        and not force_fingerprint_check
    ):
        write_status("synced", "No workspace changes detected.")
        return (last_fingerprint or "", current_marker)

    current_fingerprint = fingerprint_dir(WORKSPACE)
    if last_fingerprint is not None and current_fingerprint == last_fingerprint and not _prune_needed:
        write_status("synced", "No workspace changes detected.")
        return (last_fingerprint, current_marker)

    upload_timeout_label = "no timeout" if SYNC_UPLOAD_TIMEOUT <= 0 else f"timeout {SYNC_UPLOAD_TIMEOUT:.0f}s"
    write_status("syncing", f"Uploading workspace to {repo_id} ({SYNC_UPLOAD_STRATEGY}, {upload_timeout_label})")
    snapshot_dir = create_snapshot_dir(WORKSPACE)
    try:
        upload_snapshot(repo_id, snapshot_dir)
        skip_prune_prefixes: set[str] = set()
        if had_snapshot_copy_failures:
            # BUG FIX: the old code added "huggingclaw-state/openclaw" to
            # skip_prune_prefixes here, which prevented ANY openclaw state file
            # from being pruned whenever any copy failure occurred — including
            # files the user had legitimately deleted.
            # That protection is no longer needed: snapshot_state_into_workspace
            # now keeps the previous backup version for entries that fail to copy
            # (transient error), so the snapshot already contains those files and
            # prune_remote_deleted_files will not consider them stale.
            print(
                "Warning: state snapshot had copy failures; previous backup "
                "versions preserved for affected entries."
            )
        had_prune_failure = False
        try:
            prune_remote_deleted_files(
                repo_id,
                snapshot_dir,
                skip_prefixes=skip_prune_prefixes,
                protected_paths=locally_existing_large_files(WORKSPACE),
            )
        except Exception as prune_exc:
            print(f"Warning: could not prune stale remote files: {prune_exc}")
            had_prune_failure = True
    finally:
        shutil.rmtree(snapshot_dir, ignore_errors=True)

    _prune_needed = had_prune_failure
    if had_prune_failure:
        write_status("success", f"Uploaded workspace to {repo_id}; prune warnings — will retry next pass")
    else:
        write_status("success", f"Uploaded workspace to {repo_id}")
    return (current_fingerprint, current_marker)


def sync_once(
    last_fingerprint: str | None = None,
    last_marker: WorkspaceMarker | None = None,
    force_fingerprint_check: bool = False,
) -> tuple[str, WorkspaceMarker]:
    SYNC_LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SYNC_LOCK_FILE.open("w", encoding="utf-8") as lock_handle:
        deadline = time.monotonic() + SYNC_LOCK_TIMEOUT
        while True:
            try:
                fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(
                        f"Timed out waiting {SYNC_LOCK_TIMEOUT:.0f}s for workspace sync lock."
                    )
                if STOP_EVENT.wait(0.25):
                    raise TimeoutError("Stopped while waiting for workspace sync lock.")
        try:
            return _sync_once_unlocked(
                last_fingerprint,
                last_marker,
                force_fingerprint_check=force_fingerprint_check,
            )
        finally:
            fcntl.flock(lock_handle, fcntl.LOCK_UN)


def handle_signal(_sig, _frame) -> None:
    STOP_EVENT.set()


def is_valid_json_file(path: Path) -> bool:
    if not path.exists():
        return True

    try:
        json.loads(path.read_text(encoding="utf-8"))
        return True
    except Exception:
        return False


def sessions_marker() -> tuple[int, int, int, str]:
    """Return a lightweight marker for all agent session directories.

    OpenClaw can use agent profiles beyond "main". Watch every
    */sessions path under .openclaw/agents so session changes always trigger
    syncs regardless of profile name.
    """
    if not SESSIONS_ROOT.exists():
        return (0, 0, 0, "")

    file_count = 0
    total_size = 0
    newest_mtime = 0
    metadata_hasher = hashlib.sha256()

    for profile_dir in sorted(SESSIONS_ROOT.iterdir()):
        if not profile_dir.is_dir():
            continue
        sessions_dir = profile_dir / "sessions"
        if not sessions_dir.exists():
            continue
        # Use content fingerprinting for sessions so we detect changes even
        # when file size + mtime metadata appear unchanged across quick writes.
        # (Some tooling can rewrite files in-place with preserved timestamps.)
        marker = metadata_marker(sessions_dir)
        digest = hashlib.sha256()
        for path in sorted(p for p in sessions_dir.rglob("*") if p.is_file()):
            rel = path.relative_to(sessions_dir).as_posix()
            try:
                stat = path.stat()
            except OSError:
                continue
            size = int(stat.st_size)
            mtime_ns = int(stat.st_mtime_ns)
            ctime_ns = int(stat.st_ctime_ns)
            digest.update(rel.encode("utf-8"))
            digest.update(b"\0")
            digest.update(str(size).encode("ascii"))
            digest.update(b"\0")
            digest.update(str(mtime_ns).encode("ascii"))
            digest.update(b"\0")
            digest.update(str(ctime_ns).encode("ascii"))
            digest.update(b"\0")
            # Sessions are the most important live data.  Hash every scan
            # instead of trusting size/mtime/ctime caches so same-size rewrites
            # and very small edits are never missed by the sessions trigger.
            file_hasher = hashlib.sha256()
            try:
                with path.open("rb") as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        file_hasher.update(chunk)
            except (FileNotFoundError, IsADirectoryError, NotADirectoryError):
                continue
            file_digest = file_hasher.hexdigest()
            digest.update(file_digest.encode("ascii"))
            digest.update(b"\0")

        file_count += marker[0]
        total_size += marker[1]
        newest_mtime = max(newest_mtime, marker[2])
        metadata_hasher.update(profile_dir.name.encode("utf-8"))
        metadata_hasher.update(b"\0")
        metadata_hasher.update(digest.hexdigest().encode("ascii"))
        metadata_hasher.update(b"\0")

    return (file_count, total_size, newest_mtime, metadata_hasher.hexdigest())


def wait_for_config_settle(config_marker: FileMarker) -> tuple[str, FileMarker]:
    stable_since = time.monotonic()
    current_marker = config_marker

    while not STOP_EVENT.is_set():
        latest_marker = file_marker(OPENCLAW_CONFIG_FILE)
        if latest_marker != current_marker:
            current_marker = latest_marker
            stable_since = time.monotonic()

        if (
            time.monotonic() - stable_since >= CONFIG_SETTLE_SECONDS
            and is_valid_json_file(OPENCLAW_CONFIG_FILE)
        ):
            return ("settled", current_marker)

        if STOP_EVENT.wait(CONFIG_WATCH_INTERVAL):
            return ("stopped", current_marker)

    return ("stopped", current_marker)


def wait_for_sync_trigger(
    config_marker: FileMarker,
    last_sessions_sync_time: float = 0.0,
) -> tuple[str, FileMarker]:
    deadline = time.monotonic() + max(0, INTERVAL)
    # BUG FIX: also watch sessions directory so new/updated sessions
    # trigger an immediate sync instead of waiting the full interval.
    # Without this, sessions created between 180-second intervals were
    # lost when the container restarted (e.g. HF Space going to sleep).
    last_sessions_marker = sessions_marker()

    while not STOP_EVENT.is_set():
        current_config_marker = file_marker(OPENCLAW_CONFIG_FILE)
        if current_config_marker != config_marker:
            return wait_for_config_settle(current_config_marker)

        sessions_gap_elapsed = (
            time.monotonic() - last_sessions_sync_time >= SESSIONS_MIN_SYNC_GAP
        )
        if sessions_gap_elapsed:
            # Sessions changed -> trigger sync immediately (no settle needed;
            # session files are written atomically by OpenClaw).
            current_sessions_marker = sessions_marker()
            if current_sessions_marker != last_sessions_marker:
                return ("sessions", current_config_marker)

        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return ("interval", current_config_marker)

        wait_seconds = min(CONFIG_WATCH_INTERVAL, remaining)
        if STOP_EVENT.wait(wait_seconds):
            return ("stopped", current_config_marker)

    return ("stopped", config_marker)


def loop() -> int:
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    previous_status = read_status().get("status", "")

    try:
        repo_id = resolve_backup_namespace()
        write_status("configured", f"Backup loop active for {repo_id} with {INTERVAL}s interval.")
    except Exception as exc:
        write_status("error", str(exc))
        print(f"Workspace sync error: {exc}")
        return 1

    time.sleep(INITIAL_DELAY)
    print(f"Workspace sync started: every {INTERVAL}s -> {repo_id}")

    # Capture the restored dataset state before refreshing the embedded
    # /home/node/.openclaw backup.  Startup may have patched openclaw.json
    # after restore (token/model/logging/channel toggles), and that patch only
    # becomes part of the dataset once snapshot_state_into_workspace() copies it
    # into workspace/huggingclaw-state/openclaw/.  If the snapshot changes the
    # workspace, seed the first sync with the pre-snapshot fingerprint so the
    # updated openclaw.json is uploaded instead of being treated as the baseline.
    pre_snapshot_fingerprint = fingerprint_dir(WORKSPACE)
    pre_snapshot_marker = metadata_marker(WORKSPACE)
    snapshot_state_into_workspace()
    last_fingerprint = fingerprint_dir(WORKSPACE)
    last_marker = metadata_marker(WORKSPACE)

    if last_fingerprint != pre_snapshot_fingerprint:
        if previous_status == "error":
            print(
                "Initial state snapshot changed, but restore previously failed; "
                "keeping current state as baseline to avoid overwriting the remote backup."
            )
        else:
            last_fingerprint = pre_snapshot_fingerprint
            last_marker = pre_snapshot_marker
            print("Initial state snapshot changed; first sync will upload refreshed OpenClaw state.")
    else:
        print("Initial workspace fingerprint captured.")

    config_marker = file_marker(OPENCLAW_CONFIG_FILE)
    last_sessions_sync_time = 0.0

    sync_trigger = "startup"

    while not STOP_EVENT.is_set():
        try:
            sync_started_config_marker = file_marker(OPENCLAW_CONFIG_FILE)
            last_fingerprint, last_marker = sync_once(
                last_fingerprint,
                last_marker,
                # A sessions trigger came from sessions_marker(), which hashes
                # session contents.  Bypass the metadata-only fast path so
                # same-size session rewrites still reach the dataset.
                force_fingerprint_check=sync_trigger == "sessions",
            )
            if sync_trigger == "sessions":
                last_sessions_sync_time = time.monotonic()
            config_marker = file_marker(OPENCLAW_CONFIG_FILE)

            if config_marker != sync_started_config_marker:
                trigger, config_marker = wait_for_config_settle(config_marker)
                if trigger == "stopped":
                    break
                print("OpenClaw config changed during sync; syncing again after it settled.")
                continue
        except Exception as exc:
            write_status("error", f"Sync failed: {exc}")
            print(f"Workspace sync failed: {exc}")
            config_marker = file_marker(OPENCLAW_CONFIG_FILE)
            STOP_EVENT.wait(min(30, SESSIONS_MIN_SYNC_GAP))

        trigger, config_marker = wait_for_sync_trigger(
            config_marker,
            last_sessions_sync_time=last_sessions_sync_time,
        )
        if trigger == "stopped":
            break
        if trigger == "settled":
            print("OpenClaw config changed and settled; syncing immediately.")
        if trigger == "sessions":
            print("Session files changed; syncing immediately.")
        sync_trigger = trigger

    return 0

def main() -> int:
    WORKSPACE.mkdir(parents=True, exist_ok=True)

    if len(sys.argv) < 2:
        return loop()

    command = sys.argv[1]
    if command == "restore":
        return 0 if restore_workspace() else 1
    if command == "sync-once":
        try:
            sync_once()
            return 0
        except Exception as exc:
            write_status("error", f"Shutdown sync failed: {exc}")
            print(f"Workspace sync: shutdown sync failed: {exc}")
            return 1
    if command == "sync-once-settled":
        try:
            trigger, _ = wait_for_config_settle(file_marker(OPENCLAW_CONFIG_FILE))
            if trigger == "stopped":
                return 1
            sync_once()
            return 0
        except Exception as exc:
            write_status("error", f"Settled sync failed: {exc}")
            print(f"Workspace sync: settled sync failed: {exc}")
            return 1
    if command == "loop":
        return loop()

    print(f"Unknown command: {command}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
