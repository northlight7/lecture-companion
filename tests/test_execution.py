"""Controlled notebook execution, sandbox, outputs, and resume gates."""

from __future__ import annotations

import json
import time

import pytest

from app.execution import (
    environment_info, execution_status, resume_execution, start_execution, stop_execution,
)
from app.importer import import_files


def _notebook(cells: list[str]) -> bytes:
    return json.dumps({
        "cells": [
            {"cell_type": "code", "id": f"cell-{index}", "metadata": {}, "execution_count": None, "outputs": [], "source": [source]}
            for index, source in enumerate(cells)
        ],
        "metadata": {"kernelspec": {"name": "python3"}}, "nbformat": 4, "nbformat_minor": 5,
    }).encode()


def _wait(store, cid: str, aid: str, run_id: str, states=("done", "error", "paused"), timeout=20):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        status = execution_status(store, cid, aid, run_id)
        if status["state"] in states:
            return status
        time.sleep(0.05)
    raise AssertionError(f"execution did not finish: {execution_status(store, cid, aid, run_id)}")


def test_execution_requires_confirmation_and_discloses_actual_limits(store):
    course = store.create_course("Confirmed execution")
    imported = import_files(store, course.id, [("lab.ipynb", _notebook(["1 + 1"]))])
    aid = imported.filed[0].artifact_id
    with pytest.raises(PermissionError):
        start_execution(store, course.id, aid, confirmed=False)
    environment = environment_info()
    assert environment["sandbox_backend"] == "/usr/bin/sandbox-exec"
    assert environment["network"] == "denied by operating-system sandbox"
    assert environment["remote_model_used"] is False
    assert environment["packages"]["pandas"] != "not installed"


def test_runtime_captures_stdout_table_plot_warning_and_exact_cell_provenance(store):
    course = store.create_course("Captured execution")
    notebook = _notebook([
        "print('LOCAL_STDOUT'); base = 40",
        "import warnings\nwarnings.warn('CHECK_WARNING')\nbase + 2",
        "import pandas as pd\ndf = pd.read_csv('data.csv')\ndf.head()",
        "import matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 5])\nplt.title('LOCAL_PLOT')",
    ])
    imported = import_files(store, course.id, [("L2/data.csv", b"x,y\n1,2\n3,4\n"), ("L2/lab.ipynb", notebook)])
    aid = next(row.artifact_id for row in imported.filed if row.kind == "ipynb")
    started = start_execution(store, course.id, aid, confirmed=True, cell_timeout_seconds=15)
    status = _wait(store, course.id, aid, started["run_id"], timeout=30)
    assert status["state"] == "done"
    assert status["completed_cells"] == [0, 1, 2, 3]
    assert "LOCAL_STDOUT" in status["results"][0]["stdout"]
    assert status["results"][1]["value"]["text"] == "42"
    assert status["results"][1]["warnings"][0]["message"] == "CHECK_WARNING"
    assert "current local runtime" in status["results"][1]["warnings"][0]["diagnostic"]
    assert status["results"][2]["value"]["kind"] == "table"
    assert status["results"][2]["value"]["shape"] == [2, 2]
    assert status["results"][3]["plots"]
    assert all(row["object_id"] and row["locator"]["notebook_cell"] is not None for row in status["results"])
    assert all(row["provenance"].startswith("computed locally") for row in status["results"])
    assert status["disclosure"].startswith("Runs locally without DeepSeek")
    again = start_execution(store, course.id, aid, confirmed=True, cell_timeout_seconds=15)
    assert again["run_id"] == status["run_id"] and len(again["results"]) == 4


