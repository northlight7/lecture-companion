"""The per-slide pipeline. Invariants 1, 2 and 5 live in this module.

    extract (done upstream) -> build context -> generate -> store -> index ->
    update the running summary -> checkpoint

Three properties this file is responsible for:

* **Course isolation (invariant 1, gate G6).** Every read is parameterised by
  `course_id` and goes through `CourseStore`. The only index consulted is
  `VectorIndex(store.index_path(course_id))`, which lives inside the course
  directory. `build_context` additionally asserts that every retrieved row
  belongs to a deck registered on *this* course, and drops anything else.
* **Grounding (invariant 2, gate G5).** The context handed to the model is
  the course's own overview, its own running summary, and its own earlier
  slides — nothing else — and each retrieved chunk is labelled with its slide
  number so the explanation can point back at it honestly.
* **Resume (invariant 5, gates G7/G8).** `process_slide` never calls the model
  for a slide that already has a stored explanation. `process_course`
  checkpoints after every slide, before starting the next, so a kill at any
  point leaves a resumable state. A 429 or an unreachable model is a *pause*
  with the cursor left on the failed slide, never an exception that loses
  position.
"""

from __future__ import annotations

import base64
import logging
from typing import Callable, Iterable, Sequence

from app import config
from app.contracts import (
    BadModelOutput,
    Deck,
    Explanation,
    IndexRow,
    ModelUnavailable,
    Progress,
    RateLimited,
    Slide,
    SlideContext,
)
from app.embed import tokenize
from app.overview import fallback_overview
from app.vectors import VectorIndex, chunk_id_for

from app.llm import CONTENT_MARKER

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Context budget. Tunable in one place, deliberately.
#
# The whole assembled prompt has to stay comfortably inside a request even for
# a 300-slide course, so each part is capped rather than trusting the total to
# stay small on its own:
#
#   overview   ~400 words (overview.py asks for 200-400)
# + summary    SUMMARY_WORD_BUDGET
# + retrieved  top_k * CHUNK_WORD_BUDGET
# + slide text SLIDE_TEXT_WORD_BUDGET
# + boilerplate
#   -----------------------------------------------------------------------
#   < PROMPT_WORD_BUDGET
# --------------------------------------------------------------------------

#: The running summary shown to the model, in words.
SUMMARY_WORD_BUDGET = 1200
#: Each retrieved chunk, in words, as rendered into the prompt.
CHUNK_WORD_BUDGET = 200
#: The current slide's extracted text, in words.
SLIDE_TEXT_WORD_BUDGET = 800
#: What one indexed chunk stores. Bigger than CHUNK_WORD_BUDGET so retrieval
#: has more signal than the prompt has to carry.
INDEX_TEXT_WORD_BUDGET = 300
#: Ceiling the assembled prompt text is asserted against by the tests.
PROMPT_WORD_BUDGET = 4000

#: Recent slides kept verbatim as one-line gists in the running summary.
#: Older ones get compressed into a paragraph when they outgrow the budget.
KEEP_RECENT_GISTS = 15

#: A retrieved chunk this much of whose vocabulary is already in the running
#: summary is dropped as redundant. 0.7 is deliberately loose: below it a
#: chunk still adds phrasing the summary lost, above it we are paying tokens
#: to repeat ourselves.
SUMMARY_DEDUP_RATIO = 0.7

#: Consecutive unparseable model replies before the course pauses. One bad
#: slide is a bad slide; three in a row is a broken model or a broken prompt.
MAX_CONSECUTIVE_BAD = 3

ProgressCallback = Callable[[str, int, str], None]


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------


def _truncate_words(text: str, limit: int) -> str:
    words = (text or "").split()
    if len(words) <= limit:
        return (text or "").strip()
    return " ".join(words[:limit]) + " [...]"


def _first_sentence(text: str, max_words: int = 40) -> str:
    body = " ".join((text or "").split())
    if not body:
        return ""
    for stop in (". ", "? ", "! "):
        idx = body.find(stop)
        if idx > 0:
            body = body[: idx + 1]
            break
    return _truncate_words(body, max_words)


