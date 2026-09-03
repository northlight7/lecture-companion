"""Gate G4: import filing.

A fixture folder (a lecture PDF plus a syllabus doc) is classified and filed
into the right folder and the right role, and nothing is written outside the
course directory.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.importer import BulkGroup, deck_id_for, import_bulk, import_files, sort_bulk

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _payload(*names: str) -> list[tuple[str, bytes]]:
    return [(n, (FIXTURES / n).read_bytes()) for n in names]


@pytest.fixture
def course(store):
    return store.create_course("COMP5211 Databases")


def test_lecture_and_syllabus_are_filed_by_role(store, course):
    res = import_files(store, course.id, _payload("lecture_w1.pdf", "syllabus.pdf"))
    assert res.errors == [], res.errors
    assert len(res.filed) == 2

    by_name = {f.filename: f for f in res.filed}
    lecture = by_name["lecture_w1.pdf"]
    syllabus = by_name["syllabus.pdf"]

    assert lecture.role == "slides", lecture.reason
    assert lecture.deck_id
    assert lecture.n_slides == 6

    assert syllabus.role == "reference", syllabus.reason
    assert syllabus.deck_id == "", "a reference doc must not produce a deck"
    assert syllabus.n_slides == 0


def test_deck_lands_on_disk_with_six_slides(store, course):
    res = import_files(store, course.id, _payload("lecture_w1.pdf"))
    deck_id = res.filed[0].deck_id

    reloaded = store.get_course(course.id)
    assert [d.id for d in reloaded.decks] == [deck_id]
    assert reloaded.decks[0].n_slides == 6

    sdir = store.slides_dir(course.id, deck_id)
    assert sdir.is_dir()
    assert len(sorted(sdir.glob("page-*.png"))) == 6
    slides = store.load_slides(course.id, deck_id)
    assert len(slides) == 6
    assert all(s.text.strip() for s in slides)


def test_syllabus_text_is_retrievable_and_makes_no_deck(store, course):
    res = import_files(store, course.id, _payload("lecture_w1.pdf", "syllabus.pdf"))
    syllabus = [f for f in res.filed if f.role == "reference"][0]

    refs = store.load_ref_texts(course.id)
    assert syllabus.file_id in refs
    body = refs[syllabus.file_id].lower()
    assert "learning outcomes" in body and "office hours" in body

    reloaded = store.get_course(course.id)
    assert len(reloaded.decks) == 1, "the syllabus must not have produced a deck"
    assert not (store.slides_dir(course.id, deck_id_for(syllabus.file_id))).exists()


def test_every_reason_is_a_human_sentence(store, course):
    res = import_files(store, course.id, _payload("lecture_w1.pdf", "syllabus.pdf", "lecture_w2.pptx"))
    assert res.errors == [], res.errors
    for item in res.filed:
        assert item.reason.strip(), f"{item.filename} has no classification reason"
        assert len(item.reason.split()) >= 3, f"reason not a sentence: {item.reason!r}"
        assert 0.0 < item.confidence <= 1.0


def test_pptx_is_filed_as_slides(store, course):
    res = import_files(store, course.id, _payload("lecture_w2.pptx"))
    assert res.errors == [], res.errors
    item = res.filed[0]
    assert item.role == "slides"
    assert item.n_slides == 4


def test_nothing_is_written_outside_the_course_dir(store, tmp_courses, course):
    other = store.create_course("MATH5011 Analysis")
    before = sorted(p.relative_to(tmp_courses) for p in tmp_courses.rglob("*"))

    import_files(store, course.id, _payload("lecture_w1.pdf", "syllabus.pdf"))

    after = sorted(p.relative_to(tmp_courses) for p in tmp_courses.rglob("*"))
    new = [p for p in after if p not in before]
    assert new, "the import wrote nothing at all"
    cdir = store.course_dir(course.id).relative_to(tmp_courses)
    for p in new:
        assert str(p).startswith(str(cdir) + "/") or p == cdir, (
            f"import wrote outside the course dir: {p}"
        )
    # and the other course was left untouched
    assert not any(str(p).startswith(str(store.course_dir(other.id).relative_to(tmp_courses)) + "/")
                   for p in new)


def test_hostile_filename_stays_inside_raw(store, course, tmp_courses):
    data = (FIXTURES / "lecture_w1.pdf").read_bytes()
    res = import_files(store, course.id, [("../../etc/passwd.pdf", data)])
    assert res.errors == [], res.errors
    item = res.filed[0]

    stored = store.course_dir(course.id) / item.__dict__.get("stored_path", "")
    sf = [f for f in store.get_course(course.id).files if f.id == item.file_id][0]
    abs_path = (store.course_dir(course.id) / sf.stored_path).resolve()

    assert abs_path.is_file()
    raw_dir = store.raw_dir(course.id).resolve()
    assert str(abs_path).startswith(str(raw_dir) + "/"), abs_path
    assert ".." not in sf.stored_path
    # nothing escaped the courses root
    assert not (tmp_courses.parent / "etc").exists()
    assert item.deck_id.startswith("deck-")
    assert "passwd" not in item.deck_id  # the id comes from the file_id, not the name


def test_deck_id_is_derived_from_file_id_only():
    a = deck_id_for("abc123")
    assert a == deck_id_for("abc123")
    assert a.startswith("deck-")
    assert "/" not in a and ".." not in a
    assert deck_id_for("../../evil") == deck_id_for("evil")


def test_sort_bulk_groups_by_course_code():
    names = ["COMP5211_w1.pdf", "COMP5211 syllabus.pdf", "MATH5011_lec1.pdf"]
    groups = sort_bulk([(n, b"") for n in names])
    assert len(groups) == 2, [(g.title, g.filenames) for g in groups]
    by_title = {g.title: set(g.filenames) for g in groups}
    assert by_title["COMP5211"] == {"COMP5211_w1.pdf", "COMP5211 syllabus.pdf"}
    assert by_title["MATH5011"] == {"MATH5011_lec1.pdf"}
    for g in groups:
        assert g.reason.strip()
        assert isinstance(g, BulkGroup)


def test_sort_bulk_falls_back_to_shared_prefix_then_one_each():
    groups = sort_bulk(["Machine Learning wk1.pdf", "Machine Learning wk2.pdf", "random.pdf"])
    assert len(groups) == 2
    titles = {g.title.lower() for g in groups}
    assert any("machine learning" in t for t in titles)


def test_import_bulk_creates_one_course_per_group(store, tmp_courses):
    lec = (FIXTURES / "lecture_w1.pdf").read_bytes()
    syl = (FIXTURES / "syllabus.pdf").read_bytes()
    out = import_bulk(store, [
        ("COMP5211_w1.pdf", lec),
        ("COMP5211 syllabus.pdf", syl),
        ("MATH5011_lec1.pdf", lec),
    ])
    assert len(out) == 2
    titles = sorted(c.title for c, _ in out)
    assert titles == ["COMP5211", "MATH5011"]
    for c, res in out:
        assert res.errors == [], res.errors
        assert res.filed
    comp = [c for c, _ in out if c.title == "COMP5211"][0]
    assert len(comp.files) == 2
    assert len(comp.decks) == 1, "the syllabus must not become a deck"


def test_unsupported_file_is_an_error_not_a_crash(store, course):
    res = import_files(store, course.id, [("notes.txt", b"hello")])
    assert res.filed == []
    assert len(res.errors) == 1 and "notes.txt" in res.errors[0]
