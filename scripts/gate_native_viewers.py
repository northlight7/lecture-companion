#!/usr/bin/env python3
"""Operate all six native viewers and selected-context questions in Chromium."""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

from app.course import CourseStore
from app.importer import import_files

KINDS = ("pdf", "pptx", "docx", "xlsx", "csv", "ipynb")


def prepare(source: Path, courses_root: Path) -> str:
    store = CourseStore(courses_root)
    course = next((item for item in store.list_courses() if item.title == "Native Viewer Gate"), None)
    if course is None:
        course = store.create_course("Native Viewer Gate")
    selected: dict[str, Path] = {}
    suffix_kind = {".pdf": "pdf", ".pptx": "pptx", ".docx": "docx", ".xlsx": "xlsx", ".csv": "csv", ".ipynb": "ipynb"}
    for path in sorted(source.rglob("*")):
        kind = suffix_kind.get(path.suffix.lower())
        if not path.is_file() or not kind:
            continue
        if kind not in selected or (kind == "ipynb" and b'"image/png"' in path.read_bytes()):
            selected[kind] = path
    if tuple(sorted(selected)) != tuple(sorted(KINDS)):
        raise SystemExit(f"source does not contain all six formats: {sorted(selected)}")
    payload = [
        (path.relative_to(source).as_posix(), path.read_bytes())
        for kind, path in selected.items()
    ]
    result = import_files(store, course.id, payload)
    if result.errors:
        raise SystemExit(json.dumps(result.errors))
    return course.id


def api_json(base: str, path: str):
    with urllib.request.urlopen(base.rstrip("/") + path, timeout=30) as response:
        return json.loads(response.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:45679")
    parser.add_argument("--source", type=Path, default=Path("/Users/north/Desktop/Courses"))
    parser.add_argument("--courses-root", type=Path, required=True)
    parser.add_argument("--shots", type=Path, default=Path(".internal/native-viewer-shots"))
    args = parser.parse_args()
    cid = prepare(args.source.resolve(), args.courses_root.resolve())
    course = api_json(args.base, f"/api/courses/{cid}")
    by_kind = {artifact["kind"]: artifact for artifact in course["artifacts"]}
    missing = [kind for kind in KINDS if kind not in by_kind]
    if missing:
        raise SystemExit(f"prepared course is missing native viewers: {missing}")
    failures: list[str] = []
    console: list[str] = []
    args.shots.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in ((1280, 720), (1440, 900)):
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            page.on("console", lambda msg: console.append(f"{msg.type}: {msg.text}") if msg.type == "error" else None)
            page.on("pageerror", lambda error: console.append(f"pageerror: {error}"))
            for kind in KINDS:
                artifact = by_kind[kind]
                url = f"{args.base}/#/c/{cid}/a/{artifact['id']}"
                page.goto(url, wait_until="networkidle")
                page.locator("#screen-artifact:not([hidden])").wait_for()
                page.locator(f'#native-viewer[data-artifact-id="{artifact["id"]}"]').wait_for()
                marker = page.locator("[data-native-viewer]:not([hidden])").count() == 1
                objects = page.locator("#native-viewer [data-object-id]").count()
                overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
                if not marker or not objects or overflow:
                    failures.append(f"{kind} {width}x{height}: marker={marker} objects={objects} overflow={overflow}")
                    continue
                first = page.locator("#native-viewer [data-object-id]").first
                oid = first.get_attribute("data-object-id")
                checkbox = first.locator("input.source-select")
                checkbox.check()
                page.locator("#context-question").fill("What does this selected source show?")
                page.locator("#ask-selected-context").click()
                page.locator("#question-answer .citations a").first.wait_for()
                answer_text = page.locator("#question-answer").inner_text()
                if kind == "xlsx" and "dimensions" not in answer_text.lower():
                    failures.append(f"{kind} {width}x{height}: sheet question omitted structured dimensions")
                if kind == "csv" and "row_count" not in answer_text:
                    failures.append(f"{kind} {width}x{height}: dataset question omitted structured row count")
                citation_href = page.locator("#question-answer .citations a").first.get_attribute("href") or ""
                if not oid or oid not in citation_href:
                    failures.append(f"{kind} {width}x{height}: citation did not round-trip to selected object")
                page.goto(args.base + "/" + citation_href, wait_until="networkidle")
                current_locator = page.locator(f'[data-object-id="{oid}"].current')
                current_locator.wait_for()
                current = current_locator.count()
                location_text = page.locator("#source-location").inner_text()
                if current != 1 or not location_text.strip():
                    failures.append(f"{kind} {width}x{height}: exact deep link did not resolve")
                if kind == "xlsx":
                    sheet = page.locator("#native-viewer article:has(.sheet-metadata)").first
                    sheet_oid = sheet.get_attribute("data-object-id")
                    if not sheet_oid:
                        failures.append(f"{kind} {width}x{height}: sheet metadata object is not inspectable")
                    else:
                        page.goto(f"{args.base}/#/c/{cid}/a/{artifact['id']}/{sheet_oid}", wait_until="networkidle")
                        page.locator(f'article[data-object-id="{sheet_oid}"].current:has(.sheet-metadata)').wait_for()
                if kind in ("docx", "ipynb"):
                    embedded = page.locator("#native-viewer img.native-embedded")
                    if embedded.count() == 0:
                        failures.append(f"{kind} {width}x{height}: saved embedded visual was not rendered")
                    else:
                        embedded.first.wait_for(state="visible")
                        loaded = embedded.first.evaluate("img => img.complete && img.naturalWidth > 0")
                        if not loaded:
                            failures.append(f"{kind} {width}x{height}: embedded visual failed to load")
                page.screenshot(path=str(args.shots / f"{kind}-{width}x{height}.png"), full_page=False)
                print(f"PASS {kind:5} {width}x{height} objects={objects} oid={oid}")
            context.close()
        browser.close()
    if console:
        failures.extend(console)
    if failures:
        print("FAIL")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print("PASS all six native viewers, exact deep links, questions, citations, and viewport checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