def _decks_in_order(course) -> list[Deck]:
    return sorted(course.decks, key=lambda d: (d.order, d.id))


def _overlap_ratio(chunk_text: str, summary: str) -> float:
    """Fraction of the chunk's distinct tokens already present in `summary`."""
    chunk_tokens = set(tokenize(chunk_text))
    if not chunk_tokens:
        return 1.0  # nothing to add
    summary_tokens = set(tokenize(summary))
    if not summary_tokens:
        return 0.0
    return len(chunk_tokens & summary_tokens) / len(chunk_tokens)


def _slide_image_b64(store, course_id: str, deck_id: str, index: int) -> str:
    try:
        data = store.slide_image_bytes(course_id, deck_id, index)
    except (KeyError, OSError, ValueError):
        # A missing render is not fatal: the extracted text still grounds the
        # explanation, and the prompt says so.
        log.info("no image for %s:%d in %s", deck_id, index, course_id)
        return ""
    return base64.b64encode(data).decode("ascii")


def _course_overview(store, course_id: str) -> str:
    """The overview, never empty — every explanation is meant to cite it."""
    try:
        course = store.get_course(course_id)
    except KeyError:
        return ""
    overview = (course.overview or "").strip()
    if overview:
        return overview
    return fallback_overview(store, course_id)


def _reading_order(store, course_id: str, course) -> list[tuple[str, int]]:
    order: list[tuple[str, int]] = []
    for item in _decks_in_order(course):
        order.extend((item.id, slide.index) for slide in store.load_slides(course_id, item.id))
    return order


def index_text_for(slide_text: str, exp: Explanation | None) -> str:
    """What gets embedded and stored for one slide.

    Slide text *and* its explanation, so a later slide can retrieve either the
    words that were on an earlier slide or the plain-language reading of it.
    """
    parts: list[str] = []
    if exp is not None and exp.heading:
        parts.append(exp.heading)
    text = " ".join((slide_text or "").split())
    if text:
        parts.append(text)
    if exp is not None and exp.body:
        parts.append(exp.body)
    return _truncate_words("\n".join(parts), INDEX_TEXT_WORD_BUDGET)


# --------------------------------------------------------------------------
# Context assembly (G5, G6)
# --------------------------------------------------------------------------


