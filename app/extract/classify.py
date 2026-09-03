"""Slides vs reference doc. Local heuristic, no model call, never crashes.

There is no review step in the UI, so this has to be right most of the time
and it has to be explainable: every decision carries a one-sentence reason
naming the signal that decided it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.contracts import FileRole

__all__ = ["Classification", "classify_file", "words_per_page"]

# Words per page. A lecture slide is a handful of short bullets: real decks
# land around 20-80 words a page. A syllabus is continuous prose in a normal
# body size: 300+ words a page. 200 sits in the empty middle of that gap, so
# small misjudgements on either side do not flip the decision.
_DENSE_WPP = 200.0
_SPARSE_WPP = 110.0

_REF_NAME_CUES = (
    "syllabus", "outline", "handbook", "requirements", "program", "programme",
    "curriculum", "course info", "course-info", "course_info", "assessment",
    "regulations", "guidelines",
)
_SLIDE_NAME_CUES = (
    "week", "lecture", "lec", "topic", "chapter", "slides", "slide", "deck",
    "session", "class", "ch", "wk",
)
_SLIDE_NAME_PATTERNS = (
    re.compile(r"\bl\d{1,2}\b", re.I),        # L01
    re.compile(r"\bw\d{1,2}\b", re.I),        # w1
    re.compile(r"\block\d", re.I),
)
_REF_TEXT_CUES = (
    "learning outcomes", "learning outcome", "grading", "assessment",
    "office hours", "prerequisite", "credit", "textbook", "academic honesty",
    "academic integrity", "course description", "grade breakdown",
    "attendance policy", "plagiarism", "instructor",
)


def _norm_name(path: Path) -> str:
    return re.sub(r"[_\-]+", " ", path.stem).lower()


def words_per_page(sample_text: str, page_count: int | None) -> float | None:
    if not sample_text.strip():
        return None
    pages = page_count if (page_count and page_count > 0) else 1
    return len(sample_text.split()) / float(pages)


@dataclass
class Classification:
    role: FileRole
    confidence: float
    reason: str


def _sentence(parts: list[str]) -> str:
    if not parts:
        return "no strong signal either way"
    if len(parts) == 1:
        return parts[0]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def classify_file(
    path: Path,
    *,
    page_count: int | None = None,
    sample_text: str = "",
) -> Classification:
    """Never raises. Returns a role, a 0..1 confidence, and a human reason."""
    try:
        path = Path(path)
        name = _norm_name(path)
        suffix = path.suffix.lower()
        text = (sample_text or "").lower()

        slide_score = 0.0
        ref_score = 0.0
        slide_why: list[str] = []
        ref_why: list[str] = []

        # 1. Extension. A .pptx is a deck essentially always.
        if suffix in (".pptx", ".ppt", ".potx", ".key"):
            slide_score += 2.5
            slide_why.append("it is a PowerPoint file")

        # 2. Filename cues.
        hit_ref = [c for c in _REF_NAME_CUES if c in name]
        if hit_ref:
            ref_score += 2.0
            ref_why.append(f"the filename says \"{hit_ref[0]}\"")
        hit_slide = [c for c in _SLIDE_NAME_CUES if re.search(rf"\b{re.escape(c)}\b", name)]
        if not hit_slide:
            for pat in _SLIDE_NAME_PATTERNS:
                m = pat.search(name)
                if m:
                    hit_slide = [m.group(0)]
                    break
        if hit_slide:
            slide_score += 1.5
            slide_why.append(f"the filename says \"{hit_slide[0]}\"")

        # 3. Density of the text layer.
        wpp = words_per_page(text, page_count)
        if wpp is not None:
            if wpp >= _DENSE_WPP:
                ref_score += 2.0
                ref_why.append(f"dense prose ({wpp:.0f} words/page)")
            elif wpp <= _SPARSE_WPP:
                slide_score += 1.5
                slide_why.append(f"sparse slide-shaped text ({wpp:.0f} words/page)")

        # 4. Structural vocabulary of a syllabus.
        raw_hits = [c for c in _REF_TEXT_CUES if c in text]
        # Drop a cue that is only a fragment of another cue we also matched,
        # so the reason does not read "learning outcomes and learning outcome".
        hits = [c for c in raw_hits if not any(c != o and c in o for o in raw_hits)]
        if len(hits) >= 2:
            ref_score += 2.0
            ref_why.append("mentions " + " and ".join(hits[:3]))
        elif len(hits) == 1:
            ref_score += 0.75
            ref_why.append(f"mentions {hits[0]}")

        # 5. Many short lines is the shape of a bullet deck.
        lines = [ln.strip() for ln in (sample_text or "").splitlines() if ln.strip()]
        if len(lines) >= 6:
            short = sum(1 for ln in lines if len(ln.split()) <= 8)
            if short / len(lines) >= 0.7:
                slide_score += 1.0
                slide_why.append("most lines are short bullets")

        if ref_score > slide_score:
            role: FileRole = "reference"
            why, total, other = ref_why, ref_score, slide_score
        else:
            role = "slides"
            why, total, other = slide_why, slide_score, ref_score
            if not why:
                why = ["nothing marks it as a reference doc, so it is treated as slides"]

        margin = total - other
        confidence = max(0.3, min(0.97, 0.5 + 0.12 * margin + 0.05 * (len(why) - 1)))
        return Classification(role=role, confidence=round(confidence, 2), reason=_sentence(why))
    except Exception as exc:  # noqa: BLE001 - classification must never crash an import
        return Classification(
            role="slides",
            confidence=0.3,
            reason=f"defaulted to slides after a classification error ({exc})",
        )
