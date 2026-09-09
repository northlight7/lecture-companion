#!/usr/bin/env python3
"""Measure real-course notebook execution, interruption, isolation, and UI."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

from app.course import CourseStore
from app.importer import import_files


def notebook(cells: list[str]) -> bytes:
    return json.dumps({
        "cells": [
            {
                "cell_type": "code", "id": f"gate-{index}", "metadata": {},
                "execution_count": None, "outputs": [], "source": [source],
            }
            for index, source in enumerate(cells)
        ],
        "metadata": {"kernelspec": {"name": "python3"}},
        "nbformat": 4, "nbformat_minor": 5,
    }).encode("utf-8")


def api(base: str, path: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        base.rstrip("/") + path, data=data,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def wait_run(base: str, path: str, *, timeout: float = 45) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = api(base, path)
        if status["state"] in {"done", "error", "paused"}:
            return status
        time.sleep(0.1)
    raise RuntimeError(f"execution did not finish: {api(base, path)}")


def prepare(source: Path, courses_root: Path) -> tuple[CourseStore, str, str, str, str]:
    store = CourseStore(courses_root)
    title = "Notebook Execution Gate"
    course = next((row for row in store.list_courses() if row.title == title), None)
    if course is None:
        course = store.create_course(title)
    payload = [
        (path.relative_to(source).as_posix(), path.read_bytes())
        for path in sorted(source.rglob("*")) if path.is_file() and path.name != ".DS_Store"
    ]
    payload.extend([
        ("Gate/gate-data.csv", b"x,y\n1,3\n2,5\n"),
        ("Gate/ui-execution.ipynb", notebook([
            "print('GATE_STDOUT')\nseed = 40",
            "import pandas as pd\ndf = pd.read_csv('gate-data.csv')\ndf",
            "import matplotlib.pyplot as plt\nplt.plot(df['x'], df['y'])\nplt.title('GATE_PLOT')",
            "seed + 2",
        ])),
        ("Gate/resume-execution.ipynb", notebook([
            "from pathlib import Path\np = Path('counter.txt')\np.write_text(str(int(p.read_text()) + 1) if p.exists() else '1')\nanswer = 42",
            "import time\ntime.sleep(5)",
            "answer",
        ])),
    ])
    result = import_files(store, course.id, payload)
    if result.errors:
        raise RuntimeError(json.dumps(result.errors))
    artifacts = store.load_artifacts(course.id)
    real = next(row for row in artifacts if row.kind == "ipynb" and "Regression Analysis" in row.filename)
    ui = next(row for row in artifacts if row.filename == "ui-execution.ipynb")
    resume = next(row for row in artifacts if row.filename == "resume-execution.ipynb")
    return store, course.id, real.id, ui.id, resume.id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:45729")
    parser.add_argument("--source", type=Path, default=Path("/Users/north/Desktop/Courses/Business Data Analytics"))
    parser.add_argument("--courses-root", type=Path, required=True)
    parser.add_argument("--shots", type=Path, default=Path(".internal/notebook-execution-shots"))
    args = parser.parse_args()
    store, cid, real_aid, ui_aid, resume_aid = prepare(args.source.resolve(), args.courses_root.resolve())
    failures: list[str] = []

    environment = api(args.base, f"/api/courses/{cid}/artifacts/{real_aid}/execution/environment")
    if environment["environment"]["network"] != "denied by operating-system sandbox":
        failures.append("environment disclosure did not report OS network denial")
    if not any(row["index"] == 25 for row in environment["code_cells"]):
        failures.append("real regression notebook cell 26 was not addressable")
    real_run = api(args.base, f"/api/courses/{cid}/artifacts/{real_aid}/execution", {
        "confirmed": True, "cell_indices": [25], "cell_timeout_seconds": 30,
    })
    real_status = wait_run(args.base, f"/api/courses/{cid}/artifacts/{real_aid}/execution/{real_run['run_id']}")
    if real_status["state"] != "done":
        failures.append(f"real notebook dataset cell failed: {real_status.get('pause_reason')}")
    elif real_status["results"][0].get("value", {}).get("kind") != "table":
        failures.append("real notebook dataset cell did not return a table")
    if not any(row["source_path"] == "L2/Airbnb.csv" for row in real_status["linked_files"]):
        failures.append("real notebook did not receive its exact relative Airbnb dataset")

    resume_run = api(args.base, f"/api/courses/{cid}/artifacts/{resume_aid}/execution", {
        "confirmed": True, "cell_timeout_seconds": 10,
    })
    resume_path = f"/api/courses/{cid}/artifacts/{resume_aid}/execution/{resume_run['run_id']}"
    current = api(args.base, resume_path)
    if current["state"] != "done":
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            current = api(args.base, resume_path)
            if current["completed_cells"] == [0] and current["current_cell"] == 1:
                break
            time.sleep(0.05)
        else:
            failures.append("resume gate never reached its interruptible cell")
            current = api(args.base, resume_path)
        if current["state"] == "running":
            stopped = api(args.base, resume_path + "/stop", {})
            resumed = api(args.base, resume_path + "/resume", {"confirmed": True})
            current = wait_run(args.base, resume_path, timeout=25)
            if stopped["state"] != "paused" or current["state"] != "done":
                failures.append("interrupted execution did not resume to completion")
    counter = store.execution_run_dir(cid, resume_aid, resume_run["run_id"]) / "workspace" / "Gate" / "counter.txt"
    if not counter.is_file() or counter.read_text("utf-8") != "1":
        failures.append("completed work was duplicated while resuming or rerunning the gate")

    args.shots.mkdir(parents=True, exist_ok=True)
    console: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        for width, height in ((1280, 720), (1440, 900)):
            context = browser.new_context(viewport={"width": width, "height": height})
            page = context.new_page()
            page.on("console", lambda message: console.append(f"{message.type}: {message.text}") if message.type == "error" else None)
            page.on("pageerror", lambda error: console.append(f"pageerror: {error}"))
            page.goto(f"{args.base}/#/c/{cid}/a/{ui_aid}", wait_until="networkidle")
            page.locator("#execution-panel:not([hidden])").wait_for()
            disclosure = page.locator("#execution-disclosure").inner_text()
            if "without DeepSeek" not in disclosure or "Network is denied" not in disclosure:
                failures.append(f"{width}x{height}: incomplete pre-run disclosure")
            page.locator("#execution-confirm").check()
            selected_only = width == 1440
            if selected_only:
                page.locator("#native-viewer .source-select").first.check()
                page.locator("#run-selected-cells").click()
            else:
                page.locator("#run-all-cells").click()
            expected = 1 if selected_only else 4
            page.wait_for_function(
                "expected => document.querySelector('#execution-state').textContent.trim().toLowerCase() === 'done' && document.querySelectorAll('#execution-results [data-execution-cell]').length === expected",
                arg=expected, timeout=45000,
            )
            if page.locator("#execution-results [data-execution-cell]").count() != expected:
                failures.append(f"{width}x{height}: expected {expected} computed cell results")
            if not selected_only and page.locator("#execution-results .execution-plot").count() != 1:
                failures.append(f"{width}x{height}: computed plot was not rendered")
            if "GATE_STDOUT" not in page.locator("#execution-results").inner_text():
                failures.append(f"{width}x{height}: stdout was not visible")
            if page.locator("#execution-results a[href*='/a/']").count() != expected:
                failures.append(f"{width}x{height}: computed results lacked exact source-cell links")
            overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
            if overflow:
                failures.append(f"{width}x{height}: horizontal overflow")
            page.screenshot(path=str(args.shots / f"notebook-{width}x{height}.png"), full_page=False)
            context.close()
        browser.close()
    failures.extend(console)
    metrics = {
        "real_notebook_cell": 25,
        "real_table_shape": real_status.get("results", [{}])[0].get("value", {}).get("shape"),
        "linked_course_files": len(real_status.get("linked_files", [])),
        "resume_completed_cells": current.get("completed_cells", []),
        "viewports": ["1280x720", "1440x900"],
        "deepseek_spend_usd": 0,
    }
    print(json.dumps(metrics, indent=2))
    if failures:
        print("FAIL")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print("PASS real notebook execution, relative data, interruption resume, provenance, and responsive UI")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