def build_context(
    store,
    course_id: str,
    deck_id: str,
    slide_index: int,
    embedder,
    *,
    k: int | None = None,
) -> SlideContext:
    """Assemble everything one generation call sees, for this course only."""
    course = store.get_course(course_id)
    deck = next((d for d in course.decks if d.id == deck_id), None)
    if deck is None:
        raise KeyError(f"no such deck {deck_id!r} in course {course_id!r}")
    slide: Slide = store.load_slide(course_id, deck_id, slide_index)

    progress = store.load_progress(course_id)
    running_summary = _truncate_words(progress.running_summary, SUMMARY_WORD_BUDGET)
    overview = _course_overview(store, course_id)

    slide_text = (slide.text or "").strip()

    # The query. A title-only slide has almost no text of its own, so the deck
    # title carries the topic instead of retrieving on three words.
    query = slide_text
    if len(tokenize(query)) < 12:
        query = f"{deck.title}\n{query}".strip()

    top_k = config.top_k() if k is None else k
    retrieved: list[IndexRow] = []
    index = VectorIndex(store.index_path(course_id))
    order = _reading_order(store, course_id, course)
    ranks = {pair: rank for rank, pair in enumerate(order)}
    current_rank = ranks.get((deck_id, slide_index), len(order))
    previous_chunk_id = ""
    if current_rank > 0:
        previous_deck, previous_index = order[current_rank - 1]
        previous_exp = store.load_explanation(
            course_id, previous_deck, previous_index
        )
        if previous_exp is not None and (previous_exp.body or "").strip():
            previous_chunk_id = chunk_id_for(previous_deck, previous_index)
            previous_row = index.get(previous_chunk_id)
            if previous_row is None:
                previous_slide = store.load_slide(
                    course_id, previous_deck, previous_index
                )
                previous_row = IndexRow(
                    chunk_id=previous_chunk_id,
                    deck_id=previous_deck,
                    slide_index=previous_index,
                    text=index_text_for(previous_slide.text, previous_exp),
                    vec=[],
                )
            retrieved.append(IndexRow(
                chunk_id=previous_row.chunk_id,
                deck_id=previous_row.deck_id,
                slide_index=previous_row.slide_index,
                text=_truncate_words(previous_row.text, CHUNK_WORD_BUDGET),
                vec=[],
            ))

    if top_k > 0 and query.strip():
        # ONLY this course's index. This single line is where invariant 1 is
        # enforced for retrieval; `index_path` resolves inside the course dir.
        own_chunk = chunk_id_for(deck_id, slide_index)
        qvec = embedder.embed_query(query)
        # Over-fetch, because dedup and the isolation guard both drop rows.
        hits = index.search(qvec, top_k * 3, exclude=[own_chunk])

        known_decks = {d.id for d in course.decks}
        for row, score in hits:
            if len(retrieved) >= top_k + bool(previous_chunk_id):
                break
            if row.deck_id not in known_decks:
                # Defensive: an index row for a deck this course does not own
                # should be impossible. If it happens, it is a leak — drop it
                # loudly rather than letting it reach the model.
                log.warning(
                    "dropping index row %s: deck %s is not in course %s",
                    row.chunk_id,
                    row.deck_id,
                    course_id,
                )
                continue
            if row.chunk_id == own_chunk:
                continue
            if row.chunk_id == previous_chunk_id:
                continue
            if ranks.get((row.deck_id, row.slide_index), len(order)) >= current_rank:
                # Regeneration can see a fully built index. Context must still
                # contain only material the student has already reached.
                continue
            if score <= 0.0:
                continue
            if _overlap_ratio(row.text, running_summary) > SUMMARY_DEDUP_RATIO:
                # Already said in the running summary; spending tokens on it
                # twice buys nothing.
                continue
            retrieved.append(
                IndexRow(
                    chunk_id=row.chunk_id,
                    deck_id=row.deck_id,
                    slide_index=row.slide_index,
                    text=_truncate_words(row.text, CHUNK_WORD_BUDGET),
                    vec=[],  # the prompt does not need the vector
                )
            )

    ctx = SlideContext(
        course_overview=_truncate_words(overview, 500),
        running_summary=running_summary,
        retrieved=retrieved,
        slide_text=_truncate_words(slide_text, SLIDE_TEXT_WORD_BUDGET),
        slide_image_b64=_slide_image_b64(store, course_id, deck_id, slide_index),
        deck_title=deck.title or deck.id,
        slide_index=slide_index,
        n_slides=deck.n_slides or len(store.load_slides(course_id, deck_id)),
    )
    # `SlideContext` carries no deck id by contract; the pipeline owns identity.
    # Stamp it so a client can key on the slide it was asked about (the stub
    # uses this for fault injection and call recording).
    setattr(ctx, "_deck_id", deck_id)
    setattr(ctx, "_previous_chunk_id", previous_chunk_id)
    setattr(ctx, "_deck_titles", {item.id: item.title or item.id for item in course.decks})
    try:
        from app.organization import related_material_for_deck

        related_material, related_source_ids = related_material_for_deck(
            store, course_id, deck_id
        )
    except (KeyError, OSError, ValueError):
        related_material, related_source_ids = "", []
    setattr(ctx, "_related_material", related_material)
    setattr(ctx, "_related_source_ids", related_source_ids)
    return ctx


# --------------------------------------------------------------------------
# One slide (G7: idempotence)
# --------------------------------------------------------------------------


