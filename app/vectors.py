"""The per-course vector index: `index.jsonl` plus numpy cosine search.

A course is hundreds of slides, not millions of vectors, so a real vector
database would be complexity without payoff. One JSONL file per course also
makes invariant 1 structural: the index for course X lives *inside*
`Courses/X/`, and `VectorIndex` is always constructed from
`store.index_path(course_id)`. There is no global index to leak across.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Iterable

import numpy as np

from app.contracts import EMBED_DIM, IndexRow

log = logging.getLogger(__name__)


def row_from_dict(raw: object) -> IndexRow | None:
    """Tolerant parse of one JSONL line. `None` when the line is unusable."""
    if not isinstance(raw, dict):
        return None
    chunk_id = raw.get("chunk_id")
    deck_id = raw.get("deck_id")
    slide_index = raw.get("slide_index")
    text = raw.get("text", "")
    vec = raw.get("vec")
    if not isinstance(chunk_id, str) or not chunk_id:
        return None
    if not isinstance(deck_id, str) or not deck_id:
        return None
    if not isinstance(slide_index, int) or isinstance(slide_index, bool):
        return None
    if not isinstance(vec, list) or not all(
        isinstance(x, (int, float)) and not isinstance(x, bool) for x in vec
    ):
        return None
    return IndexRow(
        chunk_id=chunk_id,
        deck_id=deck_id,
        slide_index=slide_index,
        text=text if isinstance(text, str) else "",
        vec=[float(x) for x in vec],
    )


class VectorIndex:
    """Append-only JSONL index for exactly one course.

    `path` is ALWAYS `store.index_path(course_id)`.
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._rows: list[IndexRow] | None = None
        self._matrix: np.ndarray | None = None

    # -- loading ----------------------------------------------------------

    def _load(self) -> list[IndexRow]:
        rows: list[IndexRow] = []
        if not self.path.is_file():
            return rows  # a missing index is an empty index, not an error
        seen: set[str] = set()
        try:
            text = self.path.read_text("utf-8", errors="replace")
        except OSError as exc:
            log.warning("could not read index %s: %s", self.path, exc)
            return rows
        for lineno, line in enumerate(text.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                raw = json.loads(line)
            except ValueError:
                log.warning("skipping malformed index line %s:%d", self.path, lineno)
                continue
            row = row_from_dict(raw)
            if row is None:
                log.warning("skipping unusable index row %s:%d", self.path, lineno)
                continue
            if len(row.vec) != EMBED_DIM:
                # A changed embedder must not corrupt search: drop, don't crash.
                log.warning(
                    "skipping index row %s with %d dims (expected %d) in %s",
                    row.chunk_id,
                    len(row.vec),
                    EMBED_DIM,
                    self.path,
                )
                continue
            if row.chunk_id in seen:
                # Last write wins: replace the earlier copy in place.
                rows = [r for r in rows if r.chunk_id != row.chunk_id]
            seen.add(row.chunk_id)
            rows.append(row)
        return rows

    def all(self) -> list[IndexRow]:
        """Every usable row. Cached; `add`/`rebuild_from` invalidate."""
        if self._rows is None:
            self._rows = self._load()
        return self._rows

    def _mat(self) -> np.ndarray:
        if self._matrix is None:
            rows = self.all()
            if not rows:
                self._matrix = np.zeros((0, EMBED_DIM), dtype=np.float64)
            else:
                self._matrix = np.asarray(
                    [r.vec for r in rows], dtype=np.float64
                )
        return self._matrix

    def _invalidate(self) -> None:
        self._rows = None
        self._matrix = None

    # -- writing ----------------------------------------------------------

    def add(self, rows: list[IndexRow]) -> None:
        """Append rows, skipping chunk_ids already present.

        Appends are flushed and fsynced before returning, so a checkpoint that
        says a slide is done is backed by an index row that is actually on
        disk (invariant 5).
        """
        if not rows:
            return
        existing = {r.chunk_id for r in self.all()}
        fresh: list[IndexRow] = []
        for row in rows:
            if row.chunk_id in existing:
                continue
            if len(row.vec) != EMBED_DIM:
                log.warning(
                    "refusing to index %s: %d dims, expected %d",
                    row.chunk_id,
                    len(row.vec),
                    EMBED_DIM,
                )
                continue
            existing.add(row.chunk_id)
            fresh.append(row)
        if not fresh:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = "".join(
            json.dumps(r.to_dict(), ensure_ascii=False) + "\n" for r in fresh
        )
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        self._invalidate()

    def rebuild_from(self, rows: list[IndexRow]) -> None:
        """Replace the whole index atomically.

        Used after a resume when the index has fallen behind the stored
        explanations, and after an embedder change.
        """
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = "".join(
            json.dumps(r.to_dict(), ensure_ascii=False) + "\n"
            for r in rows
            if len(r.vec) == EMBED_DIM
        )
        tmp = self.path.with_name(self.path.name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self.path)
        self._invalidate()

    # -- reading ----------------------------------------------------------

    def has(self, chunk_id: str) -> bool:
        return any(r.chunk_id == chunk_id for r in self.all())

    def count(self) -> int:
        return len(self.all())

    def get(self, chunk_id: str) -> IndexRow | None:
        for row in self.all():
            if row.chunk_id == chunk_id:
                return row
        return None

    def search(
        self,
        qvec: list[float],
        k: int,
        *,
        exclude: Iterable[str] = (),
    ) -> list[tuple[IndexRow, float]]:
        """Top-k by cosine similarity, descending."""
        rows = self.all()
        if not rows or k <= 0:
            return []
        q = np.asarray(qvec, dtype=np.float64)
        if q.shape != (EMBED_DIM,):
            log.warning(
                "query vector has %s dims, expected %d; returning no results",
                q.shape,
                EMBED_DIM,
            )
            return []
        qn = float(np.linalg.norm(q))
        if qn == 0.0:
            return []
        mat = self._mat()
        norms = np.linalg.norm(mat, axis=1)
        norms[norms == 0.0] = 1.0
        sims = (mat @ q) / (norms * qn)

        blocked = set(exclude)
        scored = [
            (row, float(sim))
            for row, sim in zip(rows, sims)
            if row.chunk_id not in blocked
        ]
        # Stable tie-break on chunk_id so a rerun retrieves the same context.
        scored.sort(key=lambda pair: (-pair[1], pair[0].chunk_id))
        return scored[:k]


def chunk_id_for(deck_id: str, slide_index: int) -> str:
    """The one place the chunk_id shape is decided. Matches contracts.py."""
    return f"{deck_id}:{slide_index}"


def split_chunk_id(chunk_id: str) -> tuple[str, int]:
    """`"deck:3"` -> `("deck", 3)`. Raises ValueError on anything else."""
    deck_id, sep, idx = chunk_id.rpartition(":")
    if not sep or not deck_id:
        raise ValueError(f"malformed chunk_id: {chunk_id!r}")
    return deck_id, int(idx)


__all__ = ["VectorIndex", "row_from_dict", "chunk_id_for", "split_chunk_id"]
