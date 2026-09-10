"""Editable, course-local groupings for related teaching material.

Folders are organizational metadata. Originals keep their imported path and
bytes. Every read and write stays inside one course directory.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from app.course import atomic_write_json

MAX_FOLDER_NAME = 80
MAX_SAMPLE_CHARS = 500
MAX_CONTEXT_WORDS = 600


def organization_path(store, course_id: str) -> Path:
    return store.course_dir(course_id) / "organization.json"


def _folder_name(value: object) -> str:
    name = " ".join(str(value or "").split()).strip(" .")
    name = re.sub(r"[\\/\x00-\x1f]", " ", name)
    name = " ".join(name.split())[:MAX_FOLDER_NAME].strip()
    return name


def load_organization(store, course_id: str) -> dict[str, Any]:
    current = {a.id for a in store.load_artifacts(course_id)}
    path = organization_path(store, course_id)
    raw: dict[str, Any] = {}
    if path.is_file():
        try:
            parsed = json.loads(path.read_text("utf-8"))
            raw = parsed if isinstance(parsed, dict) else {}
        except (OSError, ValueError):
            raw = {}
    assignments = raw.get("assignments", {})
    cleaned = {
        aid: name
        for aid, value in assignments.items()
        if aid in current and (name := _folder_name(value))
    } if isinstance(assignments, dict) else {}
    reasons = raw.get("reasons", {})
    clean_reasons = {
        name: " ".join(str(reason).split())[:240]
        for name, reason in reasons.items()
        if isinstance(name, str) and name in set(cleaned.values())
    } if isinstance(reasons, dict) else {}
    return {
        "assignments": cleaned,
        "reasons": clean_reasons,
        "method": str(raw.get("method", "manual")),
        "updated_at": float(raw.get("updated_at", 0.0) or 0.0),
    }


def save_organization(
    store,
    course_id: str,
    assignments: dict[str, object],
    *,
    reasons: dict[str, object] | None = None,
    method: str = "manual",
) -> dict[str, Any]:
    current = {a.id for a in store.load_artifacts(course_id)}
    unknown = sorted(set(assignments) - current)
    if unknown:
        raise KeyError(f"Unknown file id: {unknown[0]}")
    cleaned: dict[str, str] = {}
    for aid, value in assignments.items():
        name = _folder_name(value)
        if name:
            cleaned[aid] = name
    clean_reasons = {
        name: " ".join(str(reason).split())[:240]
        for name, reason in (reasons or {}).items()
        if name in set(cleaned.values())
    }
    payload = {
        "assignments": cleaned,
        "reasons": clean_reasons,
        "method": "model" if method == "model" else "manual",
        "updated_at": time.time(),
    }
    atomic_write_json(organization_path(store, course_id), payload)
    return payload


def artifact_descriptors(store, course_id: str) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for artifact in store.load_artifacts(course_id):
        samples = []
        for obj in store.load_learning_objects(course_id, artifact.id)[:4]:
            text = " ".join((obj.text or "").split())
            if text:
                samples.append(text)
            if sum(len(x) for x in samples) >= MAX_SAMPLE_CHARS:
                break
        rows.append({
            "artifact_id": artifact.id,
            "filename": artifact.filename,
            "source_path": artifact.source_path,
            "kind": artifact.kind,
            "purpose": artifact.purpose,
            "sample": " ".join(samples)[:MAX_SAMPLE_CHARS],
        })
    return rows


def apply_model_suggestion(store, course_id: str, client) -> dict[str, Any]:
    descriptors = artifact_descriptors(store, course_id)
    if not descriptors:
        return save_organization(store, course_id, {})
    proposal = client.organize_files(descriptors)
    assignments: dict[str, str] = {}
    reasons: dict[str, str] = {}
    known = {row["artifact_id"] for row in descriptors}
    folders = proposal.get("folders", []) if isinstance(proposal, dict) else []
    if not isinstance(folders, list):
        raise ValueError("The model did not return a folder list.")
    for folder in folders:
        if not isinstance(folder, dict):
            continue
        name = _folder_name(folder.get("name"))
        if not name:
            continue
        reason = " ".join(str(folder.get("reason", "")).split())[:240]
        for aid in folder.get("artifact_ids", []):
            if aid in known and aid not in assignments:
                assignments[aid] = name
        if reason:
            reasons[name] = reason
    if not assignments:
        raise ValueError("The model did not assign any current files.")
    return save_organization(
        store, course_id, assignments, reasons=reasons, method="model"
    )


def _locator_label(obj) -> str:
    loc = obj.locator
    parts: list[str] = []
    if loc.page is not None:
        parts.append(f"page {loc.page}")
    if loc.slide is not None:
        parts.append(f"slide {loc.slide}")
    if loc.note is not None:
        parts.append(f"note {loc.note}")
    if loc.block is not None:
        parts.append(f"block {int(loc.block) + 1}")
    if loc.sheet:
        parts.append(f"sheet {loc.sheet}")
    if loc.cell_range:
        parts.append(loc.cell_range)
    if loc.chart:
        parts.append(f"chart {loc.chart}")
    if loc.notebook_cell is not None:
        parts.append(f"notebook cell {int(loc.notebook_cell) + 1}")
    if loc.output is not None:
        parts.append(f"output {int(loc.output) + 1}")
    if loc.dataset_field:
        parts.append(f"field {loc.dataset_field}")
    return ", ".join(parts) or obj.object_type.replace("_", " ")


def related_material_for_deck(
    store, course_id: str, deck_id: str
) -> tuple[str, list[str]]:
    """Return bounded exact evidence from files grouped with a slide deck."""
    artifacts = store.load_artifacts(course_id)
    current = next(
        (a for a in artifacts if deck_id == f"deck-{a.content_hash[:12]}"), None
    )
    if current is None:
        return "", []
    org = load_organization(store, course_id)
    folder = org["assignments"].get(current.id, "")
    if not folder:
        return "", []
    related = [
        a for a in artifacts
        if a.id != current.id and org["assignments"].get(a.id) == folder
    ]
    lines: list[str] = []
    source_ids: list[str] = []
    words = 0
    for artifact in related:
        for obj in store.load_learning_objects(course_id, artifact.id):
            text = " ".join((obj.text or "").split())
            if not text:
                continue
            remaining = MAX_CONTEXT_WORDS - words
            if remaining <= 0 or len(source_ids) >= 8:
                break
            excerpt = " ".join(text.split()[:min(120, remaining)])
            lines.append(
                f"- {artifact.filename}, {_locator_label(obj)}: {excerpt}"
            )
            source_ids.append(f"object:{artifact.id}:{obj.id}")
            words += len(excerpt.split())
        if words >= MAX_CONTEXT_WORDS or len(source_ids) >= 8:
            break
    return "\n".join(lines), source_ids
