"""PDF rendering and text extraction.

Rendering is `pypdfium2` (permissive licence, macOS arm64 wheels, no system
deps); the text layer is `pypdf`. This split is a deliberate licence choice
recorded in CLAUDE.md - do NOT swap in PyMuPDF, which is AGPL.

An image-only page is normal, not an error: it yields "" and the vision model
reads the rendered PNG instead.
"""

from __future__ import annotations

import re
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image
from pypdf import PdfReader

from app.contracts import SLIDE_MAX_PX, SLIDE_RENDER_SCALE, ExtractionError

__all__ = ["page_count", "extract_pdf", "normalise_text", "page_stem"]

_TRAILING_WS = re.compile(r"[ \t]+$", re.MULTILINE)
_MANY_BLANKS = re.compile(r"\n{3,}")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def normalise_text(text: str) -> str:
    """Collapse noise but keep line structure - the model uses layout cues."""
    if not text:
        return ""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\xa0", " ").replace("​", "")
    text = _CONTROL.sub("", text)
    text = _TRAILING_WS.sub("", text)
    text = _MANY_BLANKS.sub("\n\n", text)
    return text.strip()


def page_stem(index: int) -> str:
    """0-based index -> `page-0001` (filenames are 1-based)."""
    return f"page-{index + 1:04d}"


def page_count(path: str | Path) -> int:
    path = Path(path)
    doc = None
    try:
        doc = pdfium.PdfDocument(str(path))
        return len(doc)
    except Exception as exc:  # noqa: BLE001 - any pdfium failure is unreadable input
        raise ExtractionError(f"cannot read PDF {path.name}: {exc}") from exc
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:  # noqa: BLE001
                pass


def _text_layer(path: Path, n_pages: int) -> list[str]:
    """Best-effort per-page text. Never raises; missing text is "" by design."""
    texts = [""] * n_pages
    try:
        reader = PdfReader(str(path))
        if getattr(reader, "is_encrypted", False):
            try:
                reader.decrypt("")
            except Exception:  # noqa: BLE001
                return texts
        for i, page in enumerate(reader.pages):
            if i >= n_pages:
                break
            try:
                texts[i] = normalise_text(page.extract_text() or "")
            except Exception:  # noqa: BLE001 - one bad page must not kill the deck
                texts[i] = ""
    except Exception:  # noqa: BLE001 - no text layer at all is acceptable
        return texts
    return texts


def _downscale(img: Image.Image, max_px: int) -> Image.Image:
    longest = max(img.width, img.height)
    if longest <= max_px:
        return img
    ratio = max_px / float(longest)
    size = (max(1, int(img.width * ratio)), max(1, int(img.height * ratio)))
    return img.resize(size, Image.LANCZOS)


def extract_pdf(
    path: str | Path,
    out_dir: Path,
    *,
    scale: float = SLIDE_RENDER_SCALE,
    max_px: int = SLIDE_MAX_PX,
) -> list[tuple[int, Path, str]]:
    """Render every page to `page-NNNN.png` + `page-NNNN.txt` in `out_dir`.

    Returns [(0-based index, png path, text), ...]. Idempotent: re-running over
    the same out_dir overwrites and returns the same result.
    """
    path = Path(path)
    out_dir = Path(out_dir)
    if not path.exists():
        raise ExtractionError(f"no such file: {path}")
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        doc = pdfium.PdfDocument(str(path))
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError(f"cannot open PDF {path.name}: {exc}") from exc

    results: list[tuple[int, Path, str]] = []
    try:
        n = len(doc)
        if n == 0:
            raise ExtractionError(f"PDF {path.name} has no pages")
        texts = _text_layer(path, n)
        for i in range(n):
            stem = page_stem(i)
            png_path = out_dir / f"{stem}.png"
            txt_path = out_dir / f"{stem}.txt"
            try:
                page = doc[i]
                bitmap = page.render(scale=scale)
                img = bitmap.to_pil().convert("RGB")
            except Exception as exc:  # noqa: BLE001
                raise ExtractionError(
                    f"cannot render page {i + 1} of {path.name}: {exc}"
                ) from exc
            img = _downscale(img, max_px)
            img.save(png_path, format="PNG")
            text = texts[i]
            txt_path.write_text(text, encoding="utf-8")
            results.append((i, png_path, text))
    finally:
        try:
            doc.close()
        except Exception:  # noqa: BLE001
            pass
    return results
