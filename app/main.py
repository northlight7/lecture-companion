"""HTTP surface for Lecture Companion.

One FastAPI app, one background worker per course, and a static frontend in
`web/`. Every route that names a course validates the id through
`CourseStore.exists()` first, so a path parameter never reaches the filesystem
unchecked (invariant 1).

Invariant 4 is enforced here by omission: the only key-shaped value any handler
may put in a response is `keystore.key_hint()`, which is masked. Request bodies
are never logged, and `/api/connection` is excluded from path logging entirely.
"""

from __future__ import annotations

import base64
import binascii
from io import BytesIO
import logging
import threading
import zipfile
from typing import Any, Callable

from fastapi import FastAPI, Request, UploadFile, File, Body, Query
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image as PILImage, UnidentifiedImageError

from app import config
from app.contracts import (
    Course,
    NoApiKey,
    Progress,
    RateLimited,
    ModelUnavailable,
    LectureCompanionError,
    DEEPSEEK_VISION_MODEL,
)

log = logging.getLogger("lecture_companion.api")

app = FastAPI(title="Lecture Companion", docs_url=None, redoc_url=None)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _store():
    """Imported lazily so a partially-written sibling cannot break import."""
    from app.course import CourseStore

    return CourseStore(config.courses_root())


def _err(status: int, message: str) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status)


def _course_or_404(cid: str):
    """Return (store, course) or a JSONResponse 404. Never touches the FS with
    a raw path parameter: `exists()` does the id hygiene."""
    store = _store()
    if not store.exists(cid):
        return store, None
    try:
        return store, store.get_course(cid)
    except (KeyError, ValueError):
        return store, None


def _counts(store, course: Course) -> tuple[int, int]:
    """(n_slides, n_explained) for a whole course, read from disk."""
    n_slides = sum(max(0, d.n_slides) for d in course.decks)
    progress = store.load_progress(course.id)
    known = {d.id for d in course.decks}
    n_explained = sum(
        len([i for i in idxs if 0 <= i])
        for did, idxs in progress.done.items()
        if did in known
    )
    return n_slides, n_explained


def _course_row(store, course: Course) -> dict[str, Any]:
    n_slides, n_explained = _counts(store, course)
    return {
        "id": course.id,
        "title": course.title,
        "n_decks": len(course.decks),
        "n_slides": n_slides,
        "n_explained": n_explained,
        "state": _display_state(store, course, n_slides, n_explained),
    }


def _display_state(store, course: Course, n_slides: int, n_explained: int) -> str:
    """The state to SHOW, which is not always the stored one.

    `progress.state` records how the last run ended. Importing another deck
    afterwards adds unexplained slides without touching it, so a course that
    genuinely has work left would still show "done". Derive it from the counts
    instead, and only trust the stored value where the counts cannot tell
    (paused vs merely stopped, and errors).
    """
    stored = store.load_progress(course.id).state
    if course.id in _running_ids():
        return "running"
    if stored in ("paused", "error"):
        return stored
    if n_slides and n_explained >= n_slides:
        return "done"
    if n_explained:
        return "partial"
    return "idle"


def _progress_dict(store, course: Course) -> dict[str, Any]:
    p = store.load_progress(course.id)
    n_slides, n_explained = _counts(store, course)
    d = p.to_dict()
    d["n_slides"] = n_slides
    d["n_explained"] = n_explained
    d["running"] = course.id in _running_ids()
    return d


# --------------------------------------------------------------------------
# background workers  (one per course, cooperative pause)
# --------------------------------------------------------------------------


class _Stopped(Exception):
    """Raised inside the worker's progress callback to request a checkpoint."""


class Worker:
    def __init__(self, course_id: str) -> None:
        self.course_id = course_id
        self.stop = threading.Event()
        self.thread: threading.Thread | None = None
        self.error: str = ""


_workers: dict[str, Worker] = {}
_workers_lock = threading.Lock()


def _running_ids() -> set[str]:
    with _workers_lock:
        return {
            cid
            for cid, w in _workers.items()
            if w.thread is not None and w.thread.is_alive()
        }


