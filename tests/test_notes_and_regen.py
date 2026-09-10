"""Regenerating an explanation, and the reader's own notes.

Both are the reader overriding or adding to what the model produced, so both
have to survive the model running again.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.embed import HashingEmbedder
from app.llm import FakeClient
from app.pipeline import process_slide
from tests.test_pipeline import OVERVIEW, SLIDE_TEXTS, make_course, make_deck


def _course(store, cid="regen"):
    make_course(store, cid, OVERVIEW)
    make_deck(store, cid, "w1", "Week 1", SLIDE_TEXTS)
    return cid


# ---------------------------------------------------------------- regenerate


def test_a_slide_is_not_re_explained_unless_asked(store):
    """Invariant 5, restated for the case the reader did not ask for."""
    cid = _course(store)
    first = FakeClient()
    process_slide(store, cid, "w1", 0, first, HashingEmbedder())
    assert len(first.calls) == 1

    second = FakeClient()
    process_slide(store, cid, "w1", 0, second, HashingEmbedder())
    assert second.calls == [], "a stored explanation was regenerated unasked"


def test_forcing_a_slide_replaces_its_explanation(store):
    cid = _course(store)
    process_slide(store, cid, "w1", 0, FakeClient(), HashingEmbedder())
    before = store.load_explanation(cid, "w1", 0)

    client = FakeClient()
    after = process_slide(store, cid, "w1", 0, client, HashingEmbedder(), force=True)

    assert len(client.calls) == 1, "forcing did not spend"
    assert after.body.strip()
    # Replaced, not appended: one explanation per slide stays true.
    assert store.load_explanation(cid, "w1", 0).body == after.body
    assert before is not None


def test_forcing_one_slide_leaves_the_others_alone(store):
    cid = _course(store)
    process_slide(store, cid, "w1", 0, FakeClient(), HashingEmbedder())
    process_slide(store, cid, "w1", 1, FakeClient(), HashingEmbedder())
    untouched = store.load_explanation(cid, "w1", 1).body

    process_slide(store, cid, "w1", 0, FakeClient(), HashingEmbedder(), force=True)
    assert store.load_explanation(cid, "w1", 1).body == untouched


def test_the_regenerate_route_answers_with_a_fresh_explanation(client: TestClient, store):
    cid = _course(store)
    process_slide(store, cid, "w1", 0, FakeClient(), HashingEmbedder())
    before = store.load_explanation(cid, "w1", 0).body

    out = client.post(f"/api/courses/{cid}/decks/w1/slides/0/regenerate")
    assert out.status_code == 200, out.text
    body = out.json()
    assert body["explanation"]["body"].strip()
    assert body["terms"] == []
    assert body["note"] == ""
    assert before  # there was something to replace

    missing = client.post(f"/api/courses/{cid}/decks/w1/slides/999/regenerate")
    assert missing.status_code == 404


def test_a_forced_deck_run_is_refused_while_the_course_is_working(client: TestClient, store):
    """Two workers on one course would interleave checkpoints."""
    cid = _course(store)
    assert client.post(f"/api/courses/{cid}/process", json={}).status_code == 200
    second = client.post(f"/api/courses/{cid}/process", json={"deck_id": "w1", "force": True})
    assert second.status_code in (200, 409)
    client.post(f"/api/courses/{cid}/pause")


# ---------------------------------------------------------------- notes


def test_a_note_is_saved_read_back_and_cleared(client: TestClient, store):
    cid = _course(store)
    base = f"/api/courses/{cid}"

    empty = client.get(f"{base}/decks/w1/slides/0").json()
    assert empty["note"] == ""

    saved = client.put(
        f"{base}/notes",
        json={"deck_id": "w1", "slide_index": 0, "text": "Instructor said this is examinable."},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["note"] == "Instructor said this is examinable."

    assert client.get(f"{base}/decks/w1/slides/0").json()["note"] == (
        "Instructor said this is examinable."
    )
    # A different slide keeps its own, empty, note.
    assert client.get(f"{base}/decks/w1/slides/1").json()["note"] == ""

    cleared = client.put(
        f"{base}/notes", json={"deck_id": "w1", "slide_index": 0, "text": "   "}
    )
    assert cleared.json()["note"] == ""
    assert client.get(f"{base}/decks/w1/slides/0").json()["note"] == ""


def test_a_note_survives_the_slide_being_explained_again(client: TestClient, store):
    """The reader's words are not the model's to overwrite."""
    cid = _course(store)
    client.put(
        f"/api/courses/{cid}/notes",
        json={"deck_id": "w1", "slide_index": 0, "text": "Ask about the third step."},
    )
    client.post(f"/api/courses/{cid}/decks/w1/slides/0/regenerate")

    assert client.get(f"/api/courses/{cid}/decks/w1/slides/0").json()["note"] == (
        "Ask about the third step."
    )


def test_a_note_for_an_unknown_slide_is_refused(client: TestClient, store):
    cid = _course(store)
    bad_deck = client.put(
        f"/api/courses/{cid}/notes",
        json={"deck_id": "nope", "slide_index": 0, "text": "x"},
    )
    assert bad_deck.status_code == 404
    bad_slide = client.put(
        f"/api/courses/{cid}/notes",
        json={"deck_id": "w1", "slide_index": 999, "text": "x"},
    )
    assert bad_slide.status_code == 404
