"""Confirmed, course-isolated notebook execution with durable checkpoints."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
import platform
import re
import resource
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from app.course import atomic_write_json

POLICY_VERSION = 1
DEFAULT_CELL_TIMEOUT = 30
MAX_CELL_TIMEOUT = 120
OUTPUT_CHAR_LIMIT = 100_000
MAX_MEMORY_BYTES = 4 * 1024 * 1024 * 1024
MAX_FILE_BYTES = 32 * 1024 * 1024

_processes: dict[tuple[str, str], subprocess.Popen] = {}
_process_lock = threading.Lock()


def environment_info() -> dict[str, Any]:
    packages = {}
    for name in ("numpy", "pandas", "matplotlib", "scikit-learn", "scipy", "dill"):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = "not installed"
    sandbox = "/usr/bin/sandbox-exec" if Path("/usr/bin/sandbox-exec").is_file() else "unavailable"
    return {
        "python": platform.python_version(), "implementation": platform.python_implementation(),
        "platform": platform.platform(), "packages": packages,
        "sandbox_backend": sandbox, "network": "denied by operating-system sandbox",
        "filesystem": "read current course workspace, write this execution workspace only",
        "cell_timeout_seconds": DEFAULT_CELL_TIMEOUT,
        "maximum_cell_timeout_seconds": MAX_CELL_TIMEOUT,
        "output_char_limit_per_stream": OUTPUT_CHAR_LIMIT,
        "memory_limit_bytes": MAX_MEMORY_BYTES,
        "file_limit_bytes": MAX_FILE_BYTES,
        "process_limit": "child process creation denied by operating-system sandbox",
        "remote_model_used": False,
    }


def _current_notebook(store, course_id: str, artifact_id: str):
    artifact = next((item for item in store.load_artifacts(course_id) if item.id == artifact_id), None)
    if artifact is None or artifact.kind != "ipynb" or artifact.extraction_status != "done":
        raise KeyError("No current executable notebook artifact was found in this course.")
    cells = [
        obj for obj in store.load_learning_objects(course_id, artifact_id)
        if obj.object_type == "notebook_cell" and obj.data.get("cell_type") == "code"
    ]
    return artifact, sorted(cells, key=lambda obj: int(obj.locator.notebook_cell or 0))


def _run_id(artifact, cell_indices: list[int], timeout: int) -> str:
    raw = json.dumps(
        [POLICY_VERSION, artifact.id, artifact.content_hash, artifact.version, cell_indices, timeout],
        separators=(",", ":"),
    ).encode("utf-8")
    return "run-" + hashlib.sha256(raw).hexdigest()[:20]


def _safe_workspace_path(workspace: Path, source_path: str) -> Path:
    destination = (workspace / source_path).resolve()
    if workspace.resolve() not in destination.parents:
        raise ValueError("An artifact path escaped the execution workspace.")
    return destination


def _prepare_workspace(store, course_id: str, notebook, run_dir: Path) -> tuple[Path, Path, list[dict]]:
    workspace = run_dir / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    linked: list[dict] = []
    for artifact in store.load_artifacts(course_id):
        source = (store.course_dir(course_id) / artifact.stored_path).resolve()
        if store.course_dir(course_id) not in source.parents or not source.is_file():
            continue
        destination = _safe_workspace_path(workspace, artifact.source_path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.is_file() or hashlib.sha256(destination.read_bytes()).hexdigest() != artifact.content_hash:
            shutil.copy2(source, destination)
        linked.append({
            "artifact_id": artifact.id, "source_path": artifact.source_path,
            "kind": artifact.kind, "content_hash": artifact.content_hash,
            "workspace_path": destination.relative_to(workspace).as_posix(),
        })
    notebook_path = _safe_workspace_path(workspace, notebook.source_path)
    return workspace, notebook_path.parent, linked


def _sandbox_quote(path: Path) -> str:
    return str(path.absolute()).replace("\\", "\\\\").replace('"', '\\"')


def _sandbox_profile(workspace: Path, run_dir: Path) -> str:
    venv = Path(sys.executable).absolute().parents[1]
    interpreter = Path(sys.executable).resolve().parents[1]
    readable = [Path("/System"), Path("/usr"), Path("/bin"), Path("/sbin"), Path("/Library"), Path("/opt/homebrew"), Path("/dev"), venv, interpreter, run_dir]
    rules = " ".join(f'(subpath "{_sandbox_quote(path)}")' for path in readable if path.exists())
    executables = " ".join((
        f'(literal "{_sandbox_quote(Path(sys.executable))}")',
        f'(literal "{_sandbox_quote(Path(sys.executable).resolve())}")',
    ))
    return (
        "(version 1)\n"
        "(deny default)\n"
        "(import \"system.sb\")\n"
        f"(allow process-exec {executables})\n"
        "(allow file-read-metadata)\n"
        f"(allow file-read* {rules})\n"
        f"(allow file-write* (subpath \"{_sandbox_quote(workspace)}\") "
        f"(literal \"{_sandbox_quote(run_dir / 'outputs')}\") "
        f"(subpath \"{_sandbox_quote(run_dir / 'outputs')}\") "
        f"(literal \"{_sandbox_quote(run_dir / 'status.json')}\") "
        f"(literal \"{_sandbox_quote(run_dir / 'status.json.tmp')}\") "
        f"(literal \"{_sandbox_quote(run_dir / 'session.pkl')}\") "
        f"(literal \"{_sandbox_quote(run_dir / 'session.pkl.tmp')}\") "
        "(literal \"/dev/null\"))\n"
        "(deny network*)\n"
    )


def _limits(timeout: int, cell_count: int):
    def apply() -> None:
        resource.setrlimit(resource.RLIMIT_CPU, (max(2, timeout * cell_count + 5), max(2, timeout * cell_count + 5)))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        try:
            resource.setrlimit(resource.RLIMIT_DATA, (MAX_MEMORY_BYTES, MAX_MEMORY_BYTES))
        except (ValueError, OSError):
            pass

    return apply


def _status_path(run_dir: Path) -> Path:
    return run_dir / "status.json"


def _load_status(run_dir: Path) -> dict[str, Any]:
    path = _status_path(run_dir)
    if not path.is_file():
        raise KeyError("No notebook execution with that id exists.")
    return json.loads(path.read_text("utf-8"))


def _pid_alive(pid: int) -> bool:
    if pid <= 1:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _spawn(run_dir: Path, timeout: int, cell_count: int) -> dict[str, Any]:
    from app import execution_runner

    job_path = run_dir / "job.json"
    job = json.loads(job_path.read_text("utf-8"))
    workspace = Path(job["workspace"])
    profile = _sandbox_profile(workspace, run_dir)
    environment = {
        "PATH": "/usr/bin:/bin:/opt/homebrew/bin",
        "HOME": str(workspace), "TMPDIR": str(workspace / ".tmp"),
        "MPLCONFIGDIR": str(workspace / ".matplotlib"), "MPLBACKEND": "Agg",
        "PYTHONHASHSEED": "0", "PYTHONDONTWRITEBYTECODE": "1",
        "LC_EXECUTION_NETWORK": "denied",
    }
    Path(environment["TMPDIR"]).mkdir(parents=True, exist_ok=True)
    Path(environment["MPLCONFIGDIR"]).mkdir(parents=True, exist_ok=True)
    command = [
        "/usr/bin/sandbox-exec", "-p", profile, sys.executable, "-I", "-c",
        Path(execution_runner.__file__).read_text("utf-8"), str(job_path),
    ]
    launcher_log = (run_dir / "launcher.txt").open("ab")
    process = subprocess.Popen(
        command, cwd=job["working_directory"], env=environment,
        stdin=subprocess.DEVNULL, stdout=launcher_log, stderr=subprocess.STDOUT,
        start_new_session=True, preexec_fn=_limits(timeout, cell_count),
    )
    status = _load_status(run_dir)
    status.update({"state": "running", "worker_pid": process.pid, "updated_at": time.time()})
    atomic_write_json(_status_path(run_dir), status)
    key = (status["course_id"], status["run_id"])
    with _process_lock:
        _processes[key] = process

    def wait_for_exit() -> None:
        process.wait()
        launcher_log.close()
        with _process_lock:
            _processes.pop(key, None)
        try:
            current = _load_status(run_dir)
            if current.get("state") == "running":
                current.update({
                    "state": "paused", "worker_pid": None,
                    "pause_reason": f"The isolated runtime exited with code {process.returncode}. Resume from the last saved cell state.",
                    "updated_at": time.time(),
                })
                atomic_write_json(_status_path(run_dir), current)
        except (OSError, ValueError, KeyError):
            pass

    threading.Thread(target=wait_for_exit, daemon=True).start()
    return status


def start_execution(
    store, course_id: str, artifact_id: str, *, confirmed: bool,
    cell_indices: list[int] | None = None, cell_timeout_seconds: int = DEFAULT_CELL_TIMEOUT,
) -> dict[str, Any]:
    if not confirmed:
        raise PermissionError("Confirm the disclosed local runtime and sandbox limits before execution.")
    if not Path("/usr/bin/sandbox-exec").is_file():
        raise RuntimeError("Controlled execution is unavailable because the OS sandbox is missing.")
    artifact, code_cells = _current_notebook(store, course_id, artifact_id)
    available = {int(obj.locator.notebook_cell or 0): obj for obj in code_cells}
    selected = sorted(set(cell_indices if cell_indices is not None else available))
    if not selected or any(index not in available for index in selected):
        raise ValueError("Choose one or more executable notebook cell indices.")
    timeout = max(1, min(int(cell_timeout_seconds), MAX_CELL_TIMEOUT))
    run_id = _run_id(artifact, selected, timeout)
    run_dir = store.execution_run_dir(course_id, artifact_id, run_id)
    if _status_path(run_dir).is_file():
        return execution_status(store, course_id, artifact_id, run_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    workspace, working_directory, linked = _prepare_workspace(store, course_id, artifact, run_dir)
    status = {
        "run_id": run_id, "course_id": course_id, "artifact_id": artifact_id,
        "source_version": artifact.id, "source_hash": artifact.content_hash,
        "artifact_version": artifact.version, "state": "queued", "pause_reason": "",
        "selected_cells": selected, "completed_cells": [], "current_cell": None,
        "results": [], "worker_pid": None, "confirmed_at": time.time(),
        "created_at": time.time(), "updated_at": time.time(),
        "environment": {
            **environment_info(),
            "cell_timeout_seconds": timeout,
        },
        "linked_files": linked,
        "disclosure": "Runs locally without DeepSeek. Network is denied. Code reads course-workspace copies and writes only this execution workspace.",
        "stale": False,
    }
    atomic_write_json(_status_path(run_dir), status)
    cells = [
        {
            "index": index, "object_id": available[index].id,
            "locator": available[index].locator.to_dict(), "source": available[index].text,
        }
        for index in selected
    ]
    job = {
        "workspace": str(workspace), "working_directory": str(working_directory),
        "status_path": str(_status_path(run_dir)),
        "checkpoint_path": str(run_dir / "session.pkl"),
        "output_dir": str(run_dir / "outputs"), "cells": cells,
        "cell_timeout_seconds": timeout, "output_char_limit": OUTPUT_CHAR_LIMIT,
    }
    atomic_write_json(run_dir / "job.json", job)
    return _spawn(run_dir, timeout, len(cells))


def execution_status(store, course_id: str, artifact_id: str, run_id: str) -> dict[str, Any]:
    run_dir = store.execution_run_dir(course_id, artifact_id, run_id)
    status = _load_status(run_dir)
    artifact = next((item for item in store.load_artifacts(course_id) if item.id == artifact_id), None)
    stale = artifact is None or artifact.content_hash != status.get("source_hash") or artifact.version != status.get("artifact_version")
    status["stale"] = stale
    if status.get("state") == "running":
        pid = int(status.get("worker_pid") or 0)
        key = (course_id, run_id)
        with _process_lock:
            process = _processes.get(key)
        if process is not None and process.poll() is not None:
            status["state"] = "paused"
        elif process is None and not _pid_alive(pid):
            status.update({
                "state": "paused", "worker_pid": None,
                "pause_reason": "The runtime was interrupted. Resume from the last saved cell state.",
                "updated_at": time.time(),
            })
            atomic_write_json(_status_path(run_dir), status)
    return status


def stop_execution(store, course_id: str, artifact_id: str, run_id: str) -> dict[str, Any]:
    status = execution_status(store, course_id, artifact_id, run_id)
    if status.get("state") != "running":
        return status
    pid = int(status.get("worker_pid") or 0)
    try:
        os.killpg(pid, signal.SIGTERM)
    except OSError:
        pass
    status.update({
        "state": "paused", "worker_pid": None,
        "pause_reason": "Stopped by the student. Resume from the last saved cell state.",
        "updated_at": time.time(),
    })
    atomic_write_json(_status_path(store.execution_run_dir(course_id, artifact_id, run_id)), status)
    return status


def resume_execution(store, course_id: str, artifact_id: str, run_id: str, *, confirmed: bool) -> dict[str, Any]:
    if not confirmed:
        raise PermissionError("Confirm the disclosed local runtime before resuming execution.")
    status = execution_status(store, course_id, artifact_id, run_id)
    if status["stale"]:
        raise RuntimeError("The notebook source changed. Start a new execution from the current version.")
    if status["state"] == "done":
        return status
    if status["state"] == "running":
        return status
    run_dir = store.execution_run_dir(course_id, artifact_id, run_id)
    job = json.loads((run_dir / "job.json").read_text("utf-8"))
    remaining = len(status["selected_cells"]) - len(status["completed_cells"])
    return _spawn(run_dir, int(job["cell_timeout_seconds"]), max(1, remaining))


def list_executions(store, course_id: str, artifact_id: str) -> list[dict[str, Any]]:
    parent = store.executions_dir(course_id) / artifact_id
    if not parent.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for run_dir in parent.iterdir():
        if not run_dir.is_dir() or not (run_dir / "status.json").is_file():
            continue
        try:
            rows.append(execution_status(store, course_id, artifact_id, run_dir.name))
        except (KeyError, OSError, ValueError):
            continue
    return sorted(rows, key=lambda row: float(row.get("created_at", 0)), reverse=True)


def output_path(store, course_id: str, artifact_id: str, run_id: str, filename: str) -> Path:
    if not re.fullmatch(r"cell-\d{4}-plot-\d+\.png", filename):
        raise KeyError("No such execution output.")
    run_dir = store.execution_run_dir(course_id, artifact_id, run_id)
    status = _load_status(run_dir)
    allowed = {name for result in status.get("results", []) for name in result.get("plots", [])}
    path = (run_dir / "outputs" / filename).resolve()
    if filename not in allowed or run_dir.resolve() not in path.parents or not path.is_file():
        raise KeyError("No such execution output.")
    return path


__all__ = [
    "environment_info", "start_execution", "execution_status", "stop_execution",
    "resume_execution", "list_executions", "output_path",
]
