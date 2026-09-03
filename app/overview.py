"""The course overview: the one piece of context every explanation sees.

Distilled from the course's own reference documents (syllabus, programme
requirements) and from nothing else. `build_overview` reads
`store.load_ref_texts(course_id)` and no other course's anything, which is how
invariant 1 holds here.

Every explanation is supposed to reference the overview (gate G5), so a course
with no reference docs still gets one: `fallback_overview` derives a modest,
clearly-hedged summary from the deck titles and the opening slides.
"""

from __future__ import annotations

import logging

from app.contracts import LectureCompanionError
from app.llm import CONTENT_MARKER

log = logging.getLogger(__name__)

#: Per-reference-document budget, in words. A syllabus is a few pages; a
#: programme handbook can be fifty, and the tail of it is boilerplate.
REF_WORD_BUDGET = 1800
#: Total across all reference docs, so ten refs cannot blow the request.
TOTAL_REF_WORD_BUDGET = 6000
#: Slides consulted per deck when there are no reference docs at all.
FALLBACK_SLIDES_PER_DECK = 3
FALLBACK_SLIDE_WORDS = 60

OVERVIEW_INSTRUCTIONS = """\
Below are the reference documents for one university course (a syllabus, and \
possibly programme requirements). Write a 200-400 word overview of this course \
for a new MSc student who is about to work through its slides.

Cover, in this order:
1. What the course is about, in one or two plain sentences.
2. The main topics, in the order the course covers them.
3. What a student is expected to be able to do by the end.
4. How the course is assessed.

Use ONLY what these documents say. Where they are silent, say so briefly \
rather than inventing detail. Plain prose, no headings, no bullet list."""


def _truncate_words(text: str, limit: int) -> str:
    words = (text or "").split()
    if len(words) <= limit:
        return (text or "").strip()
    return " ".join(words[:limit]) + " [...]"


def build_overview(store, course_id: str, client) -> str:
    """Distil the overview from this course's reference documents.

    Returns `fallback_overview(...)` when there are no reference docs, or when
    the model gives back nothing usable. Never returns an empty string.
    """
    refs = store.load_ref_texts(course_id)
    if not refs:
        return fallback_overview(store, course_id)

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
        return fallback_overview(store, course_id)

    prompt = OVERVIEW_INSTRUCTIONS + CONTENT_MARKER + "\n\n".join(blocks)
    try:
        summary = (client.summarise(prompt) or "").strip()
    except LectureCompanionError as exc:
        log.warning("overview generation failed for %s: %s", course_id, exc)
        return fallback_overview(store, course_id)
    if not summary:
        return fallback_overview(store, course_id)
    return summary


def refresh_overview_if_needed(store, course_id: str, client) -> bool:
    """Rebuild the overview when the set of reference files has changed.

    Returns True when it rebuilt and saved. The comparison is on the set of
    reference `file_id`s, so re-importing the same syllabus is free but adding
    a programme handbook triggers a rebuild.
    """
    course = store.get_course(course_id)
    ref_ids = sorted(store.load_ref_texts(course_id).keys())
    current = sorted(course.overview_source_ids or [])
    if ref_ids == current and (course.overview or "").strip():
        return False

    course.overview = build_overview(store, course_id, client)
    course.overview_source_ids = ref_ids
    store.save_course(course)
    return True


def fallback_overview(store, course_id: str) -> str:
    """A modest overview for a course with no reference documents.

    Hedged on purpose: it says where it came from, so neither the student nor
    the model mistakes it for a syllabus. It is never empty, because every
    explanation is meant to reference the overview.
    """
    try:
        course = store.get_course(course_id)
    except KeyError:
        return (
            "No reference documents have been provided for this course, so no "
            "overview could be built."
        )

    title = (course.title or course_id).strip()
    decks = sorted(course.decks, key=lambda d: (d.order, d.id))

    lines = [
        f"This overview for “{title}” was derived from the uploaded "
        "slide decks themselves, because no syllabus or programme document was "
        "provided. Treat it as a rough map of the material rather than an "
        "authoritative course description."
    ]

    if not decks:
        lines.append("No slide decks have been imported yet.")
        return " ".join(lines)

    total = sum(d.n_slides for d in decks)
    deck_names = ", ".join(d.title or d.id for d in decks)
    lines.append(
        f"The course currently holds {len(decks)} deck(s) covering roughly "
        f"{total} slides, in this order: {deck_names}."
    )

    openings: list[str] = []
    for deck in decks:
        try:
            slides = store.load_slides(course_id, deck.id)
        except (KeyError, ValueError, OSError):
            continue
        snippets: list[str] = []
        for slide in slides[:FALLBACK_SLIDES_PER_DECK]:
            text = " ".join((slide.text or "").split())
            if text:
                snippets.append(_truncate_words(text, FALLBACK_SLIDE_WORDS))
        if snippets:
            openings.append(f"{deck.title or deck.id}: " + " / ".join(snippets))

    if openings:
        lines.append(
            "The opening slides of each deck indicate the following subject "
            "matter — " + "; ".join(openings) + "."
        )
    else:
        lines.append(
            "The slides carry no extracted text, so the subject matter could "
            "not be summarised from them."
        )

    lines.append(
        "What a student is expected to end up able to do, and how the course "
        "is assessed, are not stated anywhere in the imported material."
    )
    return " ".join(lines)


__all__ = [
    "build_overview",
    "refresh_overview_if_needed",
    "fallback_overview",
    "REF_WORD_BUDGET",
    "TOTAL_REF_WORD_BUDGET",
]
