"""Frozen interface contract for Lecture Companion.

READ-ONLY for builders. Every module in `app/` imports its shared types from
here so parallel work cannot drift. Changing this file requires an orchestrator
decision recorded in RUNLOG.md.

Layout on disk (all user data lives under COURSES_ROOT, which is gitignored):

    Courses/<course_id>/
      course.json                  Course, serialised
      raw/<file_id>__<name>        the uploaded original, byte for byte
      slides/<deck_id>/page-0001.png
      slides/<deck_id>/page-0001.txt
      refs/<file_id>.txt           extracted plain text of a reference doc
      explanations/<deck_id>/0001.json
      progress.json                Progress, serialised
      index.jsonl                  one IndexRow per line

Invariant 1 (course isolation) is enforced structurally: nothing outside
`Courses/<course_id>/` is ever read while serving that course.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Iterable, Literal, Optional, Protocol, Sequence
import time

# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEEPSEEK_VISION_MODEL = "deepseek-v4-flash-vision-exp"

#: OS keyring service + account under which the API key is stored.
KEYRING_SERVICE = "lecture-companion"
KEYRING_ACCOUNT = "deepseek-api-key"

#: Local retrieval model. 384-dim, retrieval-trained, needs query:/passage:
#: prefixes. See RUNLOG round 1 for the sourcing.
EMBED_MODEL = "intfloat/multilingual-e5-small"
EMBED_DIM = 384

#: DeepSeek vision limits (api-docs.deepseek.com/guides/vision/): 8192 px per
#: side, 32 MiB per image, 48 MiB per request body. We render well under these.
SLIDE_RENDER_SCALE = 2.0          # 2x of the PDF's native 72dpi box
SLIDE_MAX_PX = 2000               # longest side, after render
IMAGE_DETAIL = "high"

FileRole = Literal["slides", "reference"]
PipelineState = Literal["idle", "running", "paused", "done", "error"]

# --------------------------------------------------------------------------
# Value types
# --------------------------------------------------------------------------


def _now() -> float:
    return time.time()


@dataclass
class SourceFile:
    """One uploaded original, filed into exactly one course."""
    id: str
    filename: str
    role: FileRole
    stored_path: str              # relative to the course dir, e.g. "raw/ab12__w1.pdf"
    classified_by: str = ""       # short human-readable reason, for the UI
    added_at: float = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Deck:
    """A slide deck extracted from one `slides`-role SourceFile."""
    id: str
    source_file_id: str
    title: str
    n_slides: int
    order: int = 0                # reading order within the course

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Course:
    """A sealed container. Nothing crosses this boundary."""
    id: str                       # slug, also the directory name
    title: str
    created_at: float = field(default_factory=_now)
    overview: str = ""            # distilled from reference docs; "" if none yet
    overview_source_ids: list[str] = field(default_factory=list)
    files: list[SourceFile] = field(default_factory=list)
    decks: list[Deck] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Slide:
    """One rendered page. `image_path`/`text_path` are course-relative."""
    deck_id: str
    index: int                    # 0-based within the deck
    image_path: str
    text_path: str
    text: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Explanation:
    """The generated artifact for one slide."""
    deck_id: str
    slide_index: int
    body: str                     # plain-language markdown, the main text
    example: str = ""             # concrete example; "" when none fits
    mermaid: str = ""             # mermaid source; "" when a diagram does not help
    heading: str = ""             # short title for the slide
    model: str = ""
    context_used: list[str] = field(default_factory=list)  # chunk_ids retrieved
    created_at: float = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class IndexRow:
    """One row of the per-course vector index (`index.jsonl`)."""
    chunk_id: str                 # f"{deck_id}:{slide_index}"
    deck_id: str
    slide_index: int
    text: str                     # the text that was embedded
    vec: list[float]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Progress:
    """Per-course checkpoint. The single source of truth for resume.

    `done` maps deck_id -> sorted list of slide indices that have a stored
    explanation. `running_summary` is recomputed only from processed slides,
    so a partial course stays coherent (invariant 5).
    """
    running_summary: str = ""
    done: dict[str, list[int]] = field(default_factory=dict)
    state: PipelineState = "idle"
    pause_reason: str = ""
    cursor_deck_id: str = ""
    cursor_slide_index: int = 0
    updated_at: float = field(default_factory=_now)

    def is_done(self, deck_id: str, slide_index: int) -> bool:
        return slide_index in self.done.get(deck_id, ())

    def mark_done(self, deck_id: str, slide_index: int) -> None:
        lst = self.done.setdefault(deck_id, [])
        if slide_index not in lst:
            lst.append(slide_index)
            lst.sort()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SlideContext:
    """Everything assembled for one generation call. The critic reads this."""
    course_overview: str
    running_summary: str
    retrieved: list[IndexRow]
    slide_text: str
    slide_image_b64: str          # bare base64, no data: prefix
    deck_title: str
    slide_index: int
    n_slides: int


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------


class LectureCompanionError(Exception):
    """Base for every error this app raises deliberately."""


class NoApiKey(LectureCompanionError):
    """No key configured in the keyring. The UI must show the connect screen."""


class RateLimited(LectureCompanionError):
    """HTTP 429 or quota exhaustion. Callers MUST pause, never lose position."""

    def __init__(self, message: str = "rate limited", retry_after: float = 5.0):
        super().__init__(message)
        self.retry_after = retry_after


class ModelUnavailable(LectureCompanionError):
    """Network failure or a 5xx. Also a pause, not a crash."""


class BadModelOutput(LectureCompanionError):
    """The model returned something we could not parse into an Explanation."""


class ExtractionError(LectureCompanionError):
    """A source file could not be rendered or read."""


# --------------------------------------------------------------------------
# Protocols implemented by the concrete modules
# --------------------------------------------------------------------------


class Embedder(Protocol):
    """Local, offline, free. `dim` must be stable for the life of an index."""

    dim: int
    name: str

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class VisionClient(Protocol):
    """Remote generation. The only component that spends money."""

    name: str

    def explain_slide(self, ctx: SlideContext) -> Explanation:
        """Return one Explanation, or raise RateLimited / ModelUnavailable /
        BadModelOutput. Must never write the API key to a log."""
        ...

    def summarise(self, prompt: str) -> str:
        """Text-only helper, used for the course overview and running summary."""
        ...

    def test_connection(self) -> tuple[bool, str]:
        """(ok, human-readable detail). Never raises."""
        ...


class Extractor(Protocol):
    """Turns one source file into rendered pages + text."""

    def can_handle(self, path: str) -> bool: ...

    def extract(self, path: str, out_dir: str) -> list[Slide]:
        """Write page-NNNN.png and page-NNNN.txt into out_dir; return Slides
        with course-relative paths already set by the caller's convention."""
        ...


__all__ = [
    "DEEPSEEK_BASE_URL", "DEEPSEEK_VISION_MODEL", "KEYRING_SERVICE",
    "KEYRING_ACCOUNT", "EMBED_MODEL", "EMBED_DIM", "SLIDE_RENDER_SCALE",
    "SLIDE_MAX_PX", "IMAGE_DETAIL", "FileRole", "PipelineState",
    "SourceFile", "Deck", "Course", "Slide", "Explanation", "IndexRow",
    "Progress", "SlideContext",
    "LectureCompanionError", "NoApiKey", "RateLimited", "ModelUnavailable",
    "BadModelOutput", "ExtractionError",
    "Embedder", "VisionClient", "Extractor",
]
