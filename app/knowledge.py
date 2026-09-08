"""Course-local typed search, source-version tracking, and concept relationships."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from app.embed import tokenize
from app.questions import locator_label

SCHEMA_VERSION = 2
MAX_SEARCH_TEXT = 8000
MAX_CONCEPT_EVIDENCE = 6

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()

_STOPWORDS = {
    "about", "after", "again", "also", "among", "because", "before", "being",
    "between", "both", "could", "course", "data", "does", "each", "from", "have",
    "into", "more", "most", "object", "only", "other", "should", "source", "such",
    "than", "that", "their", "there", "these", "they", "this", "through", "using",
    "value", "values", "were", "what", "when", "where", "which", "while", "with",
    "would", "your", "true", "false", "none", "null", "text", "type", "page", "slide",
}

# These aliases improve local search without pretending a lexical index is a model.
# Graph edges use only concepts actually evidenced in the current course.
_CONCEPTS: dict[str, tuple[str, ...]] = {
    "regression": ("linear regression", "least squares", "ols", "regression model"),
    "regularization": ("ridge", "lasso", "penalty", "shrinkage"),
    "model evaluation": ("rmse", "mae", "r squared", "residual", "test score"),
    "data leakage": ("look ahead", "look-ahead", "future information", "target leakage"),
    "train test split": ("training set", "test set", "validation set", "out of sample"),
    "entity relationship": ("er diagram", "erd", "entity relationship diagram"),
    "cardinality": ("one to many", "many to many", "optionality", "crow foot"),
    "database key": ("primary key", "foreign key", "identifier", "candidate key"),
    "ethical framework": ("utilitarian", "kantian", "rights", "virtue ethics", "rawls"),
    "stakeholder analysis": ("stakeholder", "affected parties", "consequences"),
    "financial return": ("returns", "simple return", "log return", "rate of return"),
    "risk and volatility": ("volatility", "standard deviation", "variance", "risk measure"),
    "annualization": ("annualised", "annualized", "trading days", "frequency conversion"),
    "spreadsheet formula": ("formula", "countif", "vlookup", "cell reference"),
    "data visualization": ("histogram", "boxplot", "scatter plot", "chart"),
}

_PREREQUISITES = (
    ("train test split", "data leakage"),
    ("regression", "regularization"),
    ("regression", "model evaluation"),
    ("entity relationship", "cardinality"),
    ("entity relationship", "database key"),
    ("ethical framework", "stakeholder analysis"),
    ("financial return", "risk and volatility"),
    ("financial return", "annualization"),
)


def _lock(course_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(course_id, threading.Lock())


def _fingerprint(artifacts: list[Any]) -> str:
    rows = [
        [a.id, a.content_hash, a.version, a.object_count, a.extraction_status]
        for a in artifacts
    ]
    raw = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _meta(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}
    try:
        with sqlite3.connect(path) as db:
            return dict(db.execute("SELECT key, value FROM meta"))
    except (OSError, sqlite3.DatabaseError):
        return {}


def index_status(store, course_id: str) -> dict[str, Any]:
    artifacts = store.load_artifacts(course_id)
    expected = _fingerprint(artifacts)
    path = store.knowledge_index_path(course_id)
    meta = _meta(path)
    reasons: list[str] = []
    if not path.is_file():
        reasons.append("index has not been built")
    elif meta.get("schema_version") != str(SCHEMA_VERSION):
        reasons.append("index schema changed")
    if meta and meta.get("source_fingerprint") != expected:
        reasons.append("source versions changed")
    return {
        "ready": not reasons,
        "stale": bool(reasons),
        "reasons": reasons,
        "source_fingerprint": expected,
        "indexed_fingerprint": meta.get("source_fingerprint", ""),
        "artifact_count": len(artifacts),
        "object_count": int(meta.get("object_count", "0") or 0),
    }


def _object_text(obj: Any, artifact: Any) -> str:
    structured = json.dumps(obj.data, ensure_ascii=False, sort_keys=True)
    parts = [
        artifact.filename, artifact.source_path, artifact.kind, artifact.purpose,
        obj.object_type, locator_label(obj), structured, obj.text,
    ]
    return "\n".join(part for part in parts if part)[:MAX_SEARCH_TEXT]


def _normal(text: str) -> str:
    return " ".join(tokenize(text))


def _snippet_text(obj: Any) -> str:
    if obj.object_type in {"dataset", "dataset_field", "sheet", "cell", "range", "chart"} and obj.data:
        return json.dumps(obj.data, ensure_ascii=False, sort_keys=True)
    return obj.text.strip() or json.dumps(obj.data, ensure_ascii=False, sort_keys=True)


def _concept_matches(text: str) -> list[str]:
    normal = f" {_normal(text)} "
    found: list[str] = []
    for label, aliases in _CONCEPTS.items():
        phrases = (label, *aliases)
        if any(f" {_normal(phrase)} " in normal for phrase in phrases):
            found.append(label)
    return found


def _concept_id(label: str) -> str:
    return "concept-" + hashlib.sha256(label.encode("utf-8")).hexdigest()[:16]


def build_index(store, course_id: str) -> dict[str, Any]:
    """Atomically rebuild a course's local index from current typed objects."""
    artifacts = store.load_artifacts(course_id)
    artifact_by_id = {artifact.id: artifact for artifact in artifacts}
    objects = [
        obj for obj in store.load_learning_objects(course_id)
        if obj.artifact_id in artifact_by_id
    ]
    objects_by_artifact: dict[str, list[Any]] = defaultdict(list)
    for obj in objects:
        objects_by_artifact[obj.artifact_id].append(obj)
    path = store.knowledge_index_path(course_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    if temporary.exists():
        temporary.unlink()

    catalog_evidence: dict[str, list[tuple[str, str]]] = defaultdict(list)
    token_artifacts: dict[str, set[str]] = defaultdict(set)
    token_evidence: dict[str, list[tuple[str, str]]] = defaultdict(list)
    token_counts: Counter[str] = Counter()

    with sqlite3.connect(temporary) as db:
        db.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute(
            "CREATE VIRTUAL TABLE docs USING fts5("
            "object_id UNINDEXED, artifact_id UNINDEXED, content, tokenize='porter unicode61')"
        )
        db.execute(
            "CREATE TABLE concepts ("
            "concept_id TEXT PRIMARY KEY, label TEXT NOT NULL, aliases TEXT NOT NULL, "
            "kind TEXT NOT NULL, artifact_count INTEGER NOT NULL, evidence_count INTEGER NOT NULL)"
        )
        db.execute(
            "CREATE TABLE concept_evidence ("
            "concept_id TEXT NOT NULL, artifact_id TEXT NOT NULL, object_id TEXT NOT NULL)"
        )
        db.execute(
            "CREATE TABLE artifact_links ("
            "from_artifact TEXT NOT NULL, to_artifact TEXT NOT NULL, "
            "source_object TEXT NOT NULL, target_object TEXT NOT NULL, reason TEXT NOT NULL)"
        )
        for obj in objects:
            artifact = artifact_by_id[obj.artifact_id]
            text = _object_text(obj, artifact)
            db.execute(
                "INSERT INTO docs(object_id, artifact_id, content) VALUES (?, ?, ?)",
                (obj.id, obj.artifact_id, text),
            )
            for label in _concept_matches(text):
                pair = (obj.artifact_id, obj.id)
                same_artifact = sum(artifact_id == obj.artifact_id for artifact_id, _ in catalog_evidence[label])
                if pair not in catalog_evidence[label] and same_artifact < MAX_CONCEPT_EVIDENCE:
                    catalog_evidence[label].append(pair)
            useful = {
                token for token in tokenize(text)
                if len(token) >= 4 and token not in _STOPWORDS and not token.isdigit()
            }
            for token in useful:
                token_counts[token] += 1
                token_artifacts[token].add(obj.artifact_id)
                same_artifact = sum(artifact_id == obj.artifact_id for artifact_id, _ in token_evidence[token])
                if same_artifact < 2:
                    token_evidence[token].append((obj.artifact_id, obj.id))

        preferred = ("dataset", "sheet", "page", "slide", "document_block", "notebook_cell")
        target_roots: dict[str, str] = {}
        for artifact_id, rows in objects_by_artifact.items():
            root = next((obj for kind in preferred for obj in rows if obj.object_type == kind), rows[0] if rows else None)
            if root is not None:
                target_roots[artifact_id] = root.id
        seen_links: set[tuple[str, str]] = set()
        for obj in objects:
            raw = f"{obj.text}\n{json.dumps(obj.data, ensure_ascii=False)}".lower()
            for target_id, target in artifact_by_id.items():
                if target_id == obj.artifact_id or (obj.artifact_id, target_id) in seen_links:
                    continue
                names = {target.filename.lower(), Path(target.filename).stem.lower()}
                matched_name = next((name for name in names if len(name) >= 4 and name in raw), "")
                if not matched_name or target_id not in target_roots:
                    continue
                seen_links.add((obj.artifact_id, target_id))
                db.execute(
                    "INSERT INTO artifact_links VALUES (?, ?, ?, ?, ?)",
                    (
                        obj.artifact_id, target_id, obj.id, target_roots[target_id],
                        f"A source object explicitly names {target.filename}.",
                    ),
                )

        concepts: list[tuple[str, str, tuple[str, ...], str, list[tuple[str, str]]]] = []
        for label, evidence in catalog_evidence.items():
            concepts.append((_concept_id(label), label, _CONCEPTS[label], "curated_alias", evidence))
        generic = [
            token for token, count in token_counts.most_common()
            if len(token_artifacts[token]) >= 2 and 2 <= count <= 500 and token not in _CONCEPTS
        ][:30]
        for token in generic:
            concepts.append((_concept_id(token), token, (), "course_term", token_evidence[token]))

        for concept_id, label, aliases, kind, evidence in concepts:
            artifact_count = len({artifact_id for artifact_id, _ in evidence})
            db.execute(
                "INSERT INTO concepts VALUES (?, ?, ?, ?, ?, ?)",
                (concept_id, label, json.dumps(aliases), kind, artifact_count, len(evidence)),
            )
            db.executemany(
                "INSERT INTO concept_evidence VALUES (?, ?, ?)",
                [(concept_id, artifact_id, object_id) for artifact_id, object_id in evidence],
            )

        meta = {
            "schema_version": str(SCHEMA_VERSION),
            "source_fingerprint": _fingerprint(artifacts),
            "object_count": str(len(objects)),
            "artifact_count": str(len(artifacts)),
            "concept_count": str(len(concepts)),
            "search_method": "local FTS5 with explicit concept aliases",
        }
        db.executemany("INSERT INTO meta VALUES (?, ?)", meta.items())
        db.commit()
    os.replace(temporary, path)
    return index_status(store, course_id)


def ensure_index(store, course_id: str) -> tuple[dict[str, Any], bool]:
    before = index_status(store, course_id)
    rebuilt = False
    if before["stale"]:
        with _lock(course_id):
            current = index_status(store, course_id)
            if current["stale"]:
                build_index(store, course_id)
                rebuilt = True
    return index_status(store, course_id), rebuilt


def _expanded_terms(query: str) -> tuple[list[str], list[str]]:
    normal_query = f" {_normal(query)} "
    terms = list(dict.fromkeys(tokenize(query)[:12]))
    matched: list[str] = []
    for label, aliases in _CONCEPTS.items():
        phrases = (label, *aliases)
        if any(f" {_normal(phrase)} " in normal_query for phrase in phrases):
            matched.append(label)
            for phrase in phrases:
                terms.extend(tokenize(phrase))
    clean = [term for term in dict.fromkeys(terms) if len(term) >= 2][:40]
    return clean, matched


def search(store, course_id: str, query: str, limit: int = 20) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        raise ValueError("A search query is required.")
    status, rebuilt = ensure_index(store, course_id)
    artifacts = {artifact.id: artifact for artifact in store.load_artifacts(course_id)}
    objects = {
        obj.id: obj for obj in store.load_learning_objects(course_id)
        if obj.artifact_id in artifacts
    }
    terms, matched_concepts = _expanded_terms(query)
    if not terms:
        return {"query": query, "results": [], "index": status, "rebuilt": rebuilt}
    expression = " OR ".join(f'"{term.replace(chr(34), "")}"' for term in terms)
    candidates: list[tuple[str, str, float]] = []
    try:
        with sqlite3.connect(store.knowledge_index_path(course_id)) as db:
            candidates = list(db.execute(
                "SELECT object_id, artifact_id, bm25(docs) AS rank "
                "FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?",
                (expression, max(limit * 8, 80)),
            ))
    except sqlite3.DatabaseError:
        build_index(store, course_id)
        with sqlite3.connect(store.knowledge_index_path(course_id)) as db:
            candidates = list(db.execute(
                "SELECT object_id, artifact_id, bm25(docs) AS rank "
                "FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT ?",
                (expression, max(limit * 8, 80)),
            ))

    query_tokens = set(tokenize(query))
    per_artifact: Counter[str] = Counter()
    chosen: list[tuple[str, str, float]] = []
    deferred: list[tuple[str, str, float]] = []
    for row in candidates:
        if per_artifact[row[1]] < 4:
            chosen.append(row)
            per_artifact[row[1]] += 1
        else:
            deferred.append(row)
        if len(chosen) >= limit:
            break
    if len(chosen) < limit:
        chosen.extend(deferred[:limit - len(chosen)])

    results: list[dict[str, Any]] = []
    for object_id, artifact_id, rank in chosen:
        obj = objects.get(object_id)
        artifact = artifacts.get(artifact_id)
        if obj is None or artifact is None:
            continue
        raw = _snippet_text(obj)
        exact = bool(query_tokens.intersection(tokenize(raw)))
        results.append({
            "artifact_id": artifact_id,
            "artifact_filename": artifact.filename,
            "artifact_kind": artifact.kind,
            "artifact_purpose": artifact.purpose,
            "artifact_version": artifact.version,
            "object_id": object_id,
            "object_type": obj.object_type,
            "locator": obj.locator.to_dict(),
            "location": locator_label(obj),
            "snippet": re.sub(r"\s+", " ", raw)[:320],
            "score": round(float(-rank), 6),
            "matched_by": "source terms" if exact else "concept alias",
        })
    linked_rows: list[tuple[str, str, str, str, str]] = []
    result_artifacts = sorted({row["artifact_id"] for row in results})
    if result_artifacts:
        marks = ",".join("?" for _ in result_artifacts)
        with sqlite3.connect(store.knowledge_index_path(course_id)) as db:
            linked_rows = list(db.execute(
                f"SELECT from_artifact, to_artifact, source_object, target_object, reason "
                f"FROM artifact_links WHERE from_artifact IN ({marks})",
                result_artifacts,
            ))
    seen_objects = {row["object_id"] for row in results}
    for from_artifact, target_id, source_object, target_object, reason in linked_rows[:4]:
        obj = objects.get(target_object)
        artifact = artifacts.get(target_id)
        if obj is None or artifact is None or obj.id in seen_objects:
            continue
        raw = _snippet_text(obj)
        related = {
            "artifact_id": target_id, "artifact_filename": artifact.filename,
            "artifact_kind": artifact.kind, "artifact_purpose": artifact.purpose,
            "artifact_version": artifact.version, "object_id": obj.id,
            "object_type": obj.object_type, "locator": obj.locator.to_dict(),
            "location": locator_label(obj), "snippet": re.sub(r"\s+", " ", raw)[:320],
            "score": 0.0, "matched_by": "artifact relationship",
            "relationship_reason": reason, "related_from_artifact": from_artifact,
            "related_from_object": source_object,
        }
        if len(results) >= limit:
            results.pop()
        results.append(related)
        seen_objects.add(obj.id)
    return {
        "query": query, "expanded_concepts": matched_concepts, "results": results,
        "index": status, "rebuilt": rebuilt,
        "method": "Local lexical search with explicit, inspectable concept aliases.",
    }


def concept_graph(store, course_id: str, query: str = "", limit: int = 18) -> dict[str, Any]:
    status, rebuilt = ensure_index(store, course_id)
    artifacts = {artifact.id: artifact for artifact in store.load_artifacts(course_id)}
    path = store.knowledge_index_path(course_id)
    where = ""
    params: list[Any] = []
    if query.strip():
        where = "WHERE lower(label) LIKE ? OR lower(aliases) LIKE ?"
        needle = f"%{query.strip().lower()}%"
        params.extend([needle, needle])
    params.append(limit)
    with sqlite3.connect(path) as db:
        concept_rows = list(db.execute(
            "SELECT concept_id, label, aliases, kind, artifact_count, evidence_count "
            f"FROM concepts {where} ORDER BY CASE kind WHEN 'curated_alias' THEN 0 ELSE 1 END, "
            "artifact_count DESC, evidence_count DESC, label LIMIT ?",
            params,
        ))
        ids = [row[0] for row in concept_rows]
        evidence_rows: list[tuple[str, str, str]] = []
        if ids:
            marks = ",".join("?" for _ in ids)
            evidence_rows = list(db.execute(
                f"SELECT concept_id, artifact_id, object_id FROM concept_evidence WHERE concept_id IN ({marks})",
                ids,
            ))
        artifact_links = list(db.execute(
            "SELECT from_artifact, to_artifact, source_object, target_object, reason FROM artifact_links"
        ))

    evidence_by_pair: dict[tuple[str, str], list[str]] = defaultdict(list)
    for concept_id, artifact_id, object_id in evidence_rows:
        evidence_by_pair[(concept_id, artifact_id)].append(object_id)
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    selected_labels = {row[1]: row[0] for row in concept_rows}
    used_artifacts: set[str] = set()
    for concept_id, label, aliases, kind, artifact_count, evidence_count in concept_rows:
        nodes.append({
            "id": concept_id, "node_type": "concept", "label": label,
            "aliases": json.loads(aliases), "kind": kind,
            "artifact_count": artifact_count, "evidence_count": evidence_count,
        })
        for (candidate, artifact_id), object_ids in evidence_by_pair.items():
            if candidate != concept_id or artifact_id not in artifacts:
                continue
            used_artifacts.add(artifact_id)
            edges.append({
                "from": concept_id, "to": f"artifact-{artifact_id}", "relation": "appears_in",
                "object_ids": object_ids[:MAX_CONCEPT_EVIDENCE],
                "reason": f"{len(object_ids)} exact source object(s) evidence this relationship.",
                "certainty": "measured lexical evidence",
            })
    for artifact_id in sorted(used_artifacts):
        artifact = artifacts[artifact_id]
        nodes.append({
            "id": f"artifact-{artifact_id}", "node_type": "artifact", "label": artifact.filename,
            "artifact_id": artifact_id, "kind": artifact.kind, "purpose": artifact.purpose,
            "version": artifact.version,
        })
    existing_node_ids = {node["id"] for node in nodes}
    for from_artifact, to_artifact, source_object, target_object, reason in artifact_links:
        if from_artifact not in artifacts or to_artifact not in artifacts:
            continue
        for artifact_id in (from_artifact, to_artifact):
            node_id = f"artifact-{artifact_id}"
            if node_id not in existing_node_ids:
                artifact = artifacts[artifact_id]
                nodes.append({
                    "id": node_id, "node_type": "artifact", "label": artifact.filename,
                    "artifact_id": artifact_id, "kind": artifact.kind,
                    "purpose": artifact.purpose, "version": artifact.version,
                })
                existing_node_ids.add(node_id)
        edges.append({
            "from": f"artifact-{from_artifact}", "to": f"artifact-{to_artifact}",
            "relation": "explicit_reference", "object_ids": [source_object, target_object],
            "source_object_id": source_object, "target_object_id": target_object,
            "reason": reason, "certainty": "measured filename reference",
        })
    for required, advanced in _PREREQUISITES:
        if required in selected_labels and advanced in selected_labels:
            edges.append({
                "from": selected_labels[required], "to": selected_labels[advanced],
                "relation": "prerequisite_candidate", "object_ids": [],
                "reason": "Teaching-order candidate from the inspectable concept catalog. Verify against the linked course evidence.",
                "certainty": "modeled candidate",
            })
    return {
        "nodes": nodes, "edges": edges, "index": status, "rebuilt": rebuilt,
        "warning": "Prerequisite arrows are labeled candidates, not source facts, unless the linked evidence states the dependency.",
    }


__all__ = ["build_index", "ensure_index", "index_status", "search", "concept_graph"]
