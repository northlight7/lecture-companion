"""Gate G1 and the HTTP surface.

Everything here runs offline and free: `LC_FAKE_MODEL=1` selects the stub
vision client and `LC_COURSES_ROOT` points at a tmp dir, so no test can touch
the developer's real `Courses/`.

The keyring is faked in-process too. `keystore.set_key` is still the function
under test, but its backend is a dict, so running the suite never writes to (or
prompts for) the real macOS keychain.
"""

from __future__ import annotations

import importlib
from io import BytesIO
import json
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from PIL import Image

FIXTURES = Path(__file__).parent / "fixtures"
LECTURE = FIXTURES / "lecture_w1.pdf"
SYLLABUS = FIXTURES / "syllabus.pdf"

# Modules written by other builders. A missing one skips its tests loudly
# rather than being faked into a pass.
_NEEDED_FOR_IMPORT = ("app.importer",)
_NEEDED_FOR_PIPELINE = ("app.importer", "app.llm", "app.pipeline")


def _missing(names) -> list[str]:
    out = []
    for name in names:
        try:
            importlib.import_module(name)
        except Exception:  # noqa: BLE001 - half-written module counts as missing
            out.append(name)
    return out


class _FakeKeyring:
    """Stand-in for the `keyring` module inside app.keystore."""

    def __init__(self) -> None:
        self._d: dict[tuple[str, str], str] = {}

    def get_password(self, service, account):
        return self._d.get((service, account))

    def set_password(self, service, account, value):
        self._d[(service, account)] = value

    def delete_password(self, service, account):
        self._d.pop((service, account), None)


@pytest.fixture
def client(tmp_path, monkeypatch) -> TestClient:
    root = tmp_path / "Courses"
    root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("LC_COURSES_ROOT", str(root))
    monkeypatch.setenv("LC_FAKE_MODEL", "1")

    from app import keystore

    monkeypatch.setattr(keystore, "keyring", _FakeKeyring())
    monkeypatch.setattr(keystore, "_memory", {})

    from app.main import app

    with TestClient(app) as c:
        yield c


# --------------------------------------------------------------------------
# G1: boot + health
# --------------------------------------------------------------------------


def test_health_is_exactly_ok_true(client: TestClient) -> None:
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_index_is_served(client: TestClient) -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    assert "<title" in resp.text.lower()


def test_app_icon_is_served_with_transparent_corners(client: TestClient) -> None:
    resp = client.get("/favicon.ico")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    icon = Image.open(BytesIO(resp.content))
    assert icon.mode == "RGBA"
    assert icon.size == (1024, 1024)
    assert icon.getpixel((0, 0))[3] == 0
    assert icon.getpixel((512, 512))[3] == 255


def test_notebook_execution_http_contract_is_confirmed_scoped_and_serves_only_listed_outputs(client: TestClient) -> None:
    cid = client.post("/api/courses", json={"title": "Execution API"}).json()["id"]
    notebook = json.dumps({
        "cells": [{
            "cell_type": "code", "id": "plot", "metadata": {},
            "execution_count": None, "outputs": [],
            "source": ["import matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])\nprint('HTTP_RUN')"],
        }],
        "metadata": {"kernelspec": {"name": "python3"}}, "nbformat": 4, "nbformat_minor": 5,
    }).encode("utf-8")
    uploaded = client.post(
        f"/api/courses/{cid}/files",
        files=[("files", ("api.ipynb", notebook, "application/x-ipynb+json"))],
    )
    assert uploaded.status_code == 200, uploaded.text
    aid = uploaded.json()["filed"][0]["artifact_id"]
    base = f"/api/courses/{cid}/artifacts/{aid}/execution"
    environment = client.get(base + "/environment")
    assert environment.status_code == 200
    assert environment.json()["environment"]["remote_model_used"] is False
    assert client.post(base, json={"confirmed": False}).status_code == 412
    started = client.post(base, json={"confirmed": True, "cell_timeout_seconds": 10})
    assert started.status_code == 200, started.text
    run_id = started.json()["run_id"]
    for _ in range(200):
        status = client.get(f"{base}/{run_id}").json()
        if status["state"] in {"done", "error", "paused"}:
            break
        time.sleep(0.05)
    assert status["state"] == "done", status
    plot = status["results"][0]["plots"][0]
    served = client.get(f"{base}/{run_id}/outputs/{plot}")
    assert served.status_code == 200 and served.headers["content-type"] == "image/png"
    assert client.get(f"{base}/{run_id}/outputs/cell-0001-plot-99.png").status_code == 404
    other = client.post("/api/courses", json={"title": "Other Course"}).json()["id"]
    assert client.get(f"/api/courses/{other}/artifacts/{aid}/execution/{run_id}").status_code == 404


