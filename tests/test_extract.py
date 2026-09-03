"""Gate G3: slide extraction.

A fixture PDF of known page count yields that many page images and non-empty
extracted text.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
from PIL import Image

from app.contracts import SLIDE_MAX_PX, ExtractionError
from app.extract import extract_pdf, extract_pptx, page_count, rendering_available

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES = REPO_ROOT / "tests" / "fixtures"
sys.path.insert(0, str(REPO_ROOT / "scripts"))


@pytest.fixture(scope="session", autouse=True)
def fixtures_present() -> Path:
    """The fixtures are committed; regenerate them if any is missing."""
    wanted = ["lecture_w1.pdf", "syllabus.pdf", "lecture_w2.pptx"]
    if not all((FIXTURES / n).is_file() for n in wanted):
        import make_fixtures
        make_fixtures.make_fixtures(FIXTURES)
    for n in wanted:
        assert (FIXTURES / n).is_file(), f"missing fixture {n}"
    return FIXTURES


def _pngs(pages):
    return [p for _, p, _ in pages]


def test_lecture_pdf_yields_six_pages(tmp_path: Path):
    src = FIXTURES / "lecture_w1.pdf"
    assert page_count(src) == 6

    pages = extract_pdf(src, tmp_path / "deck")
    assert len(pages) == 6, f"expected 6 pages, got {len(pages)}"

    for i, (idx, png, text) in enumerate(pages):
        assert idx == i
        assert png.is_file(), f"missing {png}"
        assert png.stat().st_size > 0, f"empty PNG {png}"
        with Image.open(png) as im:
            im.verify()
        with Image.open(png) as im:
            assert im.format == "PNG"
            assert im.width > 0 and im.height > 0
            assert max(im.width, im.height) <= SLIDE_MAX_PX, (
                f"page {i + 1} is {im.size}, over SLIDE_MAX_PX={SLIDE_MAX_PX}"
            )
        assert text.strip(), f"page {i + 1} extracted no text"
        assert (png.with_suffix(".txt")).read_text("utf-8") == text


def test_pdf_text_is_grounded_in_the_slide_content(tmp_path: Path):
    pages = extract_pdf(FIXTURES / "lecture_w1.pdf", tmp_path / "deck")
    joined = "\n".join(t for _, _, t in pages).lower()
    for phrase in ("relational model", "primary key", "select", "join", "normal form"):
        assert phrase in joined, f"expected {phrase!r} in the extracted text"


def test_pdf_extraction_is_idempotent(tmp_path: Path):
    out = tmp_path / "deck"
    first = extract_pdf(FIXTURES / "lecture_w1.pdf", out)
    files_first = sorted(p.name for p in out.iterdir())
    second = extract_pdf(FIXTURES / "lecture_w1.pdf", out)
    files_second = sorted(p.name for p in out.iterdir())

    assert files_first == files_second
    assert len(files_first) == 12  # 6 png + 6 txt
    assert [(i, t) for i, _, t in first] == [(i, t) for i, _, t in second]


def test_pptx_yields_four_slides_with_notes(tmp_path: Path):
    pages = extract_pptx(FIXTURES / "lecture_w2.pptx", tmp_path / "w2")
    assert len(pages) == 4, f"expected 4 slides, got {len(pages)}"

    for i, (idx, png, text) in enumerate(pages):
        assert idx == i
        assert png.is_file() and png.stat().st_size > 0
        with Image.open(png) as im:
            assert im.width > 0
            assert max(im.width, im.height) <= SLIDE_MAX_PX
        assert text.strip(), f"slide {i + 1} extracted no text"

    joined = "\n".join(t for _, _, t in pages).lower()
    assert "acid" in joined and "b-tree" in joined

    # slide 2 carries the speaker notes; they must survive extraction
    notes_slide_text = pages[1][2].lower()
    assert "dangling foreign key" in notes_slide_text, (
        "speaker notes missing from the extracted text of slide 2"
    )


def test_pptx_extraction_is_idempotent(tmp_path: Path):
    out = tmp_path / "w2"
    first = extract_pptx(FIXTURES / "lecture_w2.pptx", out)
    names_first = sorted(p.name for p in out.iterdir())
    second = extract_pptx(FIXTURES / "lecture_w2.pptx", out)
    names_second = sorted(p.name for p in out.iterdir())
    assert names_first == names_second
    assert [(i, t) for i, _, t in first] == [(i, t) for i, _, t in second]


def test_rendering_availability_is_reported():
    # Not an assertion about the machine: just that the probe answers.
    assert isinstance(rendering_available(), bool)


def test_corrupt_pdf_raises_extraction_error(tmp_path: Path):
    bad = tmp_path / "truncated.pdf"
    good = (FIXTURES / "lecture_w1.pdf").read_bytes()
    bad.write_bytes(good[: len(good) // 3])          # truncated mid-object
    with pytest.raises(ExtractionError):
        extract_pdf(bad, tmp_path / "out")

    garbage = tmp_path / "garbage.pdf"
    garbage.write_bytes(b"this is definitely not a pdf")
    with pytest.raises(ExtractionError):
        extract_pdf(garbage, tmp_path / "out2")


def test_missing_file_raises_extraction_error(tmp_path: Path):
    with pytest.raises(ExtractionError):
        extract_pdf(tmp_path / "nope.pdf", tmp_path / "out")
