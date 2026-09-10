"""The reader's own notes on a slide, kept with the course.

Separate from `terms.json` because a note is one block of text the reader wrote,
not a list the model wrote. Both are course-local: re-explaining a slide, or
re-running a whole course, must never touch what the reader typed.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from app.course import atomic_write_json

MAX_NOTE_CHARS = 4000


def notes_path(store, course_id: str) -> Path:
    return store.course_dir(course_id) / "notes.json"


def _key(deck_id: str, slide_index: int) -> str:
    return f"{deck_id}:{int(slide_index)}"


def _load(store, course_id: str) -> dict[str, Any]:
    path = notes_path(store, course_id)
    if not path.exists():
        return {"slides": {}}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {"slides": {}}
    if not isinstance(raw, dict) or not isinstance(raw.get("slides"), dict):
        return {"slides": {}}
    return raw


def note_for_slide(store, course_id: str, deck_id: str, slide_index: int) -> str:
    value = _load(store, course_id)["slides"].get(_key(deck_id, slide_index), "")
    return value if isinstance(value, str) else ""


def all_notes(store, course_id: str) -> dict[str, str]:
    slides = _load(store, course_id)["slides"]
    return {k: v for k, v in slides.items() if isinstance(v, str) and v.strip()}


def save_note(
    store, course_id: str, deck_id: str, slide_index: int, text: str
) -> str:
    """Write one slide's note. An empty note removes the entry entirely."""
    clean = str(text or "").strip()[:MAX_NOTE_CHARS]
    payload = _load(store, course_id)
    key = _key(deck_id, slide_index)
    if clean:
        payload["slides"][key] = clean
    else:
        payload["slides"].pop(key, None)
    payload["updated_at"] = time.time()
    atomic_write_json(notes_path(store, course_id), payload)
    return clean