def test_workbook_inspection_http_contract_is_local_scoped_and_copy_only(client: TestClient) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Checks"
    sheet["A1"] = 3
    sheet["B1"] = "=A1*2"
    stream = BytesIO()
    workbook.save(stream)
    payload = stream.getvalue()
    cid = client.post("/api/courses", json={"title": "Workbook API"}).json()["id"]
    uploaded = client.post(
        f"/api/courses/{cid}/files",
        files=[("files", ("checks.xlsx", payload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))],
    )
    aid = uploaded.json()["filed"][0]["artifact_id"]
    base = f"/api/courses/{cid}/artifacts/{aid}/workbook"
    assert client.get(base + "/status").json()["exists"] is False
    inspected = client.post(base + "/inspect", json={})
    assert inspected.status_code == 200, inspected.text
    body = inspected.json()
    assert body["summary"]["formulas_independently_verified"] == 1
    assert body["formulas"][0]["calculated_value"] == 6
    assert body["source_bytes_preserved"] is True and body["remote_model_used"] is False
    experiment = client.post(base + "/experiments", json={
        "sheet": "Checks", "cell": "B1", "formula": "=A1*3",
    })
    assert experiment.status_code == 200, experiment.text
    assert experiment.json()["calculated_value"] == 9
    assert experiment.json()["source_bytes_preserved"] is True
    assert client.get(f"/api/courses/no-such-course/artifacts/{aid}/workbook/status").status_code == 404


# --------------------------------------------------------------------------
# Invariant 4: the key never leaves the keyring
# --------------------------------------------------------------------------


def test_connection_never_returns_the_key(client: TestClient) -> None:
    from app import keystore

    secret = "sk-testkey1234567890"
    keystore.set_key(secret)
    assert keystore.get_key() == secret  # the fake backend really stored it

    resp = client.get("/api/connection")
    assert resp.status_code == 200
    body = resp.json()
    assert "connected" in body and "hint" in body
    assert body["connected"] is True
    assert body["hint"]
    assert secret not in resp.text
    assert secret not in str(body)
    # The masked hint keeps at most the first 5 and last 4 characters.
    assert body["hint"] == "sk-te…7890"


def test_delete_connection_clears_the_key(client: TestClient) -> None:
    from app import keystore

    keystore.set_key("sk-testkey1234567890")
    resp = client.delete("/api/connection")
    assert resp.status_code == 200
    assert keystore.get_key() is None
    # fake mode still reports connected, but with no hint
    assert client.get("/api/connection").json()["hint"] == ""


def test_connection_rejects_an_empty_key(client: TestClient) -> None:
    resp = client.post("/api/connection", json={"api_key": "  "})
    assert resp.status_code == 400
    assert "error" in resp.json()


# --------------------------------------------------------------------------
# Invariant 1: an unknown or hostile course id is a 404, never a file
# --------------------------------------------------------------------------


def test_unknown_course_is_404(client: TestClient) -> None:
    assert client.get("/api/courses/no-such-course").status_code == 404
    assert client.get("/api/courses/no-such-course/progress").status_code == 404
    assert client.post("/api/courses/no-such-course/process", json={}).status_code == 404
    assert client.get("/api/courses/no-such-course/decks/d/slides").status_code == 404


