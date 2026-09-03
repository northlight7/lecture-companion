"""The DeepSeek API key, in the OS keyring and nowhere else.

Invariant 4: the key is never written to a file, never logged, and never
returned in full by anything except `get_key()`. When the keyring backend is
unavailable (headless CI, no Secret Service) we fall back to an in-process
dict and warn that the key will not persist. We never fall back to a file.
"""

from __future__ import annotations

import logging

import keyring
from keyring.errors import KeyringError

from app.contracts import KEYRING_ACCOUNT, KEYRING_SERVICE

log = logging.getLogger(__name__)

#: Process-lifetime fallback, used only when the OS keyring raises.
_memory: dict[str, str] = {}
_warned = False


def _warn_no_backend(exc: Exception) -> None:
    global _warned
    if not _warned:
        log.warning(
            "OS keyring unavailable (%s: %s); holding the API key in memory "
            "for this process only. It will NOT persist across restarts.",
            type(exc).__name__, exc,
        )
        _warned = True


def get_key() -> str | None:
    """The full key, or None. The only function that returns it in full."""
    try:
        value = keyring.get_password(KEYRING_SERVICE, KEYRING_ACCOUNT)
    except KeyringError as exc:
        _warn_no_backend(exc)
        value = _memory.get(KEYRING_ACCOUNT)
    if value is None:
        return None
    value = value.strip()
    return value or None


def set_key(key: str) -> None:
    """Store the key. Whitespace is stripped; an empty key is a ValueError."""
    if not isinstance(key, str):
        raise ValueError("api key must be a string")
    key = key.strip()
    if not key:
        raise ValueError("api key must not be empty")
    try:
        keyring.set_password(KEYRING_SERVICE, KEYRING_ACCOUNT, key)
    except KeyringError as exc:
        _warn_no_backend(exc)
        _memory[KEYRING_ACCOUNT] = key


def clear_key() -> None:
    """Remove the key. Idempotent: clearing an absent key is not an error."""
    _memory.pop(KEYRING_ACCOUNT, None)
    try:
        keyring.delete_password(KEYRING_SERVICE, KEYRING_ACCOUNT)
    except KeyringError as exc:
        # PasswordDeleteError (nothing stored) is a KeyringError too.
        log.debug("clear_key: %s: %s", type(exc).__name__, exc)


def has_key() -> bool:
    return get_key() is not None


def key_hint() -> str:
    """A masked hint safe for logs and HTTP responses.

    At most the first 5 and last 4 characters ever leave this function.
    """
    key = get_key()
    if not key:
        return ""
    if len(key) <= 9:
        return "…" + key[-2:] if len(key) > 2 else "…"
    return f"{key[:5]}…{key[-4:]}"


__all__ = ["get_key", "set_key", "clear_key", "has_key", "key_hint"]
