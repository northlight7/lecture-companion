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
