"""Gate G6 / invariant 1: course isolation.

Enrich course A with a distinctive vocabulary, then process course B and prove
that not one word of A reaches B — not in B's index, not in B's retrieved
chunks, not in B's summary or overview, and above all not in the prompt text
that actually goes to the model.
"""

from __future__ import annotations

import pytest

from app.embed import HashingEmbedder
from app.llm import FakeClient
from app.pipeline import build_context, process_course
from app.vectors import VectorIndex
from tests.test_pipeline import make_course, make_deck

# Words that appear ONLY in course A. Any of these turning up in course B's
# context is a leak.
A_WORDS = [
    "mitochondria",
    "krebs",
    "oxaloacetate",
    "ubiquinone",
    "chemiosmotic",
]

A_OVERVIEW = (
    "Cellular Bioenergetics studies the mitochondria and the krebs cycle. "
    "Students trace oxaloacetate through the chemiosmotic machinery and "
    "account for the role of ubiquinone in electron transport."
)

A_SLIDES = [
    "Mitochondria as the site of respiration\nThe mitochondria house the krebs "
    "cycle enzymes within the matrix",
    "The krebs cycle\nAcetyl-CoA condenses with oxaloacetate to form citrate",
    "Regenerating oxaloacetate\nEight steps return the cycle to oxaloacetate",
    "Electron carriers\nUbiquinone shuttles electrons within the inner "
    "mitochondria membrane",
    "The chemiosmotic hypothesis\nA proton gradient across the mitochondria "
    "inner membrane drives ATP synthesis, the chemiosmotic mechanism",
]

B_OVERVIEW = (
    "Constitutional Law in Practice examines how a written constitution "
    "allocates power between a legislature, an executive and a judiciary, and "
    "how courts review statutes for compliance with entrenched rights."
)

B_SLIDES = [
    "Course introduction\nWhat a constitution does and why entrenchment matters",
    "Separation of powers\nLegislature, executive and judiciary as distinct "
    "branches with checks on one another",
    "Judicial review\nCourts assessing whether a statute conforms to the "
    "constitution and striking down those that do not",
    "Entrenched rights\nProvisions that an ordinary legislative majority "
    "cannot amend, and the doctrine of proportionality",
    "Remedies\nDeclarations of invalidity, reading down a statute, and "
    "suspended orders of invalidity",
]


@pytest.fixture
def two_courses(store):
    """Course A processed and enriched; course B imported but untouched."""
    make_course(store, "Cellular Bioenergetics", A_OVERVIEW)
    make_deck(store, "cellular-bioenergetics", "aw1", "Bio Week 1", A_SLIDES)

    make_course(store, "Constitutional Law in Practice", B_OVERVIEW)
    make_deck(store, "constitutional-law-in-practice", "bw1", "Law Week 1", B_SLIDES)

    embedder = HashingEmbedder()
    a_progress = process_course(
        store, "cellular-bioenergetics", FakeClient(), embedder
    )
    assert a_progress.state == "done"
    return "cellular-bioenergetics", "constitutional-law-in-practice"


def _leaks(text: str) -> list[str]:
    lowered = (text or "").lower()
    return [w for w in A_WORDS if w in lowered]


def test_course_a_is_actually_enriched(store, two_courses):
    """Guard the guard: if A were empty, everything below would pass vacuously."""
    course_a, _ = two_courses
    index = VectorIndex(store.index_path(course_a))
    assert index.count() == len(A_SLIDES)
    blob = " ".join(r.text for r in index.all()).lower()
    assert all(w in blob for w in A_WORDS)
    assert store.load_progress(course_a).running_summary.strip()