@pytest.mark.parametrize(
    "hostile",
    [
        "..%2F..%2Fetc%2Fpasswd",
        "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        "..",
        ".hidden",
    ],
)
def test_path_traversal_in_course_id_is_404(client: TestClient, hostile: str) -> None:
    resp = client.get(f"/api/courses/{hostile}")
    assert resp.status_code == 404, resp.text
    assert "root:" not in resp.text


# --------------------------------------------------------------------------
# courses
# --------------------------------------------------------------------------


def test_create_and_list_and_delete_a_course(client: TestClient) -> None:
    assert client.get("/api/courses").json() == []

    created = client.post("/api/courses", json={"title": "Machine Learning"})
    assert created.status_code == 200, created.text
    cid = created.json()["id"]
    assert cid == "machine-learning"
    assert created.json()["n_slides"] == 0

    listed = client.get("/api/courses").json()
    assert [c["id"] for c in listed] == [cid]

    detail = client.get(f"/api/courses/{cid}").json()
    assert detail["title"] == "Machine Learning"
    assert detail["decks"] == []
    assert detail["progress"]["state"] == "idle"

    assert client.delete(f"/api/courses/{cid}").status_code == 200
    assert client.get("/api/courses").json() == []


def test_create_course_needs_a_title(client: TestClient) -> None:
    assert client.post("/api/courses", json={"title": ""}).status_code == 400


# --------------------------------------------------------------------------
# G4 via HTTP: import filing
# --------------------------------------------------------------------------


def _upload_fixtures(client: TestClient, cid: str):
    with open(LECTURE, "rb") as a, open(SYLLABUS, "rb") as b:
        return client.post(
            f"/api/courses/{cid}/files",
            files=[
                ("files", ("lecture_w1.pdf", a.read(), "application/pdf")),
                ("files", ("syllabus.pdf", b.read(), "application/pdf")),
            ],
        )


@pytest.fixture
def imported(client: TestClient):
    missing = _missing(_NEEDED_FOR_IMPORT)
    if missing:
        pytest.skip(f"not written yet by another builder: {', '.join(missing)}")
    if not LECTURE.is_file() or not SYLLABUS.is_file():
        pytest.skip(f"fixtures missing: {LECTURE} / {SYLLABUS}")
    cid = client.post("/api/courses", json={"title": "Week One"}).json()["id"]
    resp = _upload_fixtures(client, cid)
    assert resp.status_code == 200, resp.text
    return client, cid, resp.json()


def test_import_files_by_role(imported) -> None:
    client, cid, body = imported
    filed = {row["filename"]: row for row in body["filed"]}
    assert set(filed) == {"lecture_w1.pdf", "syllabus.pdf"}

    lecture = filed["lecture_w1.pdf"]
    assert lecture["role"] == "slides"
    assert lecture["n_slides"] == 6
    assert lecture["deck_id"]
    assert lecture["reason"], "the UI shows the filing reason; it must not be empty"

    syllabus = filed["syllabus.pdf"]
    assert syllabus["role"] == "reference"
    assert syllabus["reason"]

    detail = client.get(f"/api/courses/{cid}").json()
    assert detail["n_slides"] == 6
    assert len(detail["decks"]) == 1
    assert detail["decks"][0]["n_slides"] == 6


def test_slide_listing_and_image(imported) -> None:
    client, cid, body = imported
    did = next(r["deck_id"] for r in body["filed"] if r["role"] == "slides")

    slides = client.get(f"/api/courses/{cid}/decks/{did}/slides").json()
    assert [s["index"] for s in slides] == [0, 1, 2, 3, 4, 5]
    assert all(s["has_explanation"] is False for s in slides)

    img = client.get(f"/api/courses/{cid}/decks/{did}/slides/0/image")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/png"
    assert len(img.content) > 0
    assert img.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert "max-age" in img.headers.get("cache-control", "")

    one = client.get(f"/api/courses/{cid}/decks/{did}/slides/0").json()
    assert one["slide"]["index"] == 0
    assert one["slide"]["text"].strip()
    assert one["explanation"] is None

    assert client.get(f"/api/courses/{cid}/decks/{did}/slides/99").status_code == 404
    assert client.get(f"/api/courses/{cid}/decks/nope/slides").status_code == 404


