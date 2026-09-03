"""Gate G7 / invariant 5: pausing and resuming never re-calls the model.

The money assertion is that after a pause on slide 3, the resuming client is
asked for slides 3, 4 and 5 and never for 0, 1 or 2.
"""

from __future__ import annotations

import pytest

from app.contracts import ModelUnavailable, RateLimited
from app.course import CourseStore
from app.embed import HashingEmbedder
from app.llm import FakeClient
from app.pipeline import (
    next_unfinished,
    process_course,
    process_slide,
    recompute_running_summary,
    resume,
)
from app.vectors import VectorIndex
from tests.test_pipeline import make_course, make_deck

OVERVIEW = (
    "Distributed Systems Foundations covers how independent machines agree on "
    "shared state despite failures. The course runs from clocks and ordering, "
    "through replication, to consensus. A student should end able to reason "
    "about a protocol's failure modes. Assessment is two implementation "
    "assignments."
)

SLIDES = [
    "Physical clocks and their limits\nClock skew between machines makes "
    "wall-clock timestamps unreliable for ordering events",
    "Lamport clocks\nA logical counter per process gives a partial order that "
    "respects causality without any synchronised clock",
    "Vector clocks\nOne counter per process detects concurrency exactly, at "
    "the cost of a vector per message",
    "Replication\nKeeping copies of state on several machines so that a single "
    "failure does not lose data",
    "Quorums\nRead and write sets that overlap guarantee a reader sees the "
    "most recent acknowledged write",
    "Consensus and Raft\nA single elected leader appends to a replicated log, "
    "and a majority acknowledgement commits an entry",
]

COURSE_ID = "distributed-systems-foundations"
DECK = "w1"


@pytest.fixture
def course(store):
    make_course(store, "Distributed Systems Foundations", OVERVIEW)
    make_deck(store, COURSE_ID, DECK, "Week 1", SLIDES)
    return COURSE_ID


# --------------------------------------------------------------------------
# G8: a 429 is a pause, with position intact
# --------------------------------------------------------------------------


def test_a_rate_limit_pauses_without_losing_position(store, course):
    client = FakeClient(fail_on=[(DECK, 3)], error=RateLimited)
    progress = process_course(store, course, client, HashingEmbedder())

    assert progress.state == "paused"
    assert progress.done == {DECK: [0, 1, 2]}
    assert progress.cursor_deck_id == DECK
    assert progress.cursor_slide_index == 3
    assert "rate limiting" in progress.pause_reason
    assert progress.pause_reason.strip()

    # The client was asked for 0..3 and stopped there. Slides 4 and 5 were
    # never attempted, so the pause did not burn through the rest of the deck.
    assert client.calls == [(DECK, 0), (DECK, 1), (DECK, 2), (DECK, 3)]
    assert (DECK, 4) not in client.calls
    assert (DECK, 5) not in client.calls

    assert len(store.load_explanations(course, DECK)) == 3
    assert next_unfinished(store, course) == (DECK, 3)


def test_an_unreachable_model_pauses_the_same_way(store, course):
    client = FakeClient(fail_on=[(DECK, 2)], error=ModelUnavailable)
    progress = process_course(store, course, client, HashingEmbedder())

    assert progress.state == "paused"
    assert progress.done == {DECK: [0, 1]}
    assert progress.cursor_slide_index == 2
    assert "could not be reached" in progress.pause_reason
    assert next_unfinished(store, course) == (DECK, 2)


# --------------------------------------------------------------------------
# G7: the resume
# --------------------------------------------------------------------------


def test_resume_calls_the_model_only_for_the_unfinished_slides(store, course):
    embedder = HashingEmbedder()

    failing = FakeClient(fail_on=[(DECK, 3)], error=RateLimited)
    paused = process_course(store, course, failing, embedder)
    assert paused.state == "paused"
    assert paused.done == {DECK: [0, 1, 2]}

    fresh = FakeClient()
    finished = resume(store, course, fresh, embedder)

    # THE assertion: the second client is never asked for a slide that was
    # already explained.
    assert fresh.calls == [(DECK, 3), (DECK, 4), (DECK, 5)]
    for already_done in (0, 1, 2):
        assert (DECK, already_done) not in fresh.calls

    assert finished.state == "done"
    assert finished.done == {DECK: [0, 1, 2, 3, 4, 5]}

    explanations = store.load_explanations(course, DECK)
    assert len(explanations) == len(SLIDES)
    assert [e.slide_index for e in explanations] == list(range(len(SLIDES)))
    assert all(e.body.strip() for e in explanations)
    assert VectorIndex(store.index_path(course)).count() == len(SLIDES)