def test_b_index_holds_no_course_a_deck_or_vocabulary(store, two_courses):
    course_a, course_b = two_courses
    process_course(store, course_b, FakeClient(), HashingEmbedder())

    a_decks = {d.id for d in store.get_course(course_a).decks}
    b_decks = {d.id for d in store.get_course(course_b).decks}
    assert a_decks and b_decks and not (a_decks & b_decks)

    rows = VectorIndex(store.index_path(course_b)).all()
    assert rows, "course B indexed nothing, so this test would prove nothing"
    for row in rows:
        assert row.deck_id in b_decks
        assert row.deck_id not in a_decks
        assert _leaks(row.text) == [], f"course A vocabulary in {row.chunk_id}"


def test_no_b_slide_retrieves_course_a_content(store, two_courses):
    _, course_b = two_courses
    embedder = HashingEmbedder()
    process_course(store, course_b, FakeClient(), embedder)

    b_decks = {d.id for d in store.get_course(course_b).decks}
    for index in range(len(B_SLIDES)):
        ctx = build_context(store, course_b, "bw1", index, embedder)
        for row in ctx.retrieved:
            assert row.deck_id in b_decks
            assert _leaks(row.text) == [], (
                f"slide {index} retrieved course A content: {row.chunk_id}"
            )


def test_b_summary_and_overview_are_free_of_course_a(store, two_courses):
    _, course_b = two_courses
    progress = process_course(store, course_b, FakeClient(), HashingEmbedder())

    assert progress.running_summary.strip()
    assert _leaks(progress.running_summary) == []
    assert _leaks(store.get_course(course_b).overview) == []
    for exp in store.load_explanations(course_b, "bw1"):
        assert _leaks(exp.body) == []
        assert _leaks(exp.heading) == []
        assert _leaks(exp.example) == []


def test_the_prompt_sent_for_course_b_contains_nothing_from_course_a(
    store, two_courses
):
    """The strongest form of G6: inspect what actually went to the client."""
    _, course_b = two_courses
    client = FakeClient()
    process_course(store, course_b, client, HashingEmbedder())

    assert len(client.prompts) == len(B_SLIDES)
    for prompt in client.prompts:
        assert _leaks(prompt) == [], f"course A vocabulary reached the model: {prompt[:200]}"
    # And the prompts really are populated, not blank.
    assert all("## Course overview" in p for p in client.prompts)
    assert any("judicial review" in p.lower() for p in client.prompts)


def test_an_index_row_from_a_foreign_deck_is_dropped(store, two_courses):
    """Defence in depth: even a hand-planted foreign row never reaches the model."""
    from app.contracts import IndexRow

    course_a, course_b = two_courses
    embedder = HashingEmbedder()
    process_course(store, course_b, FakeClient(), embedder)

    smuggled_text = (
        "The krebs cycle inside the mitochondria regenerates oxaloacetate "
        "via chemiosmotic coupling and ubiquinone."
    )
    VectorIndex(store.index_path(course_b)).add(
        [
            IndexRow(
                chunk_id="aw1:99",
                deck_id="aw1",  # a deck course B does not own
                slide_index=99,
                text=smuggled_text,
                vec=embedder.embed_passages([smuggled_text])[0],
            )
        ]
    )

    for index in range(len(B_SLIDES)):
        ctx = build_context(store, course_b, "bw1", index, embedder)
        assert all(r.chunk_id != "aw1:99" for r in ctx.retrieved)
        assert _leaks(" ".join(r.text for r in ctx.retrieved)) == []


def test_processing_b_leaves_course_a_untouched(store, two_courses):
    course_a, course_b = two_courses
    before = [e.to_dict() for e in store.load_explanations(course_a, "aw1")]
    before_index = VectorIndex(store.index_path(course_a)).count()

    process_course(store, course_b, FakeClient(), HashingEmbedder())

    after = [e.to_dict() for e in store.load_explanations(course_a, "aw1")]
    assert after == before
    assert VectorIndex(store.index_path(course_a)).count() == before_index


def test_the_two_index_files_are_separate_files(store, two_courses):
    course_a, course_b = two_courses
    a_path = store.index_path(course_a)
    b_path = store.index_path(course_b)
    assert a_path != b_path
    assert a_path.parent.name == course_a
    assert b_path.parent.name == course_b