def test_import_preview_groups_a_pile(client: TestClient) -> None:
    missing = _missing(_NEEDED_FOR_IMPORT)
    if missing:
        pytest.skip(f"not written yet by another builder: {', '.join(missing)}")
    with open(LECTURE, "rb") as a, open(SYLLABUS, "rb") as b:
        resp = client.post(
            "/api/import/preview",
            files=[
                ("files", ("lecture_w1.pdf", a.read(), "application/pdf")),
                ("files", ("syllabus.pdf", b.read(), "application/pdf")),
            ],
        )
    assert resp.status_code == 200, resp.text
    groups = resp.json()["groups"]
    assert groups, "preview must propose at least one course"
    for g in groups:
        assert g["title"] and isinstance(g["filenames"], list) and g["filenames"]


# --------------------------------------------------------------------------
# G5 via HTTP: process every slide, then read the explanations back
# --------------------------------------------------------------------------


def test_process_explains_every_slide(imported) -> None:
    missing = _missing(_NEEDED_FOR_PIPELINE)
    if missing:
        pytest.skip(f"not written yet by another builder: {', '.join(missing)}")
    client, cid, body = imported
    did = next(r["deck_id"] for r in body["filed"] if r["role"] == "slides")

    started = client.post(f"/api/courses/{cid}/process", json={"deck_id": None})
    assert started.status_code == 200, started.text
    assert started.json()["started"] is True

    deadline = time.time() + 120
    progress = {}
    while time.time() < deadline:
        progress = client.get(f"/api/courses/{cid}/progress").json()
        if progress["state"] in ("done", "paused", "error") and not progress["running"]:
            break
        time.sleep(0.2)
    assert progress.get("state") == "done", f"pipeline did not finish: {progress}"
    assert progress["n_explained"] == progress["n_slides"] == 6

    slides = client.get(f"/api/courses/{cid}/decks/{did}/slides").json()
    assert len(slides) == 6
    assert all(s["has_explanation"] is True for s in slides), slides

    for s in slides:
        one = client.get(f"/api/courses/{cid}/decks/{did}/slides/{s['index']}").json()
        exp = one["explanation"]
        assert exp is not None, f"slide {s['index']} has no explanation"
        assert exp["body"].strip(), f"slide {s['index']} has an empty body"


def test_second_process_is_refused_while_running(imported) -> None:
    missing = _missing(_NEEDED_FOR_PIPELINE)
    if missing:
        pytest.skip(f"not written yet by another builder: {', '.join(missing)}")
    client, cid, _ = imported
    first = client.post(f"/api/courses/{cid}/process", json={})
    assert first.status_code == 200
    second = client.post(f"/api/courses/{cid}/process", json={})
    assert second.status_code in (200, 409)
    if second.status_code == 200:
        # The first run can legitimately have finished already on a fast box.
        assert client.get(f"/api/courses/{cid}/progress").json()["state"] in (
            "running", "done",
        )
    # Leave no worker behind for the next test.
    client.post(f"/api/courses/{cid}/pause")


def test_pause_returns_progress_and_keeps_position(imported) -> None:
    missing = _missing(_NEEDED_FOR_PIPELINE)
    if missing:
        pytest.skip(f"not written yet by another builder: {', '.join(missing)}")
    client, cid, _ = imported
    client.post(f"/api/courses/{cid}/process", json={})
    paused = client.post(f"/api/courses/{cid}/pause")
    assert paused.status_code == 200, paused.text
    p = paused.json()
    assert p["state"] in ("paused", "done")
    assert p["running"] is False
    assert p["n_explained"] <= p["n_slides"] == 6

    # Resuming finishes the job without losing what was already explained.
    before = p["n_explained"]
    client.post(f"/api/courses/{cid}/process", json={})
    deadline = time.time() + 120
    while time.time() < deadline:
        p = client.get(f"/api/courses/{cid}/progress").json()
        if p["state"] == "done" and not p["running"]:
            break
        time.sleep(0.2)
    assert p["state"] == "done", p
    assert p["n_explained"] == 6 >= before
