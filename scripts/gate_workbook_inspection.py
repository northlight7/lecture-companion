#!/usr/bin/env python3
"""Measure real workbook verification, diagnosis, copy experiments, and UI."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

from app.course import CourseStore
from app.importer import import_files


def api(base: str, path: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base.rstrip("/") + path, data=data,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def prepare(source: Path, courses_root: Path) -> tuple[CourseStore, str, dict[str, str], dict[str, str]]:
    store = CourseStore(courses_root)
    title = "Workbook Inspection Gate"
    course = next((row for row in store.list_courses() if row.title == title), None)
    if course is None:
        course = store.create_course(title)
    payload = [
        (path.relative_to(source).as_posix(), path.read_bytes())
        for path in sorted(source.rglob("*.xlsx"))
    ]
    source_hashes = {name: hashlib.sha256(data).hexdigest() for name, data in payload}
    result = import_files(store, course.id, payload)
    if result.errors:
        raise RuntimeError(json.dumps(result.errors))
    ids = {row.filename: row.artifact_id for row in result.filed}
    return store, course.id, ids, source_hashes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:45751")
    parser.add_argument("--source", type=Path, default=Path("/Users/north/Desktop/Courses/AI Enhanced Business Analysis with Python and Excel"))
    parser.add_argument("--courses-root", type=Path, required=True)
    parser.add_argument("--shots", type=Path, default=Path(".internal/workbook-inspection-shots"))
    args = parser.parse_args()
    store, cid, ids, source_hashes = prepare(args.source.resolve(), args.courses_root.resolve())
    failures: list[str] = []
    audits: dict[str, dict] = {}
    for filename, aid in ids.items():
        audits[filename] = api(args.base, f"/api/courses/{cid}/artifacts/{aid}/workbook/inspect", {})
        if not audits[filename]["source_bytes_preserved"]:
            failures.append(f"{filename}: audit did not preserve source bytes")
        artifact = next(row for row in store.load_artifacts(cid) if row.id == aid)
        imported = store.course_dir(cid) / artifact.stored_path
        relative = next(path for path in source_hashes if Path(path).name == filename)
        if hashlib.sha256(imported.read_bytes()).hexdigest() != source_hashes[relative]:
            failures.append(f"{filename}: imported original hash changed")

    visual = audits["Data Visualization.xlsx"]
    c8 = next((row for row in visual["formulas"] if row["locator"] == {"sheet": "1 Comparison", "cell_range": "C8"}), None)
    if not c8 or c8["calculated_value"] != 420 or c8["matches_cached"] is not True or c8["unit"] != "HKD thousands":
        failures.append(f"C8 SUMIFS verification failed: {c8}")
    elif c8["intermediate"][-1].get("matching_rows") != 3:
        failures.append("C8 SUMIFS did not expose three matching source rows")
    orientation = next((row for row in visual["charts"] if row["locator"]["sheet"] == "6 Orientation"), None)
    if not orientation or not any("Switch Row/Column" in item["message"] for item in orientation["diagnostics"]):
        failures.append("real orientation chart did not receive a structural warning")
    formatting = audits["Formatting Sorting and Filtering.xlsx"]
    stop_rules = [
        row for row in formatting["formatting_and_filters"]
        if row["kind"] == "conditional_formatting" and row["locator"]["sheet"] == "Stop If True"
    ]
    if [(row["priority"], row["stop_if_true"]) for row in stop_rules] != [(1, True), (2, False)]:
        failures.append(f"Stop If True rule semantics were not preserved: {stop_rules}")

    visual_aid = ids["Data Visualization.xlsx"]
    experiment = api(args.base, f"/api/courses/{cid}/artifacts/{visual_aid}/workbook/experiments", {
        "sheet": "1 Comparison", "cell": "C8", "formula": c8["formula"],
    })
    if experiment["calculated_value"] != 420 or not experiment["source_bytes_preserved"] or "copy" not in experiment["provenance"]:
        failures.append("copy-only C8 experiment failed")
    second = api(args.base, f"/api/courses/{cid}/artifacts/{visual_aid}/workbook/inspect", {})
    if not second["cache_hit"] or second["generated_at"] != visual["generated_at"]:
        failures.append("workbook inspection was not idempotently cached")

    other = store.create_course("Workbook Foreign Gate") if not store.exists("workbook-foreign-gate") else store.get_course("workbook-foreign-gate")
    try:
        api(args.base, f"/api/courses/{other.id}/artifacts/{visual_aid}/workbook/status")
        failures.append("foreign course could inspect a workbook")
    except Exception:
        pass

    args.shots.mkdir(parents=True, exist_ok=True)
    console: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in ((1280, 720), (1440, 900)):
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            page.on("console", lambda message: console.append(f"{message.type}: {message.text}") if message.type == "error" else None)
            page.on("pageerror", lambda error: console.append(f"pageerror: {error}"))
            page.goto(f"{args.base}/#/c/{cid}/a/{visual_aid}", wait_until="networkidle")
            page.locator("#workbook-panel:not([hidden])").wait_for()
            page.locator("#inspect-workbook").click()
            page.locator("[data-formula-cell='C8']").wait_for(timeout=30000)
            formula_text = page.locator("[data-formula-cell='C8']").inner_text()
            if "420" not in formula_text or "HKD thousands" not in formula_text:
                failures.append(f"{width}x{height}: C8 verification or unit missing")
            page.get_by_text("Chart checks", exact=True).click()
            if "Switch Row/Column" not in page.locator("#workbook-results").inner_text():
                failures.append(f"{width}x{height}: chart orientation diagnosis missing")
            if page.locator("#workbook-results a[href*='/a/']").count() < 5:
                failures.append(f"{width}x{height}: exact workbook evidence links missing")
            page.get_by_text("Try a formula on a copy", exact=True).click()
            page.locator("#experiment-sheet").fill("1 Comparison")
            page.locator("#experiment-cell").fill("C8")
            page.locator("#experiment-formula").fill(c8["formula"])
            page.locator("#run-formula-experiment").click()
            page.locator("#experiment-result").filter(has_text="420").wait_for(timeout=30000)
            c8_link = page.locator("[data-formula-cell='C8'] h3 a")
            c8_link.click()
            page.locator(f"[data-object-id='{c8['object_id']}'].current").wait_for(timeout=30000)
            page.locator("[data-formula-cell='C8']").wait_for(timeout=30000)
            if page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth"):
                failures.append(f"{width}x{height}: horizontal overflow")
            page.screenshot(path=str(args.shots / f"workbook-{width}x{height}.png"), full_page=False)
            context.close()
        browser.close()
    failures.extend(console)
    metrics = {
        filename: audit["summary"] for filename, audit in audits.items()
    }
    metrics["C8"] = {"calculated": c8["calculated_value"], "cached": c8["cached_value"], "unit": c8["unit"]}
    metrics["viewports"] = ["1280x720", "1440x900"]
    metrics["deepseek_spend_usd"] = 0
    print(json.dumps(metrics, indent=2, sort_keys=True))
    if failures:
        print("FAIL")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print("PASS real workbook formulas, chart diagnosis, rules, copy experiment, provenance, and UI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