def test_os_sandbox_denies_network_and_other_course_files(store):
    course_a = store.create_course("Sandbox A")
    course_b = store.create_course("Sandbox B")
    foreign = import_files(store, course_b.id, [("secret.csv", b"FOREIGN_SECRET\n")])
    foreign_artifact = store.load_artifacts(course_b.id)[0]
    foreign_path = store.course_dir(course_b.id) / foreign_artifact.stored_path
    code = (
        "from pathlib import Path\n"
        f"Path({str(foreign_path)!r}).read_text()"
    )
    imported = import_files(store, course_a.id, [("deny.ipynb", _notebook([code]))])
    aid = imported.filed[0].artifact_id
    run = start_execution(store, course_a.id, aid, confirmed=True, cell_timeout_seconds=5)
    denied = _wait(store, course_a.id, aid, run["run_id"])
    assert denied["state"] == "error"
    assert "Operation not permitted" in denied["results"][0]["traceback"]
    assert "sandbox denied" in denied["results"][0]["diagnostic"]
    assert "FOREIGN_SECRET" not in json.dumps(denied)

    network_book = import_files(store, course_a.id, [(
        "network.ipynb", _notebook(["import socket\nsocket.create_connection(('127.0.0.1', 9), timeout=1)"])
    )])
    network_aid = network_book.filed[0].artifact_id
    network_run = start_execution(store, course_a.id, network_aid, confirmed=True, cell_timeout_seconds=5)
    network = _wait(store, course_a.id, network_aid, network_run["run_id"])
    assert network["state"] == "error"
    assert "Operation not permitted" in network["results"][0]["traceback"]
    assert foreign.filed[0].artifact_id != aid

    process_book = import_files(store, course_a.id, [(
        "process.ipynb", _notebook(["import subprocess\nsubprocess.run(['/bin/echo', 'NOT_ALLOWED'], check=True)"])
    )])
    process_aid = process_book.filed[0].artifact_id
    process_run = start_execution(store, course_a.id, process_aid, confirmed=True, cell_timeout_seconds=5)
    process = _wait(store, course_a.id, process_aid, process_run["run_id"])
    assert process["state"] == "error"
    assert "Operation not permitted" in process["results"][0]["traceback"]
    assert "NOT_ALLOWED" not in process["results"][0]["stdout"]


def test_stop_and_resume_uses_checkpoint_without_reexecuting_completed_cell(store):
    course = store.create_course("Resume execution")
    notebook = _notebook([
        "from pathlib import Path\np = Path('counter.txt')\np.write_text(str(int(p.read_text()) + 1) if p.exists() else '1')\nx = 41",
        "import time\ntime.sleep(5)",
        "x + 1",
    ])
    imported = import_files(store, course.id, [("resume.ipynb", notebook)])
    aid = imported.filed[0].artifact_id
    run = start_execution(store, course.id, aid, confirmed=True, cell_timeout_seconds=10)
    end = time.monotonic() + 15
    while time.monotonic() < end:
        current = execution_status(store, course.id, aid, run["run_id"])
        if current["completed_cells"] == [0] and current["current_cell"] == 1:
            break
        time.sleep(0.05)
    else:
        raise AssertionError("execution never reached the interruptible second cell")
    paused = stop_execution(store, course.id, aid, run["run_id"])
    assert paused["state"] == "paused" and paused["completed_cells"] == [0]
    resumed = resume_execution(store, course.id, aid, run["run_id"], confirmed=True)
    done = _wait(store, course.id, aid, resumed["run_id"], timeout=20)
    assert done["state"] == "done" and done["completed_cells"] == [0, 1, 2]
    assert done["results"][-1]["value"]["text"] == "42"
    counter = store.execution_run_dir(course.id, aid, run["run_id"]) / "workspace" / "counter.txt"
    assert counter.read_text("utf-8") == "1"
    assert [row["cell_index"] for row in done["results"]].count(0) == 1


def test_source_change_marks_execution_stale_and_blocks_resume(store):
    course = store.create_course("Stale execution")
    first = import_files(store, course.id, [("lab.ipynb", _notebook(["raise RuntimeError('old')"]))])
    aid = first.filed[0].artifact_id
    run = start_execution(store, course.id, aid, confirmed=True)
    _wait(store, course.id, aid, run["run_id"])
    import_files(store, course.id, [("lab.ipynb", _notebook(["print('new')"]))])
    stale = execution_status(store, course.id, aid, run["run_id"])
    assert stale["stale"] is True
    with pytest.raises(RuntimeError, match="source changed"):
        resume_execution(store, course.id, aid, run["run_id"], confirmed=True)
