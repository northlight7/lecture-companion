"""Grounded questions over explicit, course-scoped learning objects."""

from __future__ import annotations

import json
import re
from typing import Any

from app.contracts import BadModelOutput, LearningObject

MAX_SELECTIONS = 12
MAX_EVIDENCE_CHARS = 12000
MAX_OBJECT_CHARS = 3000


def locator_label(obj: LearningObject) -> str:
    loc = obj.locator
    parts: list[str] = []
    if loc.page is not None:
        parts.append(f"page {loc.page}")
    if loc.slide is not None:
        parts.append(f"slide {loc.slide}")
    if loc.note is not None:
        parts.append(f"note {loc.note}")
    if loc.block is not None:
        parts.append(f"block {loc.block + 1}")
    if loc.sheet:
        parts.append(f"sheet {loc.sheet}")
    if loc.cell_range:
        parts.append(loc.cell_range)
    if loc.chart:
        parts.append(f"chart {loc.chart}")
    if loc.notebook_cell is not None:
        parts.append(f"notebook cell {loc.notebook_cell + 1}")
    if loc.output is not None:
        parts.append(f"output {loc.output + 1}")
    if loc.dataset_field:
        parts.append(f"field {loc.dataset_field}")
    if loc.fragment and not parts:
        parts.append(loc.fragment)
    return ", ".join(parts) or obj.object_type.replace("_", " ")


def evidence_text(obj: LearningObject) -> str:
    parts = [f"Object type: {obj.object_type}", f"Source location: {locator_label(obj)}"]
    if obj.data:
        parts.append(
            "Structured data:\n" + json.dumps(obj.data, ensure_ascii=False, sort_keys=True)
        )
    text = (obj.text or "").strip()
    if text:
        parts.append("Extracted text:\n" + text)
    return "\n".join(parts)[:MAX_OBJECT_CHARS]


def _bounded_evidence(objects: list[LearningObject]) -> list[tuple[LearningObject, str]]:
    out: list[tuple[LearningObject, str]] = []
    used = 0
    for obj in objects[:MAX_SELECTIONS]:
        text = evidence_text(obj)
        remaining = MAX_EVIDENCE_CHARS - used
        if remaining <= 0:
            break
        text = text[:remaining]
        out.append((obj, text))
        used += len(text)
    return out


def answer_selected(question: str, objects: list[LearningObject], client) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        raise ValueError("A question is required.")
    if not objects:
        raise ValueError("Select at least one source object.")
    bounded = _bounded_evidence(objects)
    citations = [
        {
            "number": index,
            "artifact_id": obj.artifact_id,
            "object_id": obj.id,
            "label": locator_label(obj),
            "locator": obj.locator.to_dict(),
            "quote": text[:240],
        }
        for index, (obj, text) in enumerate(bounded, 1)
    ]
    if getattr(client, "name", "") == "fake":
        first = bounded[0][1] or "The selected object has structure but no extracted prose."
        answer = (
            f"The selected source says: {first[:500]} [S1]\n\n"
            f"For the question \"{question[:240]}\", this is the available evidence. "
            "The offline model does not add facts beyond it."
        )
        uncertainty = "Offline demonstration answer. It uses selected local evidence only."
    else:
        evidence = "\n\n".join(
            f"[S{index}] {locator_label(obj)}\n{text}"
            for index, (obj, text) in enumerate(bounded, 1)
        )
        prompt = (
            "Answer the student's question using only the selected course evidence below. "
            "Cite every factual paragraph with one or more source labels such as [S1]. "
            "If the evidence is insufficient or ambiguous, say so. Do not use outside facts.\n\n"
            f"Question:\n{question[:2000]}\n\nSelected evidence:\n{evidence}"
        )
        answer = client.summarise(prompt).strip()
        refs = {int(value) for value in re.findall(r"\[S(\d+)\]", answer)}
        if not answer or not refs or any(ref < 1 or ref > len(citations) for ref in refs):
            raise BadModelOutput("the grounded answer did not contain valid source citations")
        uncertainty = "The answer is limited to the selected evidence."
    return {
        "answer": answer,
        "citations": citations,
        "uncertainty": uncertainty,
        "remote_disclosure": {
            "sent_remote": getattr(client, "name", "") != "fake",
            "sent": ["question", f"{len(bounded)} bounded selected evidence excerpts"],
            "not_sent": ["original files", "unselected learning objects", "other courses"],
        },
    }