def _reap(cid: str) -> None:
    with _workers_lock:
        w = _workers.get(cid)
        if w is not None and (w.thread is None or not w.thread.is_alive()):
            _workers.pop(cid, None)


def _run_course(cid: str, deck_id: str | None, worker: Worker) -> None:
    """Thread body. Everything it can raise becomes a stored Progress state."""
    from app.course import CourseStore
    from app.embed import get_embedder
    from app.llm import get_client
    from app.pipeline import process_course

    store = CourseStore(config.courses_root())

    def on_progress(*args: Any, **kwargs: Any) -> None:
        if worker.stop.is_set():
            raise _Stopped()

    def _pause(reason: str, state: str = "paused") -> None:
        p = store.load_progress(cid)
        p.state = state  # type: ignore[assignment]
        p.pause_reason = reason
        store.save_progress(cid, p)

    try:
        client = get_client()
        embedder = get_embedder()
        process_course(
            store, cid, client, embedder, deck_id=deck_id, on_progress=on_progress
        )
    except _Stopped:
        _pause("Paused. It will resume from the first slide that is not explained yet.")
    except NoApiKey:
        _pause("No API key configured. Open Connect and paste your DeepSeek key.")
    except RateLimited as exc:
        _pause(f"Rate limited by DeepSeek ({exc}). Resume when the limit clears.")
    except ModelUnavailable as exc:
        _pause(f"The model was unreachable ({exc}). Resume to try again.")
    except LectureCompanionError as exc:
        worker.error = str(exc)
        _pause(f"Stopped: {exc}", state="error")
    except Exception as exc:  # noqa: BLE001 - a worker must never die silently
        worker.error = f"{type(exc).__name__}: {exc}"
        log.exception("worker for course %s failed", cid)
        _pause(f"Stopped: {type(exc).__name__}: {exc}", state="error")
    finally:
        _reap(cid)


# --------------------------------------------------------------------------
# request logging  (paths only, never bodies)
# --------------------------------------------------------------------------


