"""Shared fixtures. Keep this minimal; per-area fixtures live in their own test file."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.course import CourseStore


@pytest.fixture
def tmp_courses(tmp_path, monkeypatch) -> Path:
    """An empty courses root for one test, exported as LC_COURSES_ROOT."""
    root = (tmp_path / "Courses").resolve()
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("LC_COURSES_ROOT", str(root))
    return root


@pytest.fixture
def store(tmp_courses: Path) -> CourseStore:
    """A CourseStore bound to the temp root."""
    return CourseStore(tmp_courses)


class FakeKeyring:
    """Stand-in for the `keyring` module inside app.keystore."""

    def __init__(self) -> None:
        self._d: dict[tuple[str, str], str] = {}

    def get_password(self, service, account):
        return self._d.get((service, account))

    def set_password(self, service, account, value):
        self._d[(service, account)] = value

    def delete_password(self, service, account):
        self._d.pop((service, account), None)


@pytest.fixture
def client(tmp_courses: Path, monkeypatch):
    """The app under a TestClient, with the stub model and a fake keyring.

    Shared, because any route can be reached from more than one test file.
    """
    from fastapi.testclient import TestClient

    monkeypatch.setenv("LC_FAKE_MODEL", "1")

    from app import keystore

    monkeypatch.setattr(keystore, "keyring", FakeKeyring())
    monkeypatch.setattr(keystore, "_memory", {})

    from app.main import app

    with TestClient(app) as c:
        yield c
