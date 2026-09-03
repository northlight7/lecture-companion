"""Gate G5: end-to-end generation with the model stubbed.

A slideshow must produce exactly one non-empty explanation per slide, each one
referencing the course overview, with context that actually grows as the course
goes on and a prompt that stays inside its budget.
"""

from __future__ import annotations

import base64

import pytest

from app.contracts import Deck
from app.embed import HashingEmbedder, cosine
from app.llm import FakeClient, build_prompt_text
from app.pipeline import (
    PROMPT_WORD_BUDGET,
    build_context,
    next_unfinished,
    process_course,
    recompute_running_summary,
)
from app.vectors import VectorIndex

# A real 1x1 PNG. The pipeline only base64s it, but a valid file keeps the
# fixtures honest.
PNG_1PX = base64.b64decode(
    b"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
    b"IQAAAABJRU5ErkJggg=="
)


def make_course(store, title: str, overview: str):
    """Create a course and give it an overview, as the importer would."""
    course = store.create_course(title)
    course.overview = overview
    store.save_course(course)
    return course


def make_deck(store, course_id: str, deck_id: str, title: str, texts: list[str]):
    """Write slide PNG + TXT pairs directly and register the deck.

    Deliberately independent of the importer so this suite proves the pipeline,
    not the extractors.
    """
    sdir = store.slides_dir(course_id, deck_id)
    sdir.mkdir(parents=True, exist_ok=True)
    for i, text in enumerate(texts):
        stem = store.slide_stem(i)
        (sdir / f"{stem}.png").write_bytes(PNG_1PX)
        (sdir / f"{stem}.txt").write_text(text, encoding="utf-8")
    deck = Deck(id=deck_id, source_file_id="src-" + deck_id, title=title,
                n_slides=len(texts))
    store.add_deck(course_id, deck)
    return deck


OVERVIEW = (
    "Cellular Bioenergetics traces how a eukaryotic cell converts nutrients "
    "into usable chemical energy. The course moves from glycolysis in the "
    "cytosol to the citric acid cycle and finally oxidative phosphorylation. "
    "By the end a student should be able to trace a carbon atom from glucose "
    "to carbon dioxide and account for the ATP yield at every step. Assessment "
    "is one problem set and a final written examination."
)

SLIDE_TEXTS = [
    "Course introduction\nWhy cells need a common energy currency\n"
    "Adenosine triphosphate as the universal carrier of chemical energy",
    "Glycolysis overview\nTen enzymatic steps in the cytosol converting one "
    "glucose molecule into two pyruvate molecules with a net yield of two ATP",
    "The pyruvate dehydrogenase complex\nPyruvate is decarboxylated and joined "
    "to coenzyme A, producing acetyl-CoA and one molecule of NADH",
    "The citric acid cycle\nAcetyl-CoA condenses with oxaloacetate to form "
    "citrate; eight enzymatic steps regenerate oxaloacetate and yield NADH, "
    "FADH2 and GTP",
    "Oxidative phosphorylation\nNADH and FADH2 donate electrons to the "
    "respiratory chain, and the resulting proton gradient drives ATP synthase "
    "to produce the bulk of the cell's ATP",
]


@pytest.fixture
def course(store):
    make_course(store, "Cellular Bioenergetics", OVERVIEW)
    make_deck(store, "cellular-bioenergetics", "w1", "Week 1", SLIDE_TEXTS)
    return "cellular-bioenergetics"


# --------------------------------------------------------------------------
# The embedder has to be good enough for the retrieval assertions to mean
# something. Prove that before relying on it.
# --------------------------------------------------------------------------


def test_hashing_embedder_beats_an_unrelated_sentence():
    emb = HashingEmbedder()
    query = "the citric acid cycle oxidises acetyl-CoA to carbon dioxide"
    paraphrase = "acetyl-CoA enters the citric acid cycle and is oxidised to carbon dioxide"
    unrelated = "the treaty of westphalia reorganised sovereignty in europe"

    qv, pv, uv = emb.embed_passages([query, paraphrase, unrelated])
    assert cosine(qv, pv) > cosine(qv, uv)
    assert cosine(qv, pv) > 0.3
    assert len(qv) == emb.dim == 384


def test_hashing_embedder_is_deterministic_across_instances():
    a = HashingEmbedder().embed_query("oxidative phosphorylation")
    b = HashingEmbedder().embed_query("oxidative phosphorylation")
    assert a == b


# --------------------------------------------------------------------------
# G5
# --------------------------------------------------------------------------


def test_every_slide_gets_exactly_one_explanation_referencing_the_overview(
    store, course
):
    client = FakeClient()
    embedder = HashingEmbedder()

    progress = process_course(store, course, client, embedder)

    assert progress.state == "done", progress.pause_reason
    assert next_unfinished(store, course) is None

    explanations = store.load_explanations(course, "w1")
    assert len(explanations) == len(SLIDE_TEXTS)
    assert [e.slide_index for e in explanations] == list(range(len(SLIDE_TEXTS)))

    # Exactly one per slide, all non-empty.
    for exp in explanations:
        assert exp.body.strip(), f"slide {exp.slide_index} has an empty body"
        assert exp.deck_id == "w1"
        assert exp.heading.strip()

    # Each one references the course overview. The stub echoes a verbatim
    # phrase from it, so this is a real check that the overview reached the
    # model, not a check that the stub is chatty.
    overview_phrase = " ".join(OVERVIEW.split()[:6])
    for exp in explanations:
        assert overview_phrase in exp.body, (
            f"slide {exp.slide_index} does not reference the course overview"
        )

    # One index row per slide.
    index = VectorIndex(store.index_path(course))
    assert index.count() == len(SLIDE_TEXTS)
    assert {r.chunk_id for r in index.all()} == {
        f"w1:{i}" for i in range(len(SLIDE_TEXTS))
    }


