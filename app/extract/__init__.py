"""Source-file extraction: render pages, pull text, decide what a file is."""

from __future__ import annotations

from pathlib import Path

from app.contracts import ExtractionError
from app.extract.classify import Classification, classify_file
from app.extract.pdf import extract_pdf, page_count, page_stem, normalise_text
from app.extract.pptx import extract_pptx, rendering_available, soffice_path
from app.extract.structured import extract_structured, objects_from_pages

__all__ = [
    "Classification", "classify_file",
    "extract_pdf", "page_count", "page_stem", "normalise_text",
    "extract_pptx", "rendering_available", "soffice_path",
    "extract_any", "supported_suffix", "extract_structured", "objects_from_pages",
]

_PDF = {".pdf"}
_PPTX = {".pptx", ".ppt", ".potx"}
_STRUCTURED = {".docx", ".xlsx", ".csv", ".ipynb"}


def supported_suffix(filename: str) -> bool:
    return Path(filename).suffix.lower() in (_PDF | _PPTX | _STRUCTURED)


def extract_any(path: str | Path, out_dir: Path, **kw) -> list[tuple[int, Path, str]]:
    """Dispatch on extension. Raises ExtractionError for anything else."""
    suffix = Path(path).suffix.lower()
    if suffix in _PDF:
        return extract_pdf(path, out_dir, **kw)
    if suffix in _PPTX:
        return extract_pptx(path, out_dir, **kw)
    raise ExtractionError(f"unsupported file type: {suffix or '(none)'}")
