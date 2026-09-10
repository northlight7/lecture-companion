"""On-disk store for courses. One sealed directory per course.

    Courses/<course_id>/
      course.json                  Course
      raw/<file_id>__<name>        the uploaded original, byte for byte
      slides/<deck_id>/page-0001.png
      slides/<deck_id>/page-0001.txt
      refs/<file_id>.txt
      explanations/<deck_id>/0001.json
      progress.json                Progress
      index.jsonl                  one IndexRow per line

Two properties this module is responsible for:

* **Invariant 1, course isolation.** Every path is resolved and asserted to sit
  inside `course_dir(course_id)`. An id containing `..`, a separator, or a
  leading dot is rejected before it ever reaches the filesystem.
* **Invariant 5, resumable.** Every write is atomic: content goes to a sibling
  `.tmp` file and is moved onto the target with `os.replace`, so a kill mid-write
  can never leave a truncated `progress.json` or `course.json`.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

from app import config
from app.contracts import (
    Artifact, Course, Deck, Explanation, LearningObject, Progress, Slide,
    SourceFile, SourceLocator,
)

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")
_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")

# --------------------------------------------------------------------------
# id / name hygiene
# --------------------------------------------------------------------------


def slugify(title: str) -> str:
    """Title -> `[a-z0-9-]+`. Returns "course" when nothing survives."""
    slug = _SLUG_STRIP.sub("-", (title or "").strip().lower()).strip("-")
    return slug or "course"


def _check_id(value: str, kind: str) -> str:
    """Reject anything that could escape a course directory."""
    if not isinstance(value, str) or not value:
        raise ValueError(f"{kind} must be a non-empty string")
    if value != value.strip():
        raise ValueError(f"{kind} must not have surrounding whitespace: {value!r}")
    if value.startswith("."):
        raise ValueError(f"{kind} must not start with '.': {value!r}")
    if "/" in value or "\\" in value or os.sep in value:
        raise ValueError(f"{kind} must not contain a path separator: {value!r}")
    if ".." in value:
        raise ValueError(f"{kind} must not contain '..': {value!r}")
    if "\x00" in value:
        raise ValueError(f"{kind} must not contain a NUL byte")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise ValueError(f"{kind} has illegal characters: {value!r}")
    return value


def safe_filename(filename: str) -> str:
    """An untrusted upload name -> a safe basename, extension preserved."""
    base = os.path.basename((filename or "").replace("\\", "/")).strip()
    base = base.lstrip(".") or "file"
    stem, dot, ext = base.rpartition(".")
    if not dot:
        stem, ext = base, ""
    stem = _UNSAFE_NAME.sub("_", stem).strip("_") or "file"
    ext = _UNSAFE_NAME.sub("", ext)[:12]
    stem = stem[:80]
    return f"{stem}.{ext}" if ext else stem


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# --------------------------------------------------------------------------
# atomic IO
# --------------------------------------------------------------------------


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Write `data` to `path` so a reader never sees a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def atomic_write_text(path: Path, text: str) -> None:
    atomic_write_bytes(path, text.encode("utf-8"))


def atomic_write_json(path: Path, obj: Any) -> None:
    atomic_write_text(path, json.dumps(obj, ensure_ascii=False, indent=2) + "\n")


# --------------------------------------------------------------------------
# tolerant deserialisation (unknown keys are ignored, missing use defaults)
# --------------------------------------------------------------------------


def _d(raw: Any) -> dict[str, Any]:
    return raw if isinstance(raw, dict) else {}


def _s(raw: dict[str, Any], key: str, default: str = "") -> str:
    v = raw.get(key, default)
    return v if isinstance(v, str) else default


def _i(raw: dict[str, Any], key: str, default: int = 0) -> int:
    v = raw.get(key, default)
    return v if isinstance(v, int) and not isinstance(v, bool) else default


def _f(raw: dict[str, Any], key: str, default: float = 0.0) -> float:
    v = raw.get(key, default)
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else default


def _slist(raw: dict[str, Any], key: str) -> list[str]:
    v = raw.get(key)
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def source_file_from_dict(raw: Any) -> SourceFile:
    r = _d(raw)
    role = _s(r, "role", "slides")
    return SourceFile(
        id=_s(r, "id") or _new_id(),
        filename=_s(r, "filename"),
        role="reference" if role == "reference" else "slides",
        stored_path=_s(r, "stored_path"),
        classified_by=_s(r, "classified_by"),
        added_at=_f(r, "added_at"),
    )


def deck_from_dict(raw: Any) -> Deck:
    r = _d(raw)
    return Deck(
        id=_s(r, "id") or _new_id(),
        source_file_id=_s(r, "source_file_id"),
        title=_s(r, "title"),
        n_slides=_i(r, "n_slides"),
        order=_i(r, "order"),
    )


def course_from_dict(raw: Any) -> Course:
    r = _d(raw)
    files = r.get("files")
    decks = r.get("decks")
    return Course(
        id=_s(r, "id"),
        title=_s(r, "title"),
        created_at=_f(r, "created_at"),
        overview=_s(r, "overview"),
        overview_source_ids=_slist(r, "overview_source_ids"),
        files=[source_file_from_dict(x) for x in files] if isinstance(files, list) else [],
        decks=[deck_from_dict(x) for x in decks] if isinstance(decks, list) else [],
    )


def explanation_from_dict(raw: Any) -> Explanation:
    r = _d(raw)
    return Explanation(
        deck_id=_s(r, "deck_id"),
        slide_index=_i(r, "slide_index"),
        body=_s(r, "body"),
        example=_s(r, "example"),
        mermaid=_s(r, "mermaid"),
        heading=_s(r, "heading"),
        model=_s(r, "model"),
        context_used=_slist(r, "context_used"),
        created_at=_f(r, "created_at"),
    )


def progress_from_dict(raw: Any) -> Progress:
    r = _d(raw)
    done: dict[str, list[int]] = {}
    raw_done = r.get("done")
    if isinstance(raw_done, dict):
        for deck_id, idxs in raw_done.items():
            if isinstance(deck_id, str) and isinstance(idxs, list):
                done[deck_id] = sorted(
                    {i for i in idxs if isinstance(i, int) and not isinstance(i, bool)}
                )
    state = _s(r, "state", "idle")
    if state not in ("idle", "running", "paused", "done", "error"):
        state = "idle"
    return Progress(
        running_summary=_s(r, "running_summary"),
        done=done,
        state=state,  # type: ignore[arg-type]
        pause_reason=_s(r, "pause_reason"),
        cursor_deck_id=_s(r, "cursor_deck_id"),
        cursor_slide_index=_i(r, "cursor_slide_index"),
        updated_at=_f(r, "updated_at"),
    )


# --------------------------------------------------------------------------
# the store
# --------------------------------------------------------------------------


class CourseStore:
    """Every read and write of course data goes through here."""

    def __init__(self, root: Path | None = None) -> None:
        self.root: Path = Path(root).expanduser().resolve() if root else config.courses_root()

    # -- paths ------------------------------------------------------------

    def _root(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        return self.root

    def course_dir(self, course_id: str) -> Path:
        _check_id(course_id, "course_id")
        return Path(os.path.normpath(str(self.root / course_id)))

    def _within(self, course_id: str, *parts: str) -> Path:
        """Resolve a path under the course dir and prove it stayed inside."""
        base = self.course_dir(course_id)
        path = base.joinpath(*parts)
        # resolve() needs no existing file; strict=False is the default.
        resolved = Path(os.path.normpath(str(path)))
        if resolved != base and base not in resolved.parents:
            raise ValueError(f"path escapes course {course_id!r}: {resolved}")
        return resolved

    def slides_dir(self, course_id: str, deck_id: str) -> Path:
        _check_id(deck_id, "deck_id")
        return self._within(course_id, "slides", deck_id)

    def explanations_dir(self, course_id: str, deck_id: str) -> Path:
        _check_id(deck_id, "deck_id")
        return self._within(course_id, "explanations", deck_id)

    def raw_dir(self, course_id: str) -> Path:
        return self._within(course_id, "raw")

    def refs_dir(self, course_id: str) -> Path:
        return self._within(course_id, "refs")

    def objects_dir(self, course_id: str) -> Path:
        return self._within(course_id, "objects")

    def artifacts_path(self, course_id: str) -> Path:
        return self._within(course_id, "artifacts.json")

    def artifact_renders_dir(self, course_id: str, artifact_id: str) -> Path:
        _check_id(artifact_id, "artifact_id")
        return self._within(course_id, "objects", "renders", artifact_id)

    def artifact_render_path(self, course_id: str, artifact: Artifact, number: int) -> Path:
        if number < 1:
            raise ValueError("render number must be positive")
        preserved = self.artifact_renders_dir(course_id, artifact.id) / f"page-{number:04d}.png"
        if preserved.is_file():
            return preserved
        legacy = self.slides_dir(course_id, f"deck-{artifact.content_hash[:12]}") / f"page-{number:04d}.png"
        return legacy

    def knowledge_index_path(self, course_id: str) -> Path:
        """Course-local derived search and concept index."""
        return self._within(course_id, "objects", "knowledge.sqlite3")

    def executions_dir(self, course_id: str) -> Path:
        return self._within(course_id, "executions")

    def execution_run_dir(self, course_id: str, artifact_id: str, run_id: str) -> Path:
        _check_id(artifact_id, "artifact_id")
        _check_id(run_id, "run_id")
        return self._within(course_id, "executions", artifact_id, run_id)

    def workbook_inspection_path(self, course_id: str, artifact_id: str) -> Path:
        _check_id(artifact_id, "artifact_id")
        return self._within(course_id, "inspections", artifact_id, "workbook.json")

    def workbook_experiment_dir(self, course_id: str, artifact_id: str, experiment_id: str) -> Path:
        _check_id(artifact_id, "artifact_id")
        _check_id(experiment_id, "experiment_id")
        return self._within(course_id, "inspections", artifact_id, "experiments", experiment_id)

    def index_path(self, course_id: str) -> Path:
        return self._within(course_id, "index.jsonl")

    def course_json_path(self, course_id: str) -> Path:
        return self._within(course_id, "course.json")

    def progress_path(self, course_id: str) -> Path:
        return self._within(course_id, "progress.json")

    # -- lifecycle --------------------------------------------------------

    def exists(self, course_id: str) -> bool:
        try:
            return self.course_json_path(course_id).is_file()
        except ValueError:
            return False

    def list_courses(self) -> list[Course]:
        root = self._root()
        out: list[Course] = []
        for entry in sorted(root.iterdir()):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            meta = entry / "course.json"
            if not meta.is_file():
                continue
            try:
                course = course_from_dict(json.loads(meta.read_text("utf-8")))
            except (OSError, ValueError):
                continue
            if not course.id:
                course.id = entry.name
            out.append(course)
        out.sort(key=lambda c: (c.created_at, c.id))
        return out

    def create_course(self, title: str) -> Course:
        root = self._root()
        base = slugify(title)
        course_id, n = base, 1
        while (root / course_id).exists():
            n += 1
            course_id = f"{base}-{n}"
        _check_id(course_id, "course_id")
        cdir = root / course_id
        for sub in ("", "raw", "slides", "refs", "explanations", "objects"):
            (cdir / sub if sub else cdir).mkdir(parents=True, exist_ok=True)
        course = Course(id=course_id, title=(title or "").strip() or course_id)
        self.save_course(course)
        self.save_progress(course_id, Progress())
        return course

    def get_course(self, course_id: str) -> Course:
        path = self.course_json_path(course_id)
        if not path.is_file():
            raise KeyError(f"no such course: {course_id!r}")
        try:
            course = course_from_dict(json.loads(path.read_text("utf-8")))
        except (OSError, ValueError) as exc:
            raise KeyError(f"course {course_id!r} is unreadable: {exc}") from exc
        if not course.id:
            course.id = course_id
        return course

    def save_course(self, course: Course) -> None:
        atomic_write_json(self.course_json_path(course.id), course.to_dict())

    def delete_course(self, course_id: str) -> None:
        import shutil

        cdir = self.course_dir(course_id)
        if cdir.is_dir():
            shutil.rmtree(cdir)

    def delete_artifact(self, course_id: str, artifact_id: str) -> dict[str, Any]:
        """Delete one logical upload and its derived data inside this course.

        All versions at the same imported source path are removed together so
        an old superseded copy cannot reappear. A canonical original or deck is
        retained when another current path still refers to the same bytes.
        """
        import shutil

        _check_id(artifact_id, "artifact_id")
        all_artifacts = self.load_artifacts(course_id, include_superseded=True)
        target = next((a for a in all_artifacts if a.id == artifact_id), None)
        if target is None:
            raise KeyError(f"no such artifact: {artifact_id!r}")
        removed = [a for a in all_artifacts if a.source_path == target.source_path]
        removed_ids = {a.id for a in removed}
        remaining = [a for a in all_artifacts if a.id not in removed_ids]
        self.save_artifacts(course_id, remaining)

        for artifact in removed:
            for path in (
                self._within(course_id, "objects", f"{artifact.id}.jsonl"),
                self.artifact_renders_dir(course_id, artifact.id),
                self._within(course_id, "executions", artifact.id),
                self._within(course_id, "inspections", artifact.id),
            ):
                if path.is_dir():
                    shutil.rmtree(path)
                elif path.is_file():
                    path.unlink()

        referenced_raw = {a.stored_path for a in remaining}
        for artifact in removed:
            if artifact.stored_path and artifact.stored_path not in referenced_raw:
                raw = self._within(course_id, *Path(artifact.stored_path).parts)
                if raw.is_file():
                    raw.unlink()

        remaining_hashes = {a.content_hash for a in remaining}
        orphan_hashes = {a.content_hash for a in removed} - remaining_hashes
        course = self.get_course(course_id)
        orphan_file_ids = {digest[:12] for digest in orphan_hashes}
        orphan_decks = {
            deck.id for deck in course.decks
            if deck.source_file_id in orphan_file_ids
        }
        course.files = [f for f in course.files if f.id not in orphan_file_ids]
        course.decks = [d for d in course.decks if d.id not in orphan_decks]
        self.save_course(course)

        for file_id in orphan_file_ids:
            ref = self._within(course_id, "refs", f"{file_id}.txt")
            if ref.is_file():
                ref.unlink()
        for deck_id in orphan_decks:
            for directory in (
                self.slides_dir(course_id, deck_id),
                self.explanations_dir(course_id, deck_id),
            ):
                if directory.is_dir():
                    shutil.rmtree(directory)

        if orphan_decks:
            from app.vectors import VectorIndex

            index = VectorIndex(self.index_path(course_id))
            index.rebuild_from([r for r in index.all() if r.deck_id not in orphan_decks])
            progress = self.load_progress(course_id)
            progress.done = {
                did: indices for did, indices in progress.done.items()
                if did not in orphan_decks
            }
            if progress.cursor_deck_id in orphan_decks:
                progress.cursor_deck_id = ""
                progress.cursor_slide_index = 0
            progress.running_summary = ""
            self.save_progress(course_id, progress)

        knowledge = self.knowledge_index_path(course_id)
        for path in (knowledge, Path(str(knowledge) + "-wal"), Path(str(knowledge) + "-shm")):
            if path.is_file():
                path.unlink()

        try:
            from app.organization import load_organization, save_organization

            organization = load_organization(self, course_id)
            save_organization(
                self,
                course_id,
                organization["assignments"],
                reasons=organization["reasons"],
                method=organization["method"],
            )
        except (OSError, ValueError):
            pass

        return {
            "deleted_artifact_ids": sorted(removed_ids),
            "source_path": target.source_path,
            "removed_deck_ids": sorted(orphan_decks),
        }

    # -- ingest -----------------------------------------------------------

    def add_raw_file(self, course_id: str, filename: str, data: bytes) -> tuple[str, Path]:
        """Store an upload byte for byte. Does not register it on the Course.

        The id is derived from the CONTENT, not randomly, so dropping the same
        deck in twice yields the same file_id, the same deck_id, and therefore
        the same deck — `register_file` and `add_deck` both replace by id. A
        student who drags a PDF in a second time re-files it rather than paying
        to explain a duplicate copy of every slide.
        """
        file_id = hashlib.sha256(data).hexdigest()[:12]
        name = safe_filename(filename)
        path = self._within(course_id, "raw", f"{file_id}__{name}")
        atomic_write_bytes(path, data)
        return file_id, path

    def add_raw_artifact(self, course_id: str, filename: str, data: bytes) -> tuple[str, Path]:
        """Store one canonical byte copy keyed by the full SHA-256 digest."""
        content_hash = hashlib.sha256(data).hexdigest()
        suffix = Path(safe_filename(filename)).suffix.lower()
        path = self._within(course_id, "raw", f"{content_hash}{suffix}")
        if not path.is_file():
            atomic_write_bytes(path, data)
        return content_hash, path

    # -- typed artifacts --------------------------------------------------

    def load_artifacts(self, course_id: str, *, include_superseded: bool = False) -> list[Artifact]:
        path = self.artifacts_path(course_id)
        if not path.is_file():
            return []
        try:
            raw = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            return []
        out: list[Artifact] = []
        for row in raw if isinstance(raw, list) else []:
            if not isinstance(row, dict):
                continue
            try:
                artifact = Artifact(
                    id=str(row["id"]), content_hash=str(row["content_hash"]),
                    filename=str(row.get("filename", "")), source_path=str(row.get("source_path", "")),
                    kind=str(row["kind"]), purpose=str(row.get("purpose", "unknown")),
                    stored_path=str(row.get("stored_path", "")), order=int(row.get("order", 0)),
                    duplicate_of=str(row.get("duplicate_of", "")), supersedes=str(row.get("supersedes", "")),
                    version=int(row.get("version", 1)), extraction_status=str(row.get("extraction_status", "done")),
                    extraction_quality=float(row.get("extraction_quality", 1.0)),
                    extraction_warnings=[str(x) for x in row.get("extraction_warnings", [])],
                    object_count=int(row.get("object_count", 0)), added_at=float(row.get("added_at", 0.0)),
                )
            except (KeyError, TypeError, ValueError):
                continue
            out.append(artifact)
        if include_superseded:
            return sorted(out, key=lambda a: (a.order, a.source_path, a.version))
        superseded = {a.supersedes for a in out if a.supersedes}
        return sorted((a for a in out if a.id not in superseded), key=lambda a: (a.order, a.source_path))

    def save_artifacts(self, course_id: str, artifacts: list[Artifact]) -> None:
        atomic_write_json(self.artifacts_path(course_id), [a.to_dict() for a in artifacts])

    def save_learning_objects(self, course_id: str, artifact_id: str, objects: list[LearningObject]) -> None:
        _check_id(artifact_id, "artifact_id")
        path = self._within(course_id, "objects", f"{artifact_id}.jsonl")
        body = "".join(json.dumps(obj.to_dict(), ensure_ascii=False) + "\n" for obj in objects)
        atomic_write_text(path, body)

    def load_learning_objects(self, course_id: str, artifact_id: str | None = None) -> list[LearningObject]:
        if artifact_id is not None:
            _check_id(artifact_id, "artifact_id")
            paths = [self._within(course_id, "objects", f"{artifact_id}.jsonl")]
        else:
            directory = self.objects_dir(course_id)
            paths = sorted(directory.glob("*.jsonl")) if directory.is_dir() else []
        out: list[LearningObject] = []
        for path in paths:
            if not path.is_file():
                continue
            for line in path.read_text("utf-8", errors="replace").splitlines():
                try:
                    row = json.loads(line)
                    loc = row.get("locator", {})
                    locator = SourceLocator(
                        artifact_id=str(loc["artifact_id"]), kind=str(loc["kind"]),
                        page=loc.get("page"), slide=loc.get("slide"), note=loc.get("note"),
                        block=loc.get("block"), sheet=str(loc.get("sheet", "")),
                        cell_range=str(loc.get("cell_range", "")), chart=str(loc.get("chart", "")),
                        notebook_cell=loc.get("notebook_cell"), output=loc.get("output"),
                        dataset_field=str(loc.get("dataset_field", "")), fragment=str(loc.get("fragment", "")),
                    )
                    out.append(LearningObject(
                        id=str(row["id"]), artifact_id=str(row["artifact_id"]),
                        object_type=str(row["object_type"]), locator=locator,
                        text=str(row.get("text", "")), data=row.get("data", {}),
                        source_version=str(row.get("source_version", "")),
                        quality=float(row.get("quality", 1.0)),
                        warnings=[str(x) for x in row.get("warnings", [])],
                    ))
                except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                    continue
        return out

    def register_file(self, course_id: str, sf: SourceFile) -> None:
        course = self.get_course(course_id)
        course.files = [f for f in course.files if f.id != sf.id]
        course.files.append(sf)
        self.save_course(course)

    def add_deck(self, course_id: str, deck: Deck) -> None:
        _check_id(deck.id, "deck_id")
        course = self.get_course(course_id)
        course.decks = [d for d in course.decks if d.id != deck.id]
        deck.order = len(course.decks)
        course.decks.append(deck)
        self.save_course(course)
        self.slides_dir(course_id, deck.id).mkdir(parents=True, exist_ok=True)

    def get_deck(self, course_id: str, deck_id: str) -> Deck:
        _check_id(deck_id, "deck_id")
        for deck in self.get_course(course_id).decks:
            if deck.id == deck_id:
                return deck
        raise KeyError(f"no such deck {deck_id!r} in course {course_id!r}")

    # -- slides -----------------------------------------------------------

    @staticmethod
    def slide_stem(index: int) -> str:
        return f"page-{index + 1:04d}"

    def slide_image_path(self, course_id: str, deck_id: str, index: int) -> Path:
        return self.slides_dir(course_id, deck_id) / f"{self.slide_stem(index)}.png"

    def slide_text_path(self, course_id: str, deck_id: str, index: int) -> Path:
        return self.slides_dir(course_id, deck_id) / f"{self.slide_stem(index)}.txt"

    def _slide(self, course_id: str, deck_id: str, index: int) -> Slide:
        img = self.slide_image_path(course_id, deck_id, index)
        txt = self.slide_text_path(course_id, deck_id, index)
        cdir = self.course_dir(course_id)
        text = ""
        if txt.is_file():
            try:
                text = txt.read_text("utf-8", errors="replace")
            except OSError:
                text = ""
        return Slide(
            deck_id=deck_id,
            index=index,
            image_path=str(img.relative_to(cdir)),
            text_path=str(txt.relative_to(cdir)),
            text=text,
        )

    def load_slides(self, course_id: str, deck_id: str) -> list[Slide]:
        sdir = self.slides_dir(course_id, deck_id)
        if not sdir.is_dir():
            return []
        indices: set[int] = set()
        for entry in sdir.iterdir():
            m = re.fullmatch(r"page-(\d{4,})\.(png|txt)", entry.name)
            if m:
                indices.add(int(m.group(1)) - 1)
        return [self._slide(course_id, deck_id, i) for i in sorted(indices)]

    def load_slide(self, course_id: str, deck_id: str, index: int) -> Slide:
        img = self.slide_image_path(course_id, deck_id, index)
        txt = self.slide_text_path(course_id, deck_id, index)
        if not img.is_file() and not txt.is_file():
            raise KeyError(f"no slide {index} in deck {deck_id!r} of {course_id!r}")
        return self._slide(course_id, deck_id, index)

    def slide_image_bytes(self, course_id: str, deck_id: str, index: int) -> bytes:
        path = self.slide_image_path(course_id, deck_id, index)
        if not path.is_file():
            raise KeyError(f"no image for slide {index} in deck {deck_id!r}")
        return path.read_bytes()

    # -- explanations -----------------------------------------------------

    def explanation_path(self, course_id: str, deck_id: str, index: int) -> Path:
        return self.explanations_dir(course_id, deck_id) / f"{index + 1:04d}.json"

    def save_explanation(self, course_id: str, exp: Explanation) -> None:
        path = self.explanation_path(course_id, exp.deck_id, exp.slide_index)
        atomic_write_json(path, exp.to_dict())

    def load_explanation(self, course_id: str, deck_id: str, index: int) -> Explanation | None:
        path = self.explanation_path(course_id, deck_id, index)
        if not path.is_file():
            return None
        try:
            return explanation_from_dict(json.loads(path.read_text("utf-8")))
        except (OSError, ValueError):
            return None

    def load_explanations(self, course_id: str, deck_id: str) -> list[Explanation]:
        edir = self.explanations_dir(course_id, deck_id)
        if not edir.is_dir():
            return []
        out: list[Explanation] = []
        for entry in sorted(edir.iterdir()):
            if not re.fullmatch(r"\d{4,}\.json", entry.name):
                continue
            try:
                out.append(explanation_from_dict(json.loads(entry.read_text("utf-8"))))
            except (OSError, ValueError):
                continue
        out.sort(key=lambda e: e.slide_index)
        return out

    # -- reference docs ---------------------------------------------------

    def ref_text_path(self, course_id: str, file_id: str) -> Path:
        _check_id(file_id, "file_id")
        return self._within(course_id, "refs", f"{file_id}.txt")

    def save_ref_text(self, course_id: str, file_id: str, text: str) -> None:
        atomic_write_text(self.ref_text_path(course_id, file_id), text)

    def load_ref_texts(self, course_id: str) -> dict[str, str]:
        rdir = self.refs_dir(course_id)
        if not rdir.is_dir():
            return {}
        out: dict[str, str] = {}
        for entry in sorted(rdir.iterdir()):
            if entry.suffix != ".txt" or not entry.is_file():
                continue
            try:
                out[entry.stem] = entry.read_text("utf-8", errors="replace")
            except OSError:
                continue
        return out

    # -- progress / resume ------------------------------------------------

    def load_progress(self, course_id: str) -> Progress:
        """Never raises on a damaged file: a fresh Progress is a valid start."""
        path = self.progress_path(course_id)
        if not path.is_file():
            return Progress()
        try:
            return progress_from_dict(json.loads(path.read_text("utf-8")))
        except (OSError, ValueError, UnicodeDecodeError):
            return Progress()

    def save_progress(self, course_id: str, p: Progress) -> None:
        import time

        p.updated_at = time.time()
        atomic_write_json(self.progress_path(course_id), p.to_dict())


__all__ = [
    "CourseStore", "slugify", "safe_filename",
    "atomic_write_bytes", "atomic_write_text", "atomic_write_json",
    "course_from_dict", "deck_from_dict", "source_file_from_dict",
    "explanation_from_dict", "progress_from_dict",
]
