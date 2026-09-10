from __future__ import annotations

from app.contracts import Artifact, Deck, LearningObject, SourceLocator
from app.llm import FakeClient
from app.organization import (
    apply_model_suggestion,
    load_organization,
    related_material_for_deck,
    save_organization,
)


def _artifact(aid: str, digest: str, name: str, source_path: str, kind: str) -> Artifact:
    return Artifact(
        id=aid,
        content_hash=digest,
        filename=name,
        source_path=source_path,
        kind=kind,
        purpose="lecture" if kind == "pptx" else "dataset",
        stored_path=f"raw/{digest}.{kind}",
    )


def test_manual_folders_are_editable_and_reject_foreign_ids(store):
    cid = store.create_course("Organization").id
    a = _artifact("a1", "1" * 64, "lecture_1.pptx", "Week 1/lecture_1.pptx", "pptx")
    b = _artifact("b1", "2" * 64, "tutorial_1.csv", "Week 1/tutorial_1.csv", "csv")
    store.save_artifacts(cid, [a, b])

    save_organization(store, cid, {a.id: "Week 1", b.id: "Week 1"})
    assert load_organization(store, cid)["assignments"] == {"a1": "Week 1", "b1": "Week 1"}

    save_organization(store, cid, {a.id: "Lecture 1", b.id: "Lecture 1"})
    assert set(load_organization(store, cid)["assignments"].values()) == {"Lecture 1"}

    try:
        save_organization(store, cid, {"foreign": "Leak"})
    except KeyError:
        pass
    else:
        raise AssertionError("a foreign artifact id was accepted")


def test_model_grouping_and_related_source_context_are_exact(store):
    cid = store.create_course("Grouped").id
    deck_artifact = _artifact(
        "deck-a", "a" * 64, "lecture_2.pptx", "Lecture 2/lecture_2.pptx", "pptx"
    )
    data_artifact = _artifact(
        "data-a", "b" * 64, "tutorial_2.csv", "Lecture 2/tutorial_2.csv", "csv"
    )
    store.save_artifacts(cid, [deck_artifact, data_artifact])
    deck_id = f"deck-{deck_artifact.content_hash[:12]}"
    store.add_deck(cid, Deck(deck_id, deck_artifact.content_hash[:12], "Lecture 2", 1))
    source = LearningObject(
        id="field-revenue",
        artifact_id=data_artifact.id,
        object_type="dataset_field",
        locator=SourceLocator(
            artifact_id=data_artifact.id,
            kind="csv",
            dataset_field="revenue",
        ),
        text="Revenue is recorded in HKD thousands.",
    )
    store.save_learning_objects(cid, data_artifact.id, [source])

    result = apply_model_suggestion(store, cid, FakeClient())
    assert result["method"] == "model"
    assert result["assignments"][deck_artifact.id] == "Lecture 2"
    assert result["assignments"][data_artifact.id] == "Lecture 2"

    text, source_ids = related_material_for_deck(store, cid, deck_id)
    assert "tutorial_2.csv, field revenue" in text
    assert "HKD thousands" in text
    assert source_ids == ["object:data-a:field-revenue"]


def test_organization_is_structurally_course_isolated(store):
    a = store.create_course("A").id
    b = store.create_course("B").id
    art_a = _artifact("same", "a" * 64, "a.csv", "a.csv", "csv")
    art_b = _artifact("same", "b" * 64, "b.csv", "b.csv", "csv")
    store.save_artifacts(a, [art_a])
    store.save_artifacts(b, [art_b])
    save_organization(store, a, {"same": "A only"})
    save_organization(store, b, {"same": "B only"})
    assert load_organization(store, a)["assignments"]["same"] == "A only"
    assert load_organization(store, b)["assignments"]["same"] == "B only"
