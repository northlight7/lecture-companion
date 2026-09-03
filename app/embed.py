"""Local retrieval embeddings. Offline, free, deterministic by default.

Two implementations of the `Embedder` protocol:

* `HashingEmbedder` — a real bag-of-features embedder (unigrams + bigrams,
  signed feature hashing, sublinear tf, L2 norm). No dependencies beyond the
  stdlib and numpy. This is what the tests and CI run on, so nothing has to
  download torch to prove the pipeline works.
* `SentenceTransformerEmbedder` — `intfloat/multilingual-e5-small`, used when
  the library is installed. That model REQUIRES `query: ` / `passage: `
  prefixes (see CLAUDE.md); omitting them measurably degrades retrieval.

Both are EMBED_DIM (384) dims, so an index built by one is *shaped* like an
index built by the other. They are not interchangeable numerically — switching
embedders means rebuilding the index, which `VectorIndex.rebuild_from` exists
to do.
"""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import threading
from collections import Counter
from typing import Sequence

import numpy as np

from app.contracts import EMBED_DIM, EMBED_MODEL, Embedder

log = logging.getLogger(__name__)

_TOKEN_RE = re.compile(r"\w+", re.UNICODE)

#: Longest text we bother embedding. Slide text is short; a runaway reference
#: doc would otherwise dominate hashing time for no retrieval benefit.
MAX_EMBED_CHARS = 8000


def tokenize(text: str) -> list[str]:
    """Lowercase, split on word characters. Deliberately simple and stable."""
    return _TOKEN_RE.findall((text or "").lower())


def _features(text: str) -> Counter[str]:
    """Unigrams plus adjacent bigrams, counted."""
    toks = tokenize(text[:MAX_EMBED_CHARS])
    feats: Counter[str] = Counter(toks)
    for a, b in zip(toks, toks[1:]):
        feats[f"{a}_{b}"] += 1
    return feats


def _bucket_and_sign(feature: str) -> tuple[int, float]:
    """Stable hash -> (bucket in [0, EMBED_DIM), sign in {-1, +1}).

    md5 rather than `hash()` because Python string hashing is salted per
    process, and an index written today must be searchable tomorrow.
    """
    digest = hashlib.md5(feature.encode("utf-8")).digest()
    bucket = int.from_bytes(digest[:4], "big") % EMBED_DIM
    sign = 1.0 if digest[4] & 1 else -1.0
    return bucket, sign


class HashingEmbedder:
    """Deterministic, dependency-free bag-of-features embedder.

    Not a semantic model: it matches on shared vocabulary. That is enough for
    what retrieval is asked to do here — surface earlier slides of the same
    course that talk about the same terms — and it makes the isolation and
    retrieval tests meaningful rather than testing noise.
    """

    dim: int = EMBED_DIM
    name: str = "hashing-v1"

    def _vec(self, text: str) -> list[float]:
        vec = np.zeros(EMBED_DIM, dtype=np.float64)
        for feature, count in _features(text).items():
            bucket, sign = _bucket_and_sign(feature)
            # Sublinear tf: a term repeated ten times is not ten times as
            # informative as one seen once.
            vec[bucket] += sign * (1.0 + math.log(count))
        norm = float(np.linalg.norm(vec))
        if norm > 0.0:
            vec /= norm
        return [float(x) for x in vec]

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


class SentenceTransformerEmbedder:
    """`intfloat/multilingual-e5-small`, loaded lazily on first use.

    The e5 family is trained with asymmetric prefixes. `query: ` goes on the
    thing you are searching *with*; `passage: ` on the things you are searching
    *over*. Dropping them is a silent quality regression, so they are applied
    here and nowhere else in the codebase.
    """

    dim: int = EMBED_DIM
    name: str = EMBED_MODEL

    def __init__(self, model_name: str = EMBED_MODEL) -> None:
        self.model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    from sentence_transformers import SentenceTransformer

                    self._model = SentenceTransformer(self.model_name)
        return self._model

    def _encode(self, texts: Sequence[str]) -> list[list[float]]:
        model = self._load()
        arr = model.encode(
            list(texts), normalize_embeddings=True, show_progress_bar=False
        )
        return [[float(x) for x in row] for row in np.asarray(arr, dtype=np.float64)]

    def embed_passages(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        return self._encode([f"passage: {t}" for t in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._encode([f"query: {text}"])[0]


_cached: Embedder | None = None
_cache_lock = threading.Lock()


def _want_hashing() -> bool:
    return os.environ.get("LC_EMBEDDER", "").strip().lower() == "hash"


def get_embedder() -> Embedder:
    """The process-wide embedder.

    `SentenceTransformerEmbedder` when the library imports and `LC_EMBEDDER`
    is not `hash`; otherwise `HashingEmbedder`. A model that fails to download
    or load must never take the app down — it falls back with a warning.
    """
    global _cached
    if _cached is not None:
        return _cached
    with _cache_lock:
        if _cached is not None:
            return _cached
        _cached = _build_embedder()
        return _cached


def _build_embedder() -> Embedder:
    if _want_hashing():
        log.info("LC_EMBEDDER=hash: using the hashing embedder")
        return HashingEmbedder()
    try:
        import sentence_transformers  # noqa: F401
    except Exception as exc:  # pragma: no cover - depends on the environment
        log.info("sentence-transformers unavailable (%s); using hashing embedder", exc)
        return HashingEmbedder()
    emb = SentenceTransformerEmbedder()
    try:  # pragma: no cover - only exercised when the model is installed
        emb.embed_query("warm up")
    except Exception as exc:  # pragma: no cover
        log.warning(
            "could not load %s (%s); falling back to the hashing embedder",
            EMBED_MODEL,
            exc,
        )
        return HashingEmbedder()
    return emb


def reset_embedder_cache() -> None:
    """Test hook: drop the cached instance so env changes take effect."""
    global _cached
    with _cache_lock:
        _cached = None


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """Cosine similarity, 0.0 when either side is a zero vector."""
    va = np.asarray(a, dtype=np.float64)
    vb = np.asarray(b, dtype=np.float64)
    if va.shape != vb.shape or va.size == 0:
        return 0.0
    na = float(np.linalg.norm(va))
    nb = float(np.linalg.norm(vb))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


__all__ = [
    "HashingEmbedder",
    "SentenceTransformerEmbedder",
    "get_embedder",
    "reset_embedder_cache",
    "tokenize",
    "cosine",
    "MAX_EMBED_CHARS",
]