def process_slide(
    store,
    course_id: str,
    deck_id: str,
    slide_index: int,
    client,
    embedder,
) -> Explanation:
    """Explain one slide, or return the stored explanation without spending.

    The stored-explanation check is FIRST, before context assembly and before
    any client call. That is the whole of invariant 5's idempotence half.
    """
    existing = store.load_explanation(course_id, deck_id, slide_index)
    if existing is not None and (existing.body or "").strip():
        return existing

    ctx = build_context(store, course_id, deck_id, slide_index, embedder)
    exp = client.explain_slide(ctx)

    # The client returns content; the pipeline owns identity.
    exp.deck_id = deck_id
    exp.slide_index = slide_index
    if not exp.context_used:
        exp.context_used = [row.chunk_id for row in ctx.retrieved] + list(
            getattr(ctx, "_related_source_ids", [])
        )

    # Order matters for a crash: the explanation lands first, so a resume sees
    # the slide as done and never re-calls the model for it. Indexing is
    # idempotent (`add` skips known chunk_ids), so replaying it is free.
    store.save_explanation(course_id, exp)
    _index_slide(store, course_id, deck_id, slide_index, ctx.slide_text, exp, embedder)
    return exp


def _index_slide(
    store,
    course_id: str,
    deck_id: str,
    slide_index: int,
    slide_text: str,
    exp: Explanation,
    embedder,
) -> None:
    chunk_id = chunk_id_for(deck_id, slide_index)
    index = VectorIndex(store.index_path(course_id))
    if index.has(chunk_id):
        return
    text = index_text_for(slide_text, exp)
    if not text.strip():
        return
    vec = embedder.embed_passages([text])[0]
    index.add(
        [
            IndexRow(
                chunk_id=chunk_id,
                deck_id=deck_id,
                slide_index=slide_index,
                text=text,
                vec=vec,
            )
        ]
    )


# --------------------------------------------------------------------------
# The running summary
# --------------------------------------------------------------------------


def _gist(exp: Explanation) -> str:
    """One line per slide: the heading plus the first sentence of the body."""
    heading = " ".join((exp.heading or "").split()) or f"Slide {exp.slide_index + 1}"
    first = _first_sentence(exp.body)
    label = f"Slide {exp.slide_index + 1}: {heading}"
    return f"- {label}: {first}" if first else f"- {label}"


def _gists_from_disk(store, course_id: str) -> list[str]:
    """Every stored explanation, in deck order then slide order, as gists.

    This reads stored explanations and NOTHING else, which is what makes a
    resumed course produce the same summary as an uninterrupted one.
    """
    try:
        course = store.get_course(course_id)
    except KeyError:
        return []
    out: list[str] = []
    for deck in _decks_in_order(course):
        for exp in store.load_explanations(course_id, deck.id):
            if (exp.body or "").strip():
                out.append(_gist(exp))
    return out


def render_summary(gists: Sequence[str], client) -> str:
    """Gists -> the running summary text.

    The most recent `KEEP_RECENT_GISTS` stay verbatim. Everything older is
    joined; only if that older portion exceeds the word budget is the model
    asked to compress it into a paragraph. So a short course costs no extra
    calls at all, and a long one costs one cheap text call per slide.

    Pure in its inputs: the same gist list and the same client always yield the
    same text. That is what makes a resume indistinguishable from an
    uninterrupted run (invariant 5).
    """
    gists = [g for g in gists if g.strip()]
    if not gists:
        return ""
    recent = gists[-KEEP_RECENT_GISTS:]
    older = gists[:-KEEP_RECENT_GISTS] if len(gists) > KEEP_RECENT_GISTS else []

    parts: list[str] = []
    if older:
        older_text = "\n".join(older)
        if len(older_text.split()) > SUMMARY_WORD_BUDGET:
            prompt = (
                "These are one-line notes on the slides a student has already "
                "worked through, in order. Compress them into a single "
                "paragraph of at most 200 words that says what the course has "
                "covered so far. Use only what the notes say."
                + CONTENT_MARKER
                + older_text
            )
            try:
                compressed = (client.summarise(prompt) or "").strip()
            except Exception as exc:  # a summary failure must not stop a course
                log.warning("running-summary compression failed: %s", exc)
                compressed = ""
            if compressed:
                parts.append("Earlier in the course: " + compressed)
            else:
                parts.append(_truncate_words(older_text, SUMMARY_WORD_BUDGET))
        else:
            parts.append(older_text)
    parts.append("\n".join(recent))
    return _truncate_words("\n\n".join(p for p in parts if p), SUMMARY_WORD_BUDGET)