def test_context_grows_across_the_course(store, course):
    embedder = HashingEmbedder()

    # Before anything is processed the index is empty, so slide 1 can retrieve
    # nothing. That is the "no prior material" case.
    first_ctx = build_context(store, course, "w1", 0, embedder)
    assert first_ctx.retrieved == []
    assert first_ctx.running_summary == ""

    process_course(store, course, FakeClient(), embedder)

    # After the run, the last slide has real earlier material to draw on, and
    # never its own chunk.
    last = len(SLIDE_TEXTS) - 1
    last_ctx = build_context(store, course, "w1", last, embedder)
    assert last_ctx.retrieved, "the final slide retrieved nothing from earlier"
    assert all(r.slide_index < last for r in last_ctx.retrieved)
    assert all(r.chunk_id != f"w1:{last}" for r in last_ctx.retrieved)
    assert all(r.deck_id == "w1" for r in last_ctx.retrieved)


def test_running_summary_grows_and_names_earlier_headings(store, course):
    client = FakeClient()
    progress = process_course(store, course, client, HashingEmbedder())

    summary = progress.running_summary
    assert summary.strip()
    # One gist line per slide.
    assert summary.count("- Slide ") == len(SLIDE_TEXTS)
    # It names earlier slides by their headings (the stub takes the heading
    # from the slide's first text line).
    assert "Glycolysis overview" in summary
    assert "The citric acid cycle" in summary

    # And the stored summary is exactly what a rebuild from explanations gives.
    assert recompute_running_summary(store, course, client) == summary


def test_summary_grows_monotonically_slide_by_slide(store, course):
    client = FakeClient()
    embedder = HashingEmbedder()
    lengths: list[int] = []

    def record(_deck_id, _index, _heading):
        lengths.append(len(store.load_progress(course).running_summary))

    process_course(store, course, client, embedder, on_progress=record)
    assert lengths == sorted(lengths)
    assert lengths[0] < lengths[-1]


def test_prompt_stays_under_budget_for_a_sixty_slide_course(store):
    """A long course must not blow the request. Every part of the context is
    capped, so the assembled prompt has a ceiling regardless of course size."""
    make_course(store, "Long Course", OVERVIEW * 3)
    texts = [
        f"Lecture topic number {i}\n"
        + " ".join(
            f"substantive term-{i}-{j} about metabolic regulation and enzyme "
            "kinetics in the cell"
            for j in range(30)
        )
        for i in range(60)
    ]
    make_deck(store, "long-course", "big", "Big Deck", texts)

    client = FakeClient()
    embedder = HashingEmbedder()
    progress = process_course(store, "long-course", client, embedder)
    assert progress.state == "done", progress.pause_reason
    assert len(store.load_explanations("long-course", "big")) == 60

    ctx = build_context(store, "long-course", "big", 59, embedder)
    prompt = build_prompt_text(ctx)
    words = len(prompt.split())
    assert words < PROMPT_WORD_BUDGET, f"prompt is {words} words"

    # The parts are individually capped too, not just the total by luck.
    assert len(ctx.running_summary.split()) <= 1210
    for row in ctx.retrieved:
        assert len(row.text.split()) <= 210


def test_reprocessing_a_finished_course_calls_the_model_zero_times(store, course):
    embedder = HashingEmbedder()
    process_course(store, course, FakeClient(), embedder)

    second = FakeClient()
    progress = process_course(store, course, second, embedder)
    assert second.calls == []
    assert progress.state == "done"
    assert len(store.load_explanations(course, "w1")) == len(SLIDE_TEXTS)


# --------------------------------------------------------------------------
# Guards claimed by the modules, checked rather than assumed
# --------------------------------------------------------------------------


def test_a_missing_index_file_is_an_empty_index_not_an_error(store):
    make_course(store, "Empty", OVERVIEW)
    index = VectorIndex(store.index_path("empty"))
    assert not index.path.exists()
    assert index.all() == []
    assert index.count() == 0
    assert index.search([0.0] * 384, 4) == []
    assert index.has("nope:0") is False


def test_a_row_with_the_wrong_vector_length_is_skipped_not_fatal(store, course):
    """A changed embedder must not corrupt search."""
    process_course(store, course, FakeClient(), HashingEmbedder())
    path = store.index_path(course)
    good = VectorIndex(path).count()

    with open(path, "a", encoding="utf-8") as fh:
        fh.write('{"chunk_id":"w1:900","deck_id":"w1","slide_index":900,'
                 '"text":"stale","vec":[0.1,0.2,0.3]}\n')
        fh.write("this line is not even json\n")

    index = VectorIndex(path)
    assert index.count() == good
    assert index.has("w1:900") is False
    hits = index.search(HashingEmbedder().embed_query("glycolysis"), 4)
    assert all(row.chunk_id != "w1:900" for row, _ in hits)


def test_get_client_returns_the_stub_under_lc_fake_model(monkeypatch):
    from app.llm import get_client

    monkeypatch.setenv("LC_FAKE_MODEL", "1")
    client = get_client()
    assert isinstance(client, FakeClient)
    assert client.test_connection()[0] is True


def test_get_embedder_honours_lc_embedder_hash(monkeypatch):
    from app.embed import get_embedder, reset_embedder_cache

    monkeypatch.setenv("LC_EMBEDDER", "hash")
    reset_embedder_cache()
    try:
        assert isinstance(get_embedder(), HashingEmbedder)
    finally:
        reset_embedder_cache()
