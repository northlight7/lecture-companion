"""Paths and env-driven settings.

Env is read at call time (not import time) so tests can monkeypatch it:

    LC_DATA_ROOT      where the app's data lives    (default per-user app data)
    LC_COURSES_ROOT   where the courses live        (default <data root>/library)
    LC_PORT           the server port                    (default 8765)
    LC_FAKE_MODEL     truthy -> stub the vision client   (default off)
    LC_TOP_K          retrieved chunks per slide         (default 4)

**The courses do not live in this repository.** They live in the per-user
application data directory, which an update cannot reach, because updating the
app replaces the app bundle and touches nothing else. Keeping them in the
checkout used to mean a clean, a fresh clone or a sync conflict could take a
reader's work with it.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
WEB_DIR: Path = REPO_ROOT / "web"

_TRUTHY = {"1", "true", "yes", "on", "y"}

#: The app's folder name under the per-user application data directory. Fixed on
#: purpose rather than taken from the bundle identifier: the identifier may be
#: settled later, and a library must not move because a name changed.
APP_DIR_NAME = "LectureCompanion"


def data_root() -> Path:
    """Where the app keeps everything it owns. Re-read on every call.

    Never inside the repository, and never inside `Documents`, `Desktop` or any
    other folder a cloud service syncs by default.
    """
    raw = os.environ.get("LC_DATA_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or (Path.home() / ".local" / "share"))
    return (base / APP_DIR_NAME).resolve()


DATA_ROOT: Path = data_root()


def courses_root() -> Path:
    """Where the courses live. Re-read from the environment on every call."""
    raw = os.environ.get("LC_COURSES_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return data_root() / "library"


#: Module-level convenience. Prefer `courses_root()` anywhere that must honour
#: an env change made after import (all of the tests do).
COURSES_ROOT: Path = courses_root()


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def port() -> int:
    return _int_env("LC_PORT", 8765)


PORT: int = port()


def fake_model() -> bool:
    """True when LC_FAKE_MODEL is set to a truthy value."""
    return os.environ.get("LC_FAKE_MODEL", "").strip().lower() in _TRUTHY


def top_k() -> int:
    """How many prior explanations to retrieve for a slide's context."""
    k = _int_env("LC_TOP_K", 4)
    return k if k >= 0 else 4


__all__ = [
    "APP_DIR_NAME", "REPO_ROOT", "DATA_ROOT", "COURSES_ROOT", "WEB_DIR", "PORT",
    "data_root", "courses_root", "port", "fake_model", "top_k",
]