def recompute_running_summary(store, course_id: str, client) -> str:
    """Rebuild the running summary from the stored explanations alone.

    Reads no progress state and no cached text, so it is the definition the
    incremental path is checked against.
    """
    summary = render_summary(_gists_from_disk(store, course_id), client)
    progress = store.load_progress(course_id)
    progress.running_summary = summary
    store.save_progress(course_id, progress)
    return summary


def update_running_summary(store, course_id: str, client) -> str:
    """Bring the running summary up to date with everything now stored.

    Identical to `recompute_running_summary` by construction, and deliberately
    so: one definition of the summary means a resumed course and an
    uninterrupted one can never diverge. `process_course` keeps the gist list
    in memory across its loop so the hot path does not re-read the whole
    course per slide.
    """
    return recompute_running_summary(store, course_id, client)


# --------------------------------------------------------------------------
# Cursor
# --------------------------------------------------------------------------


def _done_set(store, course_id: str, progress: Progress, deck_id: str) -> set[int]:
    """Slides considered finished: checkpointed, or with a stored explanation.

    The union matters when a kill lands between writing the explanation and
    writing progress.json — the slide is genuinely done, and must not be paid
    for twice.
    """
    done = set(progress.done.get(deck_id, ()))
    for exp in store.load_explanations(course_id, deck_id):
        if (exp.body or "").strip():
            done.add(exp.slide_index)
    return done


def next_unfinished(store, course_id: str) -> tuple[str, int] | None:
    """The first slide with no explanation, in reading order. None when done."""
    try:
        course = store.get_course(course_id)
    except KeyError:
        return None
    progress = store.load_progress(course_id)
    for deck in _decks_in_order(course):
        done = _done_set(store, course_id, progress, deck.id)
        for slide in store.load_slides(course_id, deck.id):
            if slide.index not in done:
                return deck.id, slide.index
    return None


# --------------------------------------------------------------------------
# The course loop (G7 resume, G8 pause)
# --------------------------------------------------------------------------


