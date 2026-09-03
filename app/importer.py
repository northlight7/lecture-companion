"""Upload -> classify -> file into exactly one course.

Invariant 1 in practice: `import_files` writes only inside
`store.course_dir(course_id)`. Nothing global, nothing shared between courses.

There is no review step, so the classification reason travels with every filed
item and is shown in the UI.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path

from app.contracts import Course, Deck, ExtractionError, FileRole, SourceFile
from app.extract import classify_file, extract_any, page_count, supported_suffix

__all__ = [
    "FiledItem", "ImportResult", "BulkGroup",
    "import_files", "sort_bulk", "import_bulk", "deck_id_for",
]


@dataclass
class FiledItem:
    filename: str
    file_id: str
    role: FileRole
    reason: str
    deck_id: str = ""       # "" for reference docs
    n_slides: int = 0
    confidence: float = 0.0


@dataclass
class ImportResult:
    filed: list[FiledItem] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class BulkGroup:
    title: str
    filenames: list[str]
    reason: str


# --------------------------------------------------------------------------
# ids
# --------------------------------------------------------------------------

_SAFE = re.compile(r"[^A-Za-z0-9]+")


def deck_id_for(file_id: str) -> str:
    """Stable, filesystem-safe deck id derived from the file_id ONLY.

    Never from the filename: a filename is untrusted input and could carry
    path separators or `..`.
    """
    safe = _SAFE.sub("", str(file_id))
    if not safe:
        safe = hashlib.sha256(str(file_id).encode("utf-8")).hexdigest()
    return f"deck-{safe[:24].lower()}"


def _display_title(filename: str) -> str:
    stem = Path(str(filename).replace("\\", "/")).name
    stem = Path(stem).stem
    stem = re.sub(r"[_\-]+", " ", stem).strip()
    return stem or "Untitled deck"


# --------------------------------------------------------------------------
# import
# --------------------------------------------------------------------------


def _sample_text(pages: list[tuple[int, Path, str]], limit: int = 20000) -> str:
    joined = "\n".join(t for _, _, t in pages)
    return joined[:limit]


def import_files(
    store,
    course_id: str,
    files: list[tuple[str, bytes]],
) -> ImportResult:
    """File each (filename, data) into `course_id`. Never writes elsewhere."""
    result = ImportResult()
    course = store.get_course(course_id)
    order = len(getattr(course, "decks", []) or [])

    for filename, data in files:
        base = Path(str(filename).replace("\\", "/")).name or "upload"
        try:
            if not supported_suffix(base):
                result.errors.append(f"{base}: unsupported file type")
                continue

            file_id, raw_path = store.add_raw_file(course_id, base, data)
            deck_id = deck_id_for(file_id)

            # Extract once, into the deck dir. A reference doc's images are
            # harmless (and cheap); we only keep its text.
            out_dir = store.slides_dir(course_id, deck_id)
            try:
                pages = extract_any(raw_path, out_dir)
            except ExtractionError as exc:
                result.errors.append(f"{base}: {exc}")
                continue

            sample = _sample_text(pages)
            cls = classify_file(Path(base), page_count=len(pages), sample_text=sample)

            sf = SourceFile(
                id=file_id,
                filename=base,
                role=cls.role,
                stored_path=_relative_to_course(store, course_id, raw_path),
                classified_by=cls.reason,
            )
            store.register_file(course_id, sf)

            if cls.role == "slides":
                deck = Deck(
                    id=deck_id,
                    source_file_id=file_id,
                    title=_display_title(base),
                    n_slides=len(pages),
                    order=order,
                )
                order += 1
                store.add_deck(course_id, deck)
                result.filed.append(FiledItem(
                    filename=base, file_id=file_id, role="slides",
                    reason=cls.reason, deck_id=deck_id, n_slides=len(pages),
                    confidence=cls.confidence,
                ))
            else:
                store.save_ref_text(course_id, file_id, sample if sample.strip() else "")
                _discard_dir(out_dir)
                result.filed.append(FiledItem(
                    filename=base, file_id=file_id, role="reference",
                    reason=cls.reason, deck_id="", n_slides=0,
                    confidence=cls.confidence,
                ))
        except Exception as exc:  # noqa: BLE001 - one bad file must not kill the batch
            result.errors.append(f"{base}: {exc}")

    return result


def _relative_to_course(store, course_id: str, path: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(Path(store.course_dir(course_id)).resolve()))
    except Exception:  # noqa: BLE001
        return Path(path).name


def _discard_dir(path: Path) -> None:
    """A reference doc leaves no deck behind."""
    import shutil
    try:
        shutil.rmtree(path)
    except Exception:  # noqa: BLE001
        pass


# --------------------------------------------------------------------------
# bulk sorting (proposal only - touches no store)
# --------------------------------------------------------------------------

_COURSE_CODE = re.compile(r"\b([A-Za-z]{2,6})\s*[-_ ]?\s*(\d{3,5}[A-Za-z]?)\b")


def _code_of(filename: str) -> str | None:
    stem = Path(str(filename).replace("\\", "/")).name
    m = _COURSE_CODE.search(re.sub(r"[_\-]+", " ", Path(stem).stem))
    if not m:
        return None
    return f"{m.group(1).upper()}{m.group(2).upper()}"


def _shared_prefix(names: list[str]) -> str:
    stems = [re.sub(r"[_\-\s]+", " ", Path(n).stem).strip().lower() for n in names]
    if not stems:
        return ""
    pre = stems[0]
    for s in stems[1:]:
        i = 0
        while i < min(len(pre), len(s)) and pre[i] == s[i]:
            i += 1
        pre = pre[:i]
    return pre.strip(" -_")


def sort_bulk(files: list[tuple[str, bytes]] | list[str]) -> list[BulkGroup]:
    """Propose courses for a pile of files. Reads names only, writes nothing."""
    names = [f if isinstance(f, str) else f[0] for f in files]
    names = [Path(str(n).replace("\\", "/")).name for n in names]

    groups: list[BulkGroup] = []
    by_code: dict[str, list[str]] = {}
    leftovers: list[str] = []
    for n in names:
        code = _code_of(n)
        if code:
            by_code.setdefault(code, []).append(n)
        else:
            leftovers.append(n)

    for code, members in by_code.items():
        groups.append(BulkGroup(
            title=code,
            filenames=members,
            reason=f"filenames share the course code {code}",
        ))

    # Leftovers: group by a meaningful shared filename prefix, else one each.
    unassigned = list(leftovers)
    while unassigned:
        head = unassigned.pop(0)
        bucket = [head]
        for other in list(unassigned):
            pre = _shared_prefix([head, other])
            if len(pre) >= 4:
                bucket.append(other)
                unassigned.remove(other)
        if len(bucket) > 1:
            pre = _shared_prefix(bucket)
            groups.append(BulkGroup(
                title=pre.title().strip() or "Untitled course",
                filenames=bucket,
                reason=f'filenames share the prefix "{pre}"',
            ))
        else:
            groups.append(BulkGroup(
                title=_display_title(head),
                filenames=bucket,
                reason="no shared course code or prefix with any other file",
            ))
    return groups


def import_bulk(store, files: list[tuple[str, bytes]]) -> list[tuple[Course, ImportResult]]:
    """Apply `sort_bulk`, create or reuse a course per group, then import."""
    data = {Path(str(n).replace("\\", "/")).name: b for n, b in files}
    existing = {c.title.strip().lower(): c for c in store.list_courses()}
    out: list[tuple[Course, ImportResult]] = []
    for group in sort_bulk(files):
        course = existing.get(group.title.strip().lower())
        if course is None:
            course = store.create_course(group.title)
            existing[group.title.strip().lower()] = course
        payload = [(n, data[n]) for n in group.filenames if n in data]
        res = import_files(store, course.id, payload)
        out.append((store.get_course(course.id), res))
    return out
