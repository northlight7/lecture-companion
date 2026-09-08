#!/usr/bin/env python3
"""Measure local cross-artifact search and the concept graph on all five courses."""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

from app.course import CourseStore
from app.importer import import_files
from app.knowledge import concept_graph, search

QUERIES = {
    "AI Enhanced Business Analysis with Python and Excel": "histogram",
    "Business Data Analytics": "shrinkage",
    "Database Management Systems": "cardinality",
    "Ethics and Regulations": "utilitarian",
    "Fintech and AI in Finance": "look-ahead bias",
}


def prepare(source: Path, courses_root: Path) -> tuple[CourseStore, dict[str, str]]:
    store = CourseStore(courses_root)
    ids: dict[str, str] = {}
    for folder in sorted(path for path in source.iterdir() if path.is_dir()):
        course = next((item for item in store.list_courses() if item.title == folder.name), None)
        if course is None:
            course = store.create_course(folder.name)
        payload = [
            (path.relative_to(folder).as_posix(), path.read_bytes())
            for path in sorted(folder.rglob("*"))
            if path.is_file() and path.name != ".DS_Store"
        ]
        result = import_files(store, course.id, payload)
        if result.errors:
            raise SystemExit(json.dumps(result.errors))
        ids[folder.name] = course.id
    return store, ids


def api_json(base: str, path: str):
    with urllib.request.urlopen(base.rstrip("/") + path, timeout=60) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:45711")
    parser.add_argument("--source", type=Path, default=Path("/Users/north/Desktop/Courses"))
    parser.add_argument("--courses-root", type=Path, required=True)
    parser.add_argument("--shots", type=Path, default=Path(".internal/knowledge-shots"))
    args = parser.parse_args()
    store, ids = prepare(args.source.resolve(), args.courses_root.resolve())
    failures: list[str] = []
    metrics: dict[str, dict] = {}
    all_artifacts = {
        title: {artifact.id for artifact in store.load_artifacts(cid)}
        for title, cid in ids.items()
    }
    for title, query in QUERIES.items():
        started = time.monotonic()
        result = search(store, ids[title], query, limit=24)
        build_and_search = time.monotonic() - started
        graph = concept_graph(store, ids[title], limit=30)
        if not result["results"]:
            failures.append(f"{title}: no results for {query!r}")
        if not graph["nodes"] or not graph["edges"]:
            failures.append(f"{title}: concept graph has no relationships")
        for row in result["results"]:
            if row["artifact_id"] not in all_artifacts[title]:
                failures.append(f"{title}: foreign artifact in results")
            exact = store.load_learning_objects(ids[title], row["artifact_id"])
            if row["object_id"] not in {obj.id for obj in exact}:
                failures.append(f"{title}: unresolved object {row['object_id']}")
        if build_and_search > 15:
            failures.append(f"{title}: initial local search took {build_and_search:.2f}s")
        warm_started = time.monotonic()
        search(store, ids[title], query, limit=24)
        warm_search = time.monotonic() - warm_started
        if warm_search > 2:
            failures.append(f"{title}: warm search took {warm_search:.2f}s")
        metrics[title] = {
            "query": query, "results": len(result["results"]),
            "kinds": sorted({row["artifact_kind"] for row in result["results"]}),
            "nodes": len(graph["nodes"]), "edges": len(graph["edges"]),
            "initial_seconds": round(build_and_search, 3), "warm_seconds": round(warm_search, 3),
        }

    analytics = search(store, ids["Business Data Analytics"], "shrinkage", limit=30)
    analytics_kinds = {row["artifact_kind"] for row in analytics["results"]}
    if not {"pdf", "ipynb", "csv"} <= analytics_kinds:
        failures.append(f"Business Data Analytics: semantic cross-artifact kinds were {sorted(analytics_kinds)}")
    analytics_graph = concept_graph(store, ids["Business Data Analytics"], limit=40)
    if not any(edge["relation"] == "explicit_reference" for edge in analytics_graph["edges"]):
        failures.append("Business Data Analytics: notebook-to-dataset relationship missing")

    args.shots.mkdir(parents=True, exist_ok=True)
    console: list[str] = []
    cid = ids["Business Data Analytics"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in ((1280, 720), (1440, 900)):
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
            page.on("pageerror", lambda error: console.append(f"pageerror: {error}"))
            page.goto(f"{args.base}/#/c/{cid}", wait_until="networkidle")
            page.locator("#course-search-query").fill("shrinkage")
            page.locator("#course-search button[type=submit]").click()
            page.locator("#search-results .search-result").first.wait_for()
            if page.locator("#search-results .search-result").count() < 3:
                failures.append(f"browser {width}x{height}: too few cross-artifact results")
            hrefs = page.locator("#search-results .search-result-link").evaluate_all(
                "links => links.map(link => link.getAttribute('href'))"
            )
            if not hrefs or any(f"#/c/{cid}/a/" not in href for href in hrefs):
                failures.append(f"browser {width}x{height}: result lacks exact course source link")
            page.locator("#show-relationships").click()
            page.locator("#concept-graph .concept-node").first.wait_for()
            if page.locator("#concept-graph .prerequisite-list a").count() < 2:
                failures.append(f"browser {width}x{height}: explicit file relationship links missing")
            overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
            if overflow:
                failures.append(f"browser {width}x{height}: horizontal overflow")
            page.screenshot(path=str(args.shots / f"knowledge-{width}x{height}.png"), full_page=False)
            context.close()
        browser.close()
    failures.extend(console)
    print(json.dumps(metrics, indent=2, sort_keys=True))
    if failures:
        print("FAIL")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print("PASS five-course local search, exact links, concept graph, isolation, performance, and responsive UI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