def process_course(
    store,
    course_id: str,
    client,
    embedder,
    *,
    deck_id: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> Progress:
    """Explain every unfinished slide in the course, checkpointing as it goes.

    Returns the Progress it leaves behind. It does not raise for a rate limit
    or an unreachable model: those set `state = "paused"` with the cursor on
    the slide that failed, which is gate G8.
    """
    course = store.get_course(course_id)
    progress = store.load_progress(course_id)
    progress.state = "running"
    progress.pause_reason = ""

    decks = _decks_in_order(course)
    if deck_id is not None:
        decks = [d for d in decks if d.id == deck_id]
        if not decks:
            raise KeyError(f"no such deck {deck_id!r} in course {course_id!r}")

    # Seed the gist list from what is already stored, so a resumed run builds
    # the identical summary an uninterrupted run would have.
    gists = _gists_from_disk(store, course_id)
    consecutive_bad = 0
    bad_slides: list[str] = []

    for deck in decks:
        done = _done_set(store, course_id, progress, deck.id)
        for slide in store.load_slides(course_id, deck.id):
            if slide.index in done:
                # Keep the checkpoint honest about work that is already on disk.
                if not progress.is_done(deck.id, slide.index):
                    progress.mark_done(deck.id, slide.index)
                continue

            progress.cursor_deck_id = deck.id
            progress.cursor_slide_index = slide.index

            try:
                exp = process_slide(
                    store, course_id, deck.id, slide.index, client, embedder
                )
            except (RateLimited, ModelUnavailable) as exc:
                # Invariant 5 / gate G8: a pause, with position intact.
                progress.state = "paused"
                progress.pause_reason = _pause_reason(exc, deck, slide.index)
                store.save_progress(course_id, progress)
                log.info("paused %s at %s:%d — %s",
                         course_id, deck.id, slide.index, progress.pause_reason)
                return progress
            except BadModelOutput as exc:
                consecutive_bad += 1
                label = f"{deck.title or deck.id} slide {slide.index + 1}"
                bad_slides.append(label)
                log.warning("unparseable model output on %s: %s", label, exc)
                if consecutive_bad >= MAX_CONSECUTIVE_BAD:
                    progress.state = "paused"
                    progress.pause_reason = (
                        f"{consecutive_bad} slides in a row came back in a form "
                        "we could not read ("
                        + ", ".join(bad_slides[-consecutive_bad:])
                        + "). Paused at "
                        f"{deck.title or deck.id} slide {slide.index + 1}; "
                        "nothing already explained was lost."
                    )
                    store.save_progress(course_id, progress)
                    return progress
                # One bad slide is skipped, not fatal. It stays not-done, so a
                # later run picks it up again.
                store.save_progress(course_id, progress)
                continue

            consecutive_bad = 0

            # -- the checkpoint, written before the next slide starts --------
            gists.append(_gist(exp))
            progress.running_summary = render_summary(gists, client)
            progress.mark_done(deck.id, slide.index)
            progress.cursor_deck_id = deck.id
            progress.cursor_slide_index = slide.index + 1
            store.save_progress(course_id, progress)

            if on_progress is not None:
                try:
                    on_progress(deck.id, slide.index, exp.heading)
                except Exception:  # a UI callback must not break a course
                    log.exception("on_progress callback raised")

    remaining = next_unfinished(store, course_id)
    if remaining is None:
        progress.state = "done"
        progress.pause_reason = ""
        progress.cursor_deck_id = ""
        progress.cursor_slide_index = 0
    else:
        # Slides were skipped (unparseable output); the course is not finished.
        progress.state = "paused"
        progress.cursor_deck_id, progress.cursor_slide_index = remaining
        if bad_slides:
            progress.pause_reason = (
                "Could not read the model's answer for: "
                + ", ".join(bad_slides)
                + ". Run again to retry just those slides."
            )
    store.save_progress(course_id, progress)
    return progress


def _pause_reason(exc: Exception, deck: Deck, slide_index: int) -> str:
    where = f"{deck.title or deck.id} slide {slide_index + 1}"
    if isinstance(exc, RateLimited):
        return (
            f"Paused at {where}: the model is rate limiting this key. "
            f"Try again in about {exc.retry_after:g} seconds — every slide "
            "already explained is saved."
        )
    return (
        f"Paused at {where}: the model could not be reached ({exc}). "
        "Your position is saved; resume when the connection is back."
    )


def resume(store, course_id: str, client, embedder, **kw) -> Progress:
    """Continue from the first unfinished slide.

    A thin wrapper over `process_course`, which is already resume-shaped:
    finished slides are skipped without a client call, so there is no separate
    resume path that could drift from the normal one.
    """
    return process_course(store, course_id, client, embedder, **kw)


__all__ = [
    "build_context",
    "process_slide",
    "process_course",
    "resume",
    "update_running_summary",
    "recompute_running_summary",
    "render_summary",
    "next_unfinished",
    "index_text_for",
    "SUMMARY_WORD_BUDGET",
    "CHUNK_WORD_BUDGET",
    "SLIDE_TEXT_WORD_BUDGET",
    "PROMPT_WORD_BUDGET",
    "SUMMARY_DEDUP_RATIO",
    "KEEP_RECENT_GISTS",
]
