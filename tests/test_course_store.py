"""CourseStore: lifecycle, atomic writes, path safety, and course isolation."""

from __future__ import annotations

import json

import pytest

from app.contracts import Artifact, Course, Deck, Explanation, Progress, SourceFile
from app.course import CourseStore, safe_filename, slugify


# --------------------------------------------------------------------------
# lifecycle
# --------------------------------------------------------------------------


def test_create_list_get_delete_round_trip(store: CourseStore):
    assert store.list_courses() == []

    course = store.create_course("Machine Learning")
    assert course.id == "machine-learning"
    assert course.title == "Machine Learning"
    assert store.exists("machine-learning")
    assert store.course_dir("machine-learning").is_dir()
    for sub in ("raw", "slides", "refs", "explanations"):
        assert (store.course_dir("machine-learning") / sub).is_dir()

    listed = store.list_courses()
    assert [c.id for c in listed] == ["machine-learning"]

    fetched = store.get_course("machine-learning")
    assert fetched.title == "Machine Learning"

    store.delete_course("machine-learning")
    assert not store.exists("machine-learning")
    assert store.list_courses() == []
    with pytest.raises(KeyError):
        store.get_course("machine-learning")


def test_delete_artifact_removes_versions_but_preserves_shared_original(store: CourseStore):
    cid = store.create_course("Delete file").id
    digest = "e" * 64
    raw = store.course_dir(cid) / "raw" / f"{digest}.csv"
    raw.write_bytes(b"a,b\n1,2\n")
    old = Artifact(
        "old", digest, "data.csv", "Week 1/data.csv", "csv", "dataset",
        f"raw/{digest}.csv", version=1,
    )
    current = Artifact(
        "current", digest, "data.csv", "Week 1/data.csv", "csv", "dataset",
        f"raw/{digest}.csv", supersedes="old", version=2,
    )
    shared = Artifact(
        "shared", digest, "copy.csv", "Week 2/copy.csv", "csv", "dataset",
        f"raw/{digest}.csv",
    )
    store.save_artifacts(cid, [old, current, shared])
    store.save_learning_objects(cid, "old", [])
    store.save_learning_objects(cid, "current", [])

    result = store.delete_artifact(cid, "current")
    assert result["deleted_artifact_ids"] == ["current", "old"]
    assert [a.id for a in store.load_artifacts(cid, include_superseded=True)] == ["shared"]
    assert raw.is_file()
    assert not (store.objects_dir(cid) / "old.jsonl").exists()
    assert not (store.objects_dir(cid) / "current.jsonl").exists()

    store.delete_artifact(cid, "shared")
    assert not raw.exists()


def test_slug_collision_appends_a_counter(store: CourseStore):
    a = store.create_course("Machine Learning")
    b = store.create_course("Machine Learning")
    c = store.create_course("machine learning!")
    assert [a.id, b.id, c.id] == ["machine-learning", "machine-learning-2", "machine-learning-3"]
    # distinct directories, none reused
    assert len({store.course_dir(x.id) for x in (a, b, c)}) == 3
    assert {x.id for x in store.list_courses()} == {a.id, b.id, c.id}


def test_slugify_and_safe_filename():
    assert slugify("  Intro to  AI/ML (2026) ") == "intro-to-ai-ml-2026"
    assert slugify("###") == "course"
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("week 1: intro.PDF") == "week_1_intro.PDF"
    assert "/" not in safe_filename("a/b/c.pdf")


def test_get_course_missing_raises_keyerror(store: CourseStore):
    with pytest.raises(KeyError):
        store.get_course("nope")


# --------------------------------------------------------------------------
# progress / atomicity / corruption
# --------------------------------------------------------------------------


def test_progress_survives_repeated_saves(store: CourseStore):
    cid = store.create_course("Stats").id

    p = store.load_progress(cid)
    assert isinstance(p, Progress)
    p.running_summary = "covered probability basics"
    p.mark_done("deck1", 0)
    p.state = "running"
    store.save_progress(cid, p)

    p2 = store.load_progress(cid)
    assert p2.running_summary == "covered probability basics"
    assert p2.done == {"deck1": [0]}
    assert p2.state == "running"

    p2.mark_done("deck1", 2)
    p2.mark_done("deck1", 1)
    p2.running_summary = "covered probability and Bayes"
    p2.state = "paused"
    p2.pause_reason = "rate limited"
    p2.cursor_deck_id = "deck1"
    p2.cursor_slide_index = 3
    store.save_progress(cid, p2)

    p3 = store.load_progress(cid)
    assert p3.done == {"deck1": [0, 1, 2]}
    assert p3.running_summary == "covered probability and Bayes"
    assert p3.state == "paused"
    assert p3.pause_reason == "rate limited"
    assert p3.cursor_deck_id == "deck1" and p3.cursor_slide_index == 3
    assert p3.is_done("deck1", 2) and not p3.is_done("deck1", 5)


