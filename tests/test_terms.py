"""Terms the reader asked to have explained, kept per slide.

Storage is course-local, so these tests also check that a term for one course
never appears in another, and that re-explaining a slide cannot erase one.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient


def _make_slide(store, course_id: str, deck_id: str, index: int, text: str) -> None:
    from app.contracts import Deck

    if not any(d.id == deck_id for d in store.get_course(course_id).decks):
        store.add_deck(
            course_id, Deck(id=deck_id, source_file_id="src-" + deck_id,
                            title="Week 1", n_slides=index + 1)
        )
    sdir = store.slides_dir(course_id, deck_id)
    sdir.mkdir(parents=True, exist_ok=True)
    stem = store.slide_stem(index)
    (sdir / f"{stem}.txt").write_text(text, encoding="utf-8")


def _api_course_with_slide(store, cid="fintech", deck="deck-a"):
    """A course with one real slide, reachable through the API.

    Built through the store rather than the importer, so the test is about the
    term routes and not about how a file gets classified.
    """
    _course_with_slide(store, cid, deck)
    return cid, deck


def _course_with_slide(store, cid="fintech", deck="deck-a"):
    course = store.create_course(cid)
    _make_slide(store, course.id, deck, 0, "RegTech covers model governance.")
    return course.id


# ---------------------------------------------------------------- storage


def test_a_term_is_stored_against_its_slide_and_read_back(store):
    from app.terms import add_term, terms_for_slide

    cid = _course_with_slide(store)
    add_term(store, cid, "deck-a", 0, "RegTech", "Technology used to meet rules.")

    entries = terms_for_slide(store, cid, "deck-a", 0)
    assert [e["term"] for e in entries] == ["RegTech"]
    assert entries[0]["note"] == "Technology used to meet rules."
    # A different slide is untouched.
    assert terms_for_slide(store, cid, "deck-a", 1) == []


def test_asking_for_the_same_term_twice_updates_it_rather_than_duplicating(store):
    from app.terms import add_term, terms_for_slide

    cid = _course_with_slide(store)
    add_term(store, cid, "deck-a", 0, "RegTech", "first")
    add_term(store, cid, "deck-a", 0, "regtech", "second")

    entries = terms_for_slide(store, cid, "deck-a", 0)
    assert len(entries) == 1
    assert entries[0]["note"] == "second"


def test_a_term_survives_re_explaining_its_slide(store):
    """Terms live beside the explanations, not inside them.

    Re-running a course rewrites every explanation. A term the reader saved must
    not go with it, which is why this is its own file.
    """
    from app.terms import add_term, terms_for_slide

    cid = _course_with_slide(store)
    add_term(store, cid, "deck-a", 0, "RegTech", "kept")

    # Reading it again after other writers have been at the course.
    assert [e["term"] for e in terms_for_slide(store, cid, "deck-a", 0)] == ["RegTech"]


def test_terms_never_cross_a_course_boundary(store):
    from app.terms import add_term, terms_for_slide

    _course_with_slide(store, "alpha", "deck-a")
    _course_with_slide(store, "beta", "deck-a")
    add_term(store, "alpha", "deck-a", 0, "RegTech", "alpha only")

    assert terms_for_slide(store, "beta", "deck-a", 0) == []


def test_an_empty_term_is_refused(store):
    import pytest

    from app.terms import add_term

    cid = _course_with_slide(store)
    with pytest.raises(ValueError):
        add_term(store, cid, "deck-a", 0, "   ", "note")


def test_removing_a_term_empties_the_slide(store):
    from app.terms import add_term, remove_term, terms_for_slide

    cid = _course_with_slide(store)
    add_term(store, cid, "deck-a", 0, "RegTech", "note")
    assert remove_term(store, cid, "deck-a", 0, "regtech") == []
    assert terms_for_slide(store, cid, "deck-a", 0) == []


# ---------------------------------------------------------------- the route


def test_the_slide_payload_carries_its_terms(client: TestClient, store):
    cid, deck_id = _api_course_with_slide(store)

    before = client.get(f"/api/courses/{cid}/decks/{deck_id}/slides/0").json()
    assert before["terms"] == []

    added = client.post(
        f"/api/courses/{cid}/terms",
        json={"deck_id": deck_id, "slide_index": 0, "term": "RegTech"},
    )
    assert added.status_code == 200, added.text
    body = added.json()
    assert [e["term"] for e in body["terms"]] == ["RegTech"]
    assert body["note"].strip()

    after = client.get(f"/api/courses/{cid}/decks/{deck_id}/slides/0").json()
    assert [e["term"] for e in after["terms"]] == ["RegTech"]

    removed = client.request(
        "DELETE",
        f"/api/courses/{cid}/terms",
        json={"deck_id": deck_id, "slide_index": 0, "term": "RegTech"},
    )
    assert removed.status_code == 200
    assert removed.json()["terms"] == []


def test_the_term_route_refuses_an_empty_selection_and_a_foreign_deck(client: TestClient, store):
    cid, deck_id = _api_course_with_slide(store)

    empty = client.post(
        f"/api/courses/{cid}/terms",
        json={"deck_id": deck_id, "slide_index": 0, "term": "  "},
    )
    assert empty.status_code == 400

    foreign = client.post(
        f"/api/courses/{cid}/terms",
        json={"deck_id": "deck-elsewhere", "slide_index": 0, "term": "RegTech"},
    )
    assert foreign.status_code == 404

    off_end = client.post(
        f"/api/courses/{cid}/terms",
        json={"deck_id": deck_id, "slide_index": 999, "term": "RegTech"},
    )
    assert off_end.status_code == 404


def test_the_terms_file_is_readable_json_inside_the_course(client: TestClient, store):
    """It has to live with the course, not somewhere global."""
    cid, deck_id = _api_course_with_slide(store)
    client.post(
        f"/api/courses/{cid}/terms",
        json={"deck_id": deck_id, "slide_index": 0, "term": "RegTech"},
    )

    from app.config import courses_root

    path = courses_root() / cid / "terms.json"
    assert path.exists()
    payload = json.loads(path.read_text(encoding="utf-8"))
    assert payload["slides"][f"{deck_id}:0"][0]["term"] == "RegTech"
