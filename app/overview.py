"""The course overview: the one piece of context every explanation sees.

Distilled from the course's own reference documents (syllabus, programme
requirements) and from nothing else. `build_overview` reads
`store.load_ref_texts(course_id)` and no other course's anything, which is how
invariant 1 holds here.

Every explanation is supposed to reference the overview (gate G5), so a course
with no reference docs still gets one: `fallback_overview` derives a modest,
clearly-hedged summary from the deck titles and the opening slides.

**The course screen no longer renders an overview**, and nothing builds one
automatically any more: importing a file used to spend a model call here and
that call bought nothing a reader saw. `build_overview` is still what
`POST /api/courses/{cid}/overview/regenerate` distils on request, and every
overview already on disk is left untouched, because it is the reader's data and
this was a UI decision rather than a data one.
"""

from __future__ import annotations

import logging

from app.contracts import LectureCompanionError
from app.llm import CONTENT_MARKER

log = logging.getLogger(__name__)

#: Per-reference-document budget, in words. A syllabus is a few pages; a
#: programme handbook can be fifty, and the tail of it is boilerplate.
REF_WORD_BUDGET = 1800
#: Ceiling across every reference document together.
TOTAL_REF_WORD_BUDGET = 6000

OVERVIEW_INSTRUCTIONS = """\
Below are the reference documents for one university course (a syllabus, and \
possibly programme requirements). Write a short overview of this course for a \
new MSc student who is about to work through its slides.

Write 90 to 140 words. Cover what the course is about and the main topics it \
covers, and nothing else.

Use only what these documents say. If they are thin, write a short overview of \
what they do say rather than a long one about what they do not. Never list \
what is missing, never describe the documents themselves, and never speculate \
about assessment or learning outcomes that are not stated. A three-sentence \
overview of a course with a sparse syllabus is the correct answer.

Plain prose, no headings, no bullet list."""


def build_overview(store, course_id: str, client) -> str:
    """Distil the overview from this course's reference documents.

    Returns `fallback_overview(...)` when there are no reference docs, or when
    the model gives back nothing usable. Never returns an empty string.
    """
    return _build_overview(store, course_id, client)[0]


def _truncate_words(text: str, limit: int) -> str:
    words = (text or "").split()
    if len(words) <= limit:
        return (text or "").strip()
    return " ".join(words[:limit]) + " [...]"


def _build_overview(store, course_id: str, client) -> tuple[str, bool]:
    """As `build_overview`, but also reports whether it fell back.

    The caller needs to know: a fallback caused by a transient model failure
    must stay retryable, or one bad response would leave a course that HAS a
    syllabus permanently claiming it has none.
    """
    refs = store.load_ref_texts(course_id)
    if not refs:
        return fallback_overview(store, course_id), True

    blocks: list[str] = []
    spent = 0
    for file_id, text in sorted(refs.items()):
        remaining = TOTAL_REF_WORD_BUDGET - spent
        if remaining <= 0:
            break
        chunk = _truncate_words(text, min(REF_WORD_BUDGET, remaining))
        if not chunk.strip():
            continue
        spent += len(chunk.split())
        blocks.append(f"### Reference document {file_id}\n{chunk}")

    if not blocks:
        return fallback_overview(store, course_id), True

    prompt = OVERVIEW_INSTRUCTIONS + CONTENT_MARKER + "\n\n".join(blocks)
    try:
        summary = (client.summarise(prompt) or "").strip()
    except LectureCompanionError as exc:
        log.warning("overview generation failed for %s: %s", course_id, exc)
        return fallback_overview(store, course_id), True
    if not summary:
        log.warning(
            "overview model returned nothing usable for %s; using the "
            "fallback and leaving it retryable",
            course_id,
        )
        return fallback_overview(store, course_id), True
    return summary, False


def refresh_overview_if_needed(store, course_id: str, client) -> bool:
    """Rebuild the overview when the set of reference files has changed.

    Returns True when it rebuilt and saved. The comparison is on the set of
    reference `file_id`s, so re-importing the same syllabus is free but adding
    a programme handbook triggers a rebuild.

    No longer called from the import path: the overview left the course screen,
    so an import does not spend a model call on one. It is kept because the rule
    it encodes is a real one and is pinned by `tests/test_overview_retry.py`:
    a fallback caused by a transient model failure must stay retryable, so the
    reference ids are only recorded as consumed when the model actually distilled
    them. Anything that rebuilds an overview automatically belongs here rather
    than beside it.
    """
    course = store.get_course(course_id)
    ref_ids = sorted(store.load_ref_texts(course_id).keys())
    current = sorted(course.overview_source_ids or [])
    if ref_ids == current and (course.overview or "").strip():
        return False

    overview, fell_back = _build_overview(store, course_id, client)
    course.overview = overview
    # Only claim these refs as "consumed" when the model actually distilled
    # them. On a fallback we leave the ids unrecorded so the next import, or
    # the next explicit refresh, tries again instead of leaving the course
    # permanently describing itself as having no syllabus.
    course.overview_source_ids = [] if fell_back else ref_ids
    store.save_course(course)
    return True


def fallback_overview(store, course_id: str) -> str:
    """A short, honest note for a course with no reference documents.

    Hedged on purpose: it says where it came from, so neither the student nor
    the model mistakes it for a syllabus. It is never empty, because every
    explanation is meant to reference the overview.

    It deliberately does NOT summarise the slides. That was tried, and it
    produced 400 words of concatenated slide text at the top of the course
    page, which is the slide content the reader is about to read anyway. The
    deck list and the count are enough to orient them.
    """
    try:
        course = store.get_course(course_id)
    except KeyError:
        return "No reference documents have been provided for this course."

    title = (course.title or course_id).strip()
    decks = sorted(course.decks, key=lambda d: (d.order, d.id))
    if not decks:
        return (
            f"No reference documents have been provided for {title}, and no "
            "slide decks have been imported yet."
        )

    total = sum(d.n_slides for d in decks)
    names = ", ".join(d.title or d.id for d in decks)
    return (
        f"No syllabus or programme document was provided for {title}, so this "
        f"description is drawn from the imported material alone. The course "
        f"holds {len(decks)} decks and about {total} slides, in this order: "
        f"{names}. Drop the syllabus in and it can be described properly."
    )


__all__ = [
    "build_overview",
    "refresh_overview_if_needed",
    "fallback_overview",
    "REF_WORD_BUDGET",
    "TOTAL_REF_WORD_BUDGET",
]