@app.middleware("http")
async def _log_paths(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    # /api/connection carries the key in its body. Log nothing but the verb.
    if path == "/api/connection":
        log.info("%s /api/connection -> %s", request.method, response.status_code)
    else:
        log.info("%s %s -> %s", request.method, path, response.status_code)
    return response


@app.exception_handler(NoApiKey)
async def _no_key(request: Request, exc: NoApiKey):
    return _err(428, "No DeepSeek API key is configured. Open the Connect screen.")


@app.exception_handler(RateLimited)
async def _rate_limited(request: Request, exc: RateLimited):
    return _err(429, f"Rate limited. Retry in about {int(exc.retry_after)}s.")


@app.exception_handler(LectureCompanionError)
async def _lc_error(request: Request, exc: LectureCompanionError):
    return _err(500, str(exc))


# --------------------------------------------------------------------------
# health + connection
# --------------------------------------------------------------------------


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/connection")
def get_connection() -> dict[str, Any]:
    from app import keystore

    fake = config.fake_model()
    return {
        "connected": bool(fake or keystore.has_key()),
        "hint": keystore.key_hint(),
        "model": DEEPSEEK_VISION_MODEL,
        "fake": fake,
    }


@app.post("/api/connection")
def post_connection(payload: dict = Body(default={})):
    from app import keystore
    from app.llm import DeepSeekClient

    api_key = payload.get("api_key") if isinstance(payload, dict) else None
    if not isinstance(api_key, str) or not api_key.strip():
        return _err(400, "Paste your DeepSeek API key first.")
    api_key = api_key.strip()

    try:
        ok, detail = DeepSeekClient(api_key).test_connection()
    except Exception as exc:  # noqa: BLE001 - never let a key reach a traceback
        ok, detail = False, f"Could not reach DeepSeek: {type(exc).__name__}"

    if ok:
        keystore.set_key(api_key)
    del api_key
    return {"connected": bool(ok), "detail": detail, "hint": keystore.key_hint()}


@app.delete("/api/connection")
def delete_connection() -> dict[str, Any]:
    from app import keystore

    keystore.clear_key()
    return {"connected": False, "hint": "", "detail": "Key removed from the keyring."}


# --------------------------------------------------------------------------
# courses
# --------------------------------------------------------------------------


@app.get("/api/courses")
def list_courses() -> list[dict[str, Any]]:
    store = _store()
    return [_course_row(store, c) for c in store.list_courses()]


@app.post("/api/courses")
def create_course(payload: dict = Body(default={})):
    title = payload.get("title") if isinstance(payload, dict) else None
    if not isinstance(title, str) or not title.strip():
        return _err(400, "A course needs a title.")
    store = _store()
    course = store.create_course(title.strip())
    return _course_row(store, course)


@app.get("/api/courses/{cid}")
def get_course(cid: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    row = _course_row(store, course)
    progress = store.load_progress(cid)
    decks = []
    for deck in sorted(course.decks, key=lambda d: d.order):
        done = progress.done.get(deck.id, [])
        decks.append(
            {
                "id": deck.id,
                "title": deck.title,
                "n_slides": deck.n_slides,
                "n_explained": len(done),
            }
        )
    row["overview"] = course.overview
    row["decks"] = decks
    row["files"] = [
        {"id": f.id, "filename": f.filename, "role": f.role, "reason": f.classified_by}
        for f in course.files
    ]
    row["artifacts"] = [a.to_dict() for a in store.load_artifacts(cid)]
    row["progress"] = _progress_dict(store, course)
    return row


@app.delete("/api/courses/{cid}")
def delete_course(cid: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    if cid in _running_ids():
        return _err(409, "That course is still processing. Pause it first.")
    store.delete_course(cid)
    return {"deleted": cid}


# --------------------------------------------------------------------------
# import
# --------------------------------------------------------------------------


async def _read_uploads(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    out: list[tuple[str, bytes]] = []
    for f in files:
        out.append((f.filename or "upload", await f.read()))
    return out


def _filed_rows(result) -> list[dict[str, Any]]:
    return [
        {
            "filename": item.filename,
            "file_id": item.file_id,
            "role": item.role,
            "reason": item.reason,
            "deck_id": item.deck_id,
            "n_slides": item.n_slides,
            "artifact_id": item.artifact_id,
            "kind": item.kind,
            "source_path": item.source_path,
            "object_count": item.object_count,
            "status": item.status,
        }
        for item in result.filed
    ]


@app.post("/api/courses/{cid}/files")
async def upload_files(cid: str, files: list[UploadFile] = File(default=[])):
    from app.importer import import_files

    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    if not files:
        return _err(400, "No files were uploaded.")

    result = import_files(store, cid, await _read_uploads(files))

    overview_refreshed = False
    try:
        from app.llm import get_client
        from app.overview import refresh_overview_if_needed

        overview_refreshed = bool(refresh_overview_if_needed(store, cid, get_client()))
    except NoApiKey:
        overview_refreshed = False
    except Exception as exc:  # noqa: BLE001 - the import itself already succeeded
        log.warning("overview refresh failed for %s: %s", cid, type(exc).__name__)

    course = store.get_course(cid)
    return {
        "filed": _filed_rows(result),
        "errors": list(getattr(result, "errors", []) or []),
        "overview_refreshed": overview_refreshed,
        "course": _course_row(store, course),
    }


@app.get("/api/courses/{cid}/artifacts")
def list_artifacts(cid: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    return [artifact.to_dict() for artifact in store.load_artifacts(cid)]


@app.get("/api/courses/{cid}/artifacts/{aid}/objects")
def list_artifact_objects(
    cid: str, aid: str, offset: int = Query(0, ge=0), limit: int | None = Query(None, ge=1, le=1000)
):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    if aid not in {artifact.id for artifact in store.load_artifacts(cid)}:
        return _err(404, f"No artifact {aid!r} in {cid!r}.")
    objects = store.load_learning_objects(cid, aid)
    selected = objects[offset:] if limit is None else objects[offset:offset + limit]
    return [obj.to_dict() for obj in selected]


@app.get("/api/courses/{cid}/artifacts/{aid}/view")
def artifact_view(
    cid: str, aid: str, sheet: str = "", offset: int = Query(0, ge=0),
    limit: int = Query(300, ge=1, le=500),
):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    artifact = next((a for a in store.load_artifacts(cid) if a.id == aid), None)
    if artifact is None:
        return _err(404, f"No artifact {aid!r} in {cid!r}.")
    all_objects = store.load_learning_objects(cid, aid)
    sheets = [obj.locator.sheet for obj in all_objects if obj.object_type == "sheet"]
    chosen_sheet = sheet if sheet in sheets else (sheets[0] if sheets else "")
    visible = all_objects
    if artifact.kind == "xlsx" and chosen_sheet:
        visible = [
            obj for obj in all_objects
            if obj.locator.sheet == chosen_sheet or obj.object_type == "package_part"
        ]
    effective_limit = min(limit, 20) if artifact.kind in ("pdf", "pptx") else limit
    page = visible[offset:offset + effective_limit]
    return {
        "artifact": artifact.to_dict(), "sheets": sheets, "selected_sheet": chosen_sheet,
        "objects": [obj.to_dict() for obj in page], "total_objects": len(visible),
        "offset": offset, "limit": effective_limit,
        "has_more": offset + effective_limit < len(visible),
    }


@app.get("/api/courses/{cid}/artifacts/{aid}/objects/{oid}")
def get_artifact_object(cid: str, aid: str, oid: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    if aid not in {artifact.id for artifact in store.load_artifacts(cid)}:
        return _err(404, f"No artifact {aid!r} in {cid!r}.")
    for obj in store.load_learning_objects(cid, aid):
        if obj.id == oid:
            return obj.to_dict()
    return _err(404, f"No learning object {oid!r} in {aid!r}.")


@app.get("/api/courses/{cid}/artifacts/{aid}/render/{number}")
def artifact_render(cid: str, aid: str, number: int):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    artifact = next((a for a in store.load_artifacts(cid) if a.id == aid), None)
    if artifact is None:
        return _err(404, f"No artifact {aid!r} in {cid!r}.")
    try:
        path = store.artifact_render_path(cid, artifact, number)
    except ValueError:
        return _err(404, "No such rendered page.")
    if not path.is_file():
        return _err(404, "No such rendered page.")
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@app.get("/api/courses/{cid}/artifacts/{aid}/objects/{oid}/media")
def artifact_object_media(cid: str, aid: str, oid: str):
    """Serve a preserved embedded raster without copying it outside its course."""
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    artifact = next((a for a in store.load_artifacts(cid) if a.id == aid), None)
    if artifact is None:
        return _err(404, f"No artifact {aid!r} in {cid!r}.")
    obj = next((item for item in store.load_learning_objects(cid, aid) if item.id == oid), None)
    if obj is None:
        return _err(404, f"No learning object {oid!r} in {aid!r}.")
    allowed = {"image/png", "image/jpeg", "image/gif", "image/webp"}
    data: bytes | None = None
    media_type = ""
    if artifact.kind == "docx" and obj.object_type == "image":
        media_type = str(obj.data.get("content_type", ""))
        member = str(obj.data.get("part_name", "")).lstrip("/")
        source = (store.course_dir(cid) / artifact.stored_path).resolve()
        if media_type in allowed and member.startswith("word/media/") and store.course_dir(cid) in source.parents:
            try:
                with zipfile.ZipFile(source) as package:
                    info = package.getinfo(member)
                    data = package.read(info) if info.file_size <= 32 * 1024 * 1024 else None
            except (OSError, KeyError, zipfile.BadZipFile):
                data = None
    elif artifact.kind == "ipynb" and obj.object_type == "notebook_output":
        bundle = obj.data.get("data", {})
        if isinstance(bundle, dict):
            for candidate in ("image/png", "image/jpeg", "image/gif", "image/webp"):
                encoded = bundle.get(candidate)
                if isinstance(encoded, list):
                    encoded = "".join(str(part) for part in encoded)
                if isinstance(encoded, str) and len(encoded) <= 45 * 1024 * 1024:
                    try:
                        data = base64.b64decode(encoded, validate=True)
                        media_type = candidate
                    except (ValueError, binascii.Error):
                        data = None
                    break
    if not data or len(data) > 32 * 1024 * 1024 or media_type not in allowed:
        return _err(404, "No supported embedded image for this object.")
    expected_formats = {
        "image/png": "PNG", "image/jpeg": "JPEG", "image/gif": "GIF", "image/webp": "WEBP",
    }
    try:
        with PILImage.open(BytesIO(data)) as image:
            image.verify()
            if image.format != expected_formats[media_type]:
                return _err(404, "Embedded image type does not match its content.")
    except (OSError, ValueError, UnidentifiedImageError):
        return _err(404, "Embedded image content is invalid.")
    return Response(
        content=data, media_type=media_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )


@app.get("/api/courses/{cid}/artifacts/{aid}/original")
def artifact_original(cid: str, aid: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    artifact = next((a for a in store.load_artifacts(cid) if a.id == aid), None)
    if artifact is None:
        return _err(404, f"No artifact {aid!r} in {cid!r}.")
    path = store.course_dir(cid) / artifact.stored_path
    if not path.is_file() or store.course_dir(cid) not in path.resolve().parents:
        return _err(404, "Original file is unavailable.")
    return FileResponse(path, filename=artifact.filename)


@app.post("/api/courses/{cid}/questions")
def ask_selected_question(cid: str, payload: dict = Body(default={})):
    from app.llm import get_client
    from app.questions import MAX_SELECTIONS, answer_selected

    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    question = payload.get("question", "") if isinstance(payload, dict) else ""
    selections = payload.get("selections", []) if isinstance(payload, dict) else []
    if not isinstance(question, str) or not question.strip():
        return _err(400, "A question is required.")
    if not isinstance(selections, list) or not 1 <= len(selections) <= MAX_SELECTIONS:
        return _err(400, f"Select between 1 and {MAX_SELECTIONS} source objects.")
    artifact_ids = {artifact.id for artifact in store.load_artifacts(cid)}
    objects = []
    for selection in selections:
        if not isinstance(selection, dict):
            return _err(400, "Every selection needs an artifact and object id.")
        aid = str(selection.get("artifact_id", ""))
        oid = str(selection.get("object_id", ""))
        if aid not in artifact_ids:
            return _err(404, "A selected source does not belong to this course.")
        obj = next((item for item in store.load_learning_objects(cid, aid) if item.id == oid), None)
        if obj is None:
            return _err(404, "A selected source object was not found in this course.")
        objects.append(obj)
    return answer_selected(question, objects, get_client())


@app.get("/api/courses/{cid}/knowledge/status")
def knowledge_status(cid: str):
    from app.knowledge import index_status

    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    return index_status(store, cid)


@app.post("/api/courses/{cid}/knowledge/rebuild")
def rebuild_course_knowledge(cid: str):
    from app.knowledge import build_index

    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    return build_index(store, cid)


@app.get("/api/courses/{cid}/search")
def search_course(cid: str, q: str = Query("", max_length=500), limit: int = Query(20, ge=1, le=50)):
    from app.knowledge import search

    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    try:
        return search(store, cid, q, limit)
    except ValueError as exc:
        return _err(400, str(exc))


@app.get("/api/courses/{cid}/concepts")
def course_concepts(
    cid: str, q: str = Query("", max_length=200), limit: int = Query(18, ge=1, le=40),
):
    from app.knowledge import concept_graph

    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    return concept_graph(store, cid, q, limit)


@app.post("/api/import/preview")
async def import_preview(files: list[UploadFile] = File(default=[])):
    from app.importer import sort_bulk

    if not files:
        return _err(400, "No files were uploaded.")
    groups = sort_bulk(await _read_uploads(files))
    return {
        "groups": [
            {"title": g.title, "filenames": list(g.filenames), "reason": g.reason}
            for g in groups
        ]
    }


@app.post("/api/import/bulk")
async def import_bulk_route(files: list[UploadFile] = File(default=[])):
    from app.importer import import_bulk

    if not files:
        return _err(400, "No files were uploaded.")
    store = _store()
    out = []
    for course, result in import_bulk(store, await _read_uploads(files)):
        out.append(
            {
                "course": _course_row(store, store.get_course(course.id)),
                "filed": _filed_rows(result),
                "errors": list(getattr(result, "errors", []) or []),
            }
        )
    return {"courses": out}


# --------------------------------------------------------------------------
# slides
# --------------------------------------------------------------------------


@app.get("/api/courses/{cid}/decks/{did}/slides")
def list_slides(cid: str, did: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    if did not in {d.id for d in course.decks}:
        return _err(404, f"No deck {did!r} in {cid!r}.")
    try:
        slides = store.load_slides(cid, did)
    except ValueError:
        return _err(404, f"No deck {did!r} in {cid!r}.")
    rows = []
    for slide in slides:
        exp = store.load_explanation(cid, did, slide.index)
        rows.append(
            {
                "index": slide.index,
                "has_explanation": exp is not None,
                "heading": (exp.heading if exp else ""),
            }
        )
    return rows


@app.get("/api/courses/{cid}/decks/{did}/slides/{i}/image")
def slide_image(cid: str, did: str, i: int):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    if did not in {d.id for d in course.decks}:
        return _err(404, f"No deck {did!r} in {cid!r}.")
    try:
        data = store.slide_image_bytes(cid, did, i)
    except (KeyError, ValueError, OSError):
        return _err(404, f"No image for slide {i}.")
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/api/courses/{cid}/decks/{did}/slides/{i}")
def get_slide(cid: str, did: str, i: int):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    if did not in {d.id for d in course.decks}:
        return _err(404, f"No deck {did!r} in {cid!r}.")
    try:
        slide = store.load_slide(cid, did, i)
    except (KeyError, ValueError):
        return _err(404, f"No slide {i} in deck {did!r}.")
    exp = store.load_explanation(cid, did, i)
    return {
        "slide": {"index": slide.index, "text": slide.text},
        "explanation": exp.to_dict() if exp else None,
    }


# --------------------------------------------------------------------------
# processing
# --------------------------------------------------------------------------


@app.post("/api/courses/{cid}/process")
def start_process(cid: str, payload: dict = Body(default={})):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")

    deck_id = payload.get("deck_id") if isinstance(payload, dict) else None
    if deck_id is not None and not isinstance(deck_id, str):
        return _err(400, "deck_id must be a string or null.")
    if deck_id and deck_id not in {d.id for d in course.decks}:
        return _err(404, f"No deck {deck_id!r} in {cid!r}.")

    if not config.fake_model():
        from app import keystore

        if not keystore.has_key():
            return _err(
                428, "No DeepSeek API key is configured. Open the Connect screen."
            )

    with _workers_lock:
        existing = _workers.get(cid)
        if existing is not None and existing.thread is not None and existing.thread.is_alive():
            return _err(409, "That course is already processing.")
        worker = Worker(cid)
        _workers[cid] = worker

    progress = store.load_progress(cid)
    progress.state = "running"
    progress.pause_reason = ""
    store.save_progress(cid, progress)

    worker.thread = threading.Thread(
        target=_run_course, args=(cid, deck_id or None, worker), daemon=True,
        name=f"lc-worker-{cid}",
    )
    worker.thread.start()
    return {"started": True, "state": "running"}


@app.post("/api/courses/{cid}/pause")
def pause_process(cid: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    with _workers_lock:
        worker = _workers.get(cid)
    if worker is not None:
        worker.stop.set()
        thread = worker.thread
        if thread is not None:
            thread.join(timeout=20.0)
    else:
        p = store.load_progress(cid)
        if p.state == "running":
            p.state = "paused"
            p.pause_reason = "Paused. It resumes from the first unexplained slide."
            store.save_progress(cid, p)
    return _progress_dict(store, store.get_course(cid))


@app.get("/api/courses/{cid}/progress")
def get_progress(cid: str):
    store, course = _course_or_404(cid)
    if course is None:
        return _err(404, f"No course {cid!r}.")
    return _progress_dict(store, course)


# --------------------------------------------------------------------------
# static frontend
# --------------------------------------------------------------------------


@app.get("/")
def index():
    path = config.WEB_DIR / "index.html"
    if not path.is_file():
        return _err(500, "web/index.html is missing.")
    return FileResponse(path, media_type="text/html")


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)


if config.WEB_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(config.WEB_DIR)), name="static")


__all__ = ["app"]
