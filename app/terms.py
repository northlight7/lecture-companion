"""Terms the reader asked to have explained, kept per slide, per course.

A term belongs to the slide it was found on. It is course-local metadata in
`terms.json`, alongside `organization.json`, so re-explaining a slide never
loses it and nothing is written outside one course directory.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from app.course import atomic_write_json

MAX_TERM_CHARS = 200
MAX_NOTE_CHARS = 600
MAX_TERMS_PER_SLIDE = 40


def terms_path(store, course_id: str) -> Path:
    return store.course_dir(course_id) / "terms.json"


def _key(deck_id: str, slide_index: int) -> str:
    return f"{deck_id}:{int(slide_index)}"


def _clean(value: object, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit].strip()


def _load(store, course_id: str) -> dict[str, Any]:
    path = terms_path(store, course_id)
    if not path.exists():
        return {"slides": {}}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {"slides": {}}
    if not isinstance(raw, dict) or not isinstance(raw.get("slides"), dict):
        return {"slides": {}}
    return raw


def _save(store, course_id: str, payload: dict[str, Any]) -> None:
    payload["updated_at"] = time.time()
    atomic_write_json(terms_path(store, course_id), payload)


def terms_for_slide(store, course_id: str, deck_id: str, slide_index: int) -> list[dict[str, str]]:
    entries = _load(store, course_id)["slides"].get(_key(deck_id, slide_index), [])
    if not isinstance(entries, list):
        return []
    return [e for e in entries if isinstance(e, dict) and e.get("term")]


def all_terms(store, course_id: str) -> dict[str, list[dict[str, str]]]:
    slides = _load(store, course_id)["slides"]
    return {k: v for k, v in slides.items() if isinstance(v, list) and v}


def add_term(
    store, course_id: str, deck_id: str, slide_index: int, term: str, note: str
) -> list[dict[str, str]]:
    """Record one term for one slide. Re-asking for the same term updates its note."""
    clean_term = _clean(term, MAX_TERM_CHARS)
    if not clean_term:
        raise ValueError("Select a word or phrase first.")
    clean_note = _clean(note, MAX_NOTE_CHARS)

    payload = _load(store, course_id)
    key = _key(deck_id, slide_index)
    entries = payload["slides"].setdefault(key, [])
    if not isinstance(entries, list):
        entries = []
        payload["slides"][key] = entries

    lowered = clean_term.casefold()
    for entry in entries:
        if isinstance(entry, dict) and str(entry.get("term", "")).casefold() == lowered:
            entry["note"] = clean_note
            entry["added_at"] = time.time()
            _save(store, course_id, payload)
            return terms_for_slide(store, course_id, deck_id, slide_index)

    entries.append({"term": clean_term, "note": clean_note, "added_at": time.time()})
    del entries[:-MAX_TERMS_PER_SLIDE]
    _save(store, course_id, payload)
    return terms_for_slide(store, course_id, deck_id, slide_index)


def remove_term(
    store, course_id: str, deck_id: str, slide_index: int, term: str
) -> list[dict[str, str]]:
    payload = _load(store, course_id)
    key = _key(deck_id, slide_index)
    entries = payload["slides"].get(key, [])
    lowered = _clean(term, MAX_TERM_CHARS).casefold()
    kept = [
        e for e in entries
        if not (isinstance(e, dict) and str(e.get("term", "")).casefold() == lowered)
    ]
    if kept:
        payload["slides"][key] = kept
    else:
        payload["slides"].pop(key, None)
    _save(store, course_id, payload)
    return terms_for_slide(store, course_id, deck_id, slide_index)