def test_writes_leave_no_tmp_files_behind(store: CourseStore):
    cid = store.create_course("Atomic").id
    store.save_progress(cid, Progress(running_summary="x"))
    store.save_course(store.get_course(cid))
    leftovers = [p.name for p in store.course_dir(cid).rglob("*.tmp")]
    assert leftovers == []


def test_load_progress_on_corrupt_file_returns_fresh(store: CourseStore):
    cid = store.create_course("Corrupt").id
    good = Progress(running_summary="real work", state="running")
    good.mark_done("d", 0)
    store.save_progress(cid, good)

    path = store.progress_path(cid)
    full = path.read_text("utf-8")
    path.write_text(full[: len(full) // 2], encoding="utf-8")  # simulate a kill mid-write

    p = store.load_progress(cid)
    assert isinstance(p, Progress)
    assert p.done == {} and p.running_summary == "" and p.state == "idle"

    path.write_text("", encoding="utf-8")
    assert store.load_progress(cid).done == {}

    path.unlink()
    assert store.load_progress(cid).state == "idle"


def test_course_json_tolerates_unknown_and_missing_keys(store: CourseStore):
    cid = store.create_course("Legacy").id
    path = store.course_json_path(cid)
    path.write_text(
        json.dumps({"id": cid, "title": "Legacy", "future_field": 42, "decks": None}),
        encoding="utf-8",
    )
    course = store.get_course(cid)
    assert course.title == "Legacy" and course.decks == [] and course.files == []


# --------------------------------------------------------------------------
# path safety (invariant 1, structural half)
# --------------------------------------------------------------------------


@pytest.mark.parametrize("bad", ["../evil", "..", "a/b", "./x", ".hidden", "", "a\\b", "x/../../y"])
def test_course_dir_rejects_traversal(store: CourseStore, bad: str):
    with pytest.raises(ValueError):
        store.course_dir(bad)


@pytest.mark.parametrize("bad", ["../../etc", "..", "a/b", ".secret", ""])
def test_slides_dir_rejects_traversal(store: CourseStore, bad: str):
    store.create_course("c")
    with pytest.raises(ValueError):
        store.slides_dir("c", bad)


def test_every_path_stays_inside_the_course_dir(store: CourseStore):
    cid = store.create_course("Bounded").id
    base = store.course_dir(cid)
    paths = [
        store.slides_dir(cid, "deck1"),
        store.index_path(cid),
        store.progress_path(cid),
        store.course_json_path(cid),
        store.explanation_path(cid, "deck1", 3),
        store.ref_text_path(cid, "file1"),
        store.add_raw_file(cid, "../../../../etc/passwd", b"x")[1],
    ]
    for p in paths:
        assert base in p.parents, f"{p} escaped {base}"


def test_add_raw_file_sanitises_and_stores_bytes(store: CourseStore):
    cid = store.create_course("Raw").id
    file_id, path = store.add_raw_file(cid, "../../week 1.pdf", b"%PDF-1.7 bytes")
    assert path.parent == store.raw_dir(cid)
    assert path.name == f"{file_id}__week_1.pdf"
    assert path.read_bytes() == b"%PDF-1.7 bytes"
    # not registered on the Course: that is the importer's job
    assert store.get_course(cid).files == []


def test_register_file_and_add_deck(store: CourseStore):
    cid = store.create_course("Reg").id
    fid, path = store.add_raw_file(cid, "w1.pdf", b"x")
    sf = SourceFile(
        id=fid,
        filename="w1.pdf",
        role="slides",
        stored_path=str(path.relative_to(store.course_dir(cid))),
        classified_by="test",
    )
    store.register_file(cid, sf)
    assert [f.id for f in store.get_course(cid).files] == [fid]

    store.add_deck(cid, Deck(id="deck1", source_file_id=fid, title="Week 1", n_slides=3))
    store.add_deck(cid, Deck(id="deck2", source_file_id=fid, title="Week 2", n_slides=2))
    decks = store.get_course(cid).decks
    assert [(d.id, d.order) for d in decks] == [("deck1", 0), ("deck2", 1)]
    assert store.get_deck(cid, "deck2").title == "Week 2"
    with pytest.raises(KeyError):
        store.get_deck(cid, "deck3")


# --------------------------------------------------------------------------
# slides
# --------------------------------------------------------------------------


def _write_slides(store: CourseStore, cid: str, deck_id: str, n: int) -> None:
    sdir = store.slides_dir(cid, deck_id)
    sdir.mkdir(parents=True, exist_ok=True)
    for i in range(n):
        (sdir / f"page-{i + 1:04d}.png").write_bytes(b"PNG" + str(i).encode())
        (sdir / f"page-{i + 1:04d}.txt").write_text(f"slide {i} text", encoding="utf-8")


def test_load_slides_sorted_with_text_and_image(store: CourseStore):
    cid = store.create_course("Slides").id
    _write_slides(store, cid, "deck1", 12)

    slides = store.load_slides(cid, "deck1")
    assert [s.index for s in slides] == list(range(12))
    assert slides[11].text == "slide 11 text"
    assert slides[0].image_path == "slides/deck1/page-0001.png"
    assert slides[0].text_path == "slides/deck1/page-0001.txt"
    assert store.load_slide(cid, "deck1", 5).text == "slide 5 text"
    assert store.slide_image_bytes(cid, "deck1", 5) == b"PNG5"

    with pytest.raises(KeyError):
        store.load_slide(cid, "deck1", 99)
    with pytest.raises(KeyError):
        store.slide_image_bytes(cid, "deck1", 99)
    assert store.load_slides(cid, "empty-deck") == []


# --------------------------------------------------------------------------
# explanations
# --------------------------------------------------------------------------


def test_explanation_round_trip_preserves_every_field(store: CourseStore):
    cid = store.create_course("Exp").id
    exp = Explanation(
        deck_id="deck1",
        slide_index=4,
        body="Gradient descent walks downhill on the loss surface.",
        example="Rolling a ball down a valley until it stops.",
        mermaid="graph TD; A[loss] --> B[gradient];",
        heading="Gradient descent",
        model="deepseek-v4-flash-vision-exp",
        context_used=["deck1:1", "deck1:2"],
    )
    store.save_explanation(cid, exp)

    assert store.explanation_path(cid, "deck1", 4).name == "0005.json"
    got = store.load_explanation(cid, "deck1", 4)
    assert got is not None
    assert got.body == exp.body
    assert got.example == exp.example
    assert got.mermaid == exp.mermaid
    assert got.heading == exp.heading
    assert got.model == exp.model
    assert got.context_used == ["deck1:1", "deck1:2"]
    assert got.slide_index == 4 and got.deck_id == "deck1"

    assert store.load_explanation(cid, "deck1", 9) is None


def test_load_explanations_sorted_by_slide_index(store: CourseStore):
    cid = store.create_course("Order").id
    for i in (11, 0, 2, 9):
        store.save_explanation(cid, Explanation(deck_id="d", slide_index=i, body=f"b{i}"))
    assert [e.slide_index for e in store.load_explanations(cid, "d")] == [0, 2, 9, 11]
    assert store.load_explanations(cid, "other") == []


# --------------------------------------------------------------------------
# reference docs
# --------------------------------------------------------------------------


def test_ref_text_round_trip(store: CourseStore):
    cid = store.create_course("Refs").id
    store.save_ref_text(cid, "f1", "syllabus text")
    store.save_ref_text(cid, "f2", "program requirements")
    assert store.load_ref_texts(cid) == {"f1": "syllabus text", "f2": "program requirements"}
    with pytest.raises(ValueError):
        store.save_ref_text(cid, "../escape", "nope")


# --------------------------------------------------------------------------
# invariant 1: course isolation
# --------------------------------------------------------------------------


def test_courses_are_isolated(store: CourseStore):
    a = store.create_course("Course A").id
    b = store.create_course("Course B").id
    assert a != b

    store.save_explanation(cid_a := a, Explanation(deck_id="d", slide_index=0, body="A-only body"))
    store.save_explanation(b, Explanation(deck_id="d", slide_index=0, body="B-only body"))
    store.save_ref_text(a, "f", "A-only ref")
    store.save_ref_text(b, "f", "B-only ref")
    store.index_path(a).write_text('{"chunk_id": "d:0", "text": "A-only chunk"}\n', encoding="utf-8")
    store.index_path(b).write_text('{"chunk_id": "d:0", "text": "B-only chunk"}\n', encoding="utf-8")

    a_bodies = [e.body for e in store.load_explanations(cid_a, "d")]
    b_bodies = [e.body for e in store.load_explanations(b, "d")]
    assert a_bodies == ["A-only body"]
    assert b_bodies == ["B-only body"]
    assert "B-only body" not in a_bodies
    assert "A-only" not in store.load_ref_texts(b)["f"]

    # the two containers are disjoint on disk
    dir_a, dir_b = store.course_dir(a), store.course_dir(b)
    assert dir_a != dir_b
    assert dir_a not in dir_b.parents and dir_b not in dir_a.parents
    assert store.index_path(a) != store.index_path(b)
    assert dir_a in store.index_path(a).parents
    assert dir_b in store.index_path(b).parents
    assert "A-only chunk" not in store.index_path(b).read_text("utf-8")

    # deleting B leaves A untouched
    store.delete_course(b)
    assert store.exists(a)
    assert [e.body for e in store.load_explanations(a, "d")] == ["A-only body"]


def test_store_defaults_to_env_courses_root(tmp_courses, monkeypatch):
    s = CourseStore()
    assert s.root == tmp_courses
    c = s.create_course("Env Rooted")
    assert (tmp_courses / c.id / "course.json").is_file()
