"""Paths and env-driven settings.

Env is read at call time (not import time) so tests can monkeypatch it:

    LC_COURSES_ROOT   where user data lives            (default <repo>/Courses)
    LC_PORT           the server port                  (default 8765)
    LC_FAKE_MODEL     truthy -> stub the vision client (default off)
    LC_TOP_K          retrieved chunks per slide       (default 4)
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT: Path = Path(__file__).resolve().parent.parent
WEB_DIR: Path = REPO_ROOT / "web"

_TRUTHY = {"1", "true", "yes", "on", "y"}


def courses_root() -> Path:
    """User-data root. Re-read from the environment on every call."""
    raw = os.environ.get("LC_COURSES_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return REPO_ROOT / "Courses"


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
    "REPO_ROOT", "COURSES_ROOT", "WEB_DIR", "PORT",
    "courses_root", "port", "fake_model", "top_k",
]