def test_a_resumed_summary_equals_an_uninterrupted_one(store, tmp_courses, course):
    """Invariant 5's subtler half: the *content* must not differ either."""
    embedder = HashingEmbedder()

    # Run A: interrupted at slide 3, then resumed.
    process_course(store, course, FakeClient(fail_on=[(DECK, 3)],
                                             error=RateLimited), embedder)
    resume(store, course, FakeClient(), embedder)
    resumed_summary = recompute_running_summary(store, course, FakeClient())
    resumed_progress_summary = store.load_progress(course).running_summary

    # Run B: the same six slides, uninterrupted, in a separate course.
    make_course(store, "Distributed Systems Control", OVERVIEW)
    make_deck(store, "distributed-systems-control", DECK, "Week 1", SLIDES)
    clean = process_course(
        store, "distributed-systems-control", FakeClient(), embedder
    )

    assert clean.state == "done"
    assert resumed_summary == clean.running_summary
    assert resumed_progress_summary == clean.running_summary


def test_process_slide_is_idempotent_and_free_the_second_time(store, course):
    embedder = HashingEmbedder()
    first = FakeClient()
    exp = process_slide(store, course, DECK, 0, first, embedder)
    assert first.calls == [(DECK, 0)]

    second = FakeClient()
    again = process_slide(store, course, DECK, 0, second, embedder)
    assert second.calls == [], "a stored explanation must not cost a model call"
    assert again.body == exp.body
    assert again.heading == exp.heading


# --------------------------------------------------------------------------
# A hard kill, not a graceful pause
# --------------------------------------------------------------------------


def test_a_hard_kill_resumes_from_disk_at_the_right_slide(store, tmp_courses, course):
    """No shared object survives: a fresh CourseStore reads only the files."""
    embedder = HashingEmbedder()

    # Explain three slides, then simulate the process dying: no further writes,
    # no in-memory state carried over.
    killed = FakeClient(fail_on=[(DECK, 3)], error=RateLimited)
    process_course(store, course, killed, embedder)

    restarted = CourseStore(tmp_courses)
    assert restarted.index_path(course) == store.index_path(course)
    assert next_unfinished(restarted, course) == (DECK, 3)

    after_restart = FakeClient()
    progress = resume(restarted, course, after_restart, embedder)
    assert after_restart.calls == [(DECK, 3), (DECK, 4), (DECK, 5)]
    assert progress.state == "done"
    assert len(restarted.load_explanations(course, DECK)) == len(SLIDES)


def test_a_kill_between_the_explanation_and_the_checkpoint_is_not_paid_twice(
    store, tmp_courses, course
):
    """The worst crash window: the explanation is on disk, progress.json is not."""
    embedder = HashingEmbedder()
    process_slide(store, course, DECK, 0, FakeClient(), embedder)
    process_slide(store, course, DECK, 1, FakeClient(), embedder)

    # progress.json still says nothing is done — exactly the state a kill
    # between the two writes leaves behind.
    assert store.load_progress(course).done == {}

    restarted = CourseStore(tmp_courses)
    assert next_unfinished(restarted, course) == (DECK, 2)

    client = FakeClient()
    progress = resume(restarted, course, client, embedder)
    assert client.calls == [(DECK, 2), (DECK, 3), (DECK, 4), (DECK, 5)]
    assert progress.done == {DECK: [0, 1, 2, 3, 4, 5]}
    assert progress.state == "done"
    assert len(restarted.load_explanations(course, DECK)) == len(SLIDES)


def test_repeated_pauses_still_converge_to_one_explanation_per_slide(store, course):
    embedder = HashingEmbedder()
    for stop_at in (1, 2, 4):
        process_course(
            store,
            course,
            FakeClient(fail_on=[(DECK, stop_at)], error=RateLimited),
            embedder,
        )
    final = resume(store, course, FakeClient(), embedder)

    assert final.state == "done"
    explanations = store.load_explanations(course, DECK)
    assert len(explanations) == len(SLIDES)
    assert sorted(e.slide_index for e in explanations) == list(range(len(SLIDES)))
    assert VectorIndex(store.index_path(course)).count() == len(SLIDES)
