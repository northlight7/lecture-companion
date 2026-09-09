"""Child-process runner for confirmed notebook code.

The parent passes this file's source to an isolated Python interpreter. The
runner has no application imports and writes only to its execution workspace.
"""

from __future__ import annotations

import ast
import contextlib
import io
import json
import os
import signal
import sys
import time
import traceback
import warnings
from pathlib import Path

import dill


class CellTimeout(Exception):
    pass


class CappedText(io.TextIOBase):
    def __init__(self, limit: int):
        self.limit = limit
        self.parts: list[str] = []
        self.size = 0
        self.truncated = False

    def write(self, value) -> int:
        text = str(value)
        remaining = max(0, self.limit - self.size)
        if remaining:
            self.parts.append(text[:remaining])
            self.size += min(len(text), remaining)
        if len(text) > remaining:
            self.truncated = True
        return len(text)

    def getvalue(self) -> str:
        text = "".join(self.parts)
        return text + ("\n[output truncated by policy]" if self.truncated else "")


def atomic_json(path: Path, value) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", "utf-8")
    os.replace(temporary, path)


def alarm_handler(_signum, _frame):
    raise CellTimeout("cell exceeded its execution time limit")


def clean_code(source: str) -> str:
    lines: list[str] = []
    for line in source.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("%matplotlib"):
            continue
        if stripped.startswith(("%", "!")):
            raise RuntimeError("shell and notebook magic commands are disabled in the controlled runtime")
        lines.append(line)
    return "\n".join(lines)


def execute_with_value(source: str, filename: str, namespace: dict):
    tree = ast.parse(source, filename=filename, mode="exec")
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        prefix = ast.Module(body=tree.body[:-1], type_ignores=[])
        if prefix.body:
            exec(compile(prefix, filename, "exec"), namespace, namespace)
        expression = ast.Expression(tree.body[-1].value)
        return eval(compile(expression, filename, "eval"), namespace, namespace)
    exec(compile(tree, filename, "exec"), namespace, namespace)
    return None


def value_payload(value):
    if value is None:
        return None
    if hasattr(value, "columns") and hasattr(value, "head"):
        try:
            preview = value.head(50)
            rows = preview.astype(object).where(preview.notna(), None).values.tolist()
            return {
                "kind": "table", "columns": [str(column) for column in preview.columns],
                "rows": rows, "shape": [int(x) for x in value.shape],
                "truncated": int(value.shape[0]) > len(rows),
            }
        except Exception:
            pass
    text = repr(value)
    return {"kind": "text", "text": text[:12000], "truncated": len(text) > 12000}


def capture_plots(output_dir: Path, cell_index: int) -> list[str]:
    if "matplotlib.pyplot" not in sys.modules:
        return []
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return []
    plots: list[str] = []
    for number in plt.get_fignums()[:8]:
        figure = plt.figure(number)
        name = f"cell-{cell_index + 1:04d}-plot-{number}.png"
        figure.savefig(output_dir / name, format="png", dpi=120, bbox_inches="tight")
        plots.append(name)
    plt.close("all")
    return plots


def error_diagnostic(exc: BaseException) -> str:
    """Explain only what the observed local exception supports."""
    if isinstance(exc, CellTimeout):
        return "This cell exceeded the disclosed local time limit. Split the work or reduce its input before retrying."
    if isinstance(exc, FileNotFoundError):
        return "A requested path was not found in the current-course workspace. Check the notebook's relative path against the linked course files."
    if isinstance(exc, ModuleNotFoundError):
        return "This module is not installed in the disclosed local runtime. The package list above is the environment actually used."
    if isinstance(exc, NameError):
        return "This name is absent from the saved runtime state. Run the defining predecessor cell or correct the name."
    if isinstance(exc, PermissionError) or (isinstance(exc, OSError) and getattr(exc, "errno", None) in {1, 13}):
        return "The operating-system sandbox denied this operation. Network, child processes, and paths outside the execution workspace are blocked."
    return "The current local runtime raised this error. Use the captured exception and traceback below as evidence before changing the cell."


def main(job_path: str) -> int:
    job_file = Path(job_path).resolve()
    job = json.loads(job_file.read_text("utf-8"))
    status_path = Path(job["status_path"]).resolve()
    checkpoint_path = Path(job["checkpoint_path"]).resolve()
    output_dir = Path(job["output_dir"]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    status = json.loads(status_path.read_text("utf-8"))
    completed = set(int(value) for value in status.get("completed_cells", []))
    namespace = {"__name__": "__main__", "__builtins__": __builtins__}
    if completed and checkpoint_path.is_file():
        with checkpoint_path.open("rb") as handle:
            namespace = dill.load(handle)
    status.update({"state": "running", "pause_reason": "", "worker_pid": os.getpid()})
    atomic_json(status_path, status)
    signal.signal(signal.SIGALRM, alarm_handler)

    for cell in job["cells"]:
        index = int(cell["index"])
        if index in completed:
            continue
        status["current_cell"] = index
        atomic_json(status_path, status)
        stdout = CappedText(int(job["output_char_limit"]))
        stderr = CappedText(int(job["output_char_limit"]))
        started = time.monotonic()
        result = {
            "cell_index": index, "object_id": cell["object_id"],
            "locator": cell["locator"], "provenance": "computed locally from this source cell",
            "stdout": "", "stderr": "", "warnings": [], "value": None, "plots": [],
        }
        try:
            code = clean_code(cell["source"])
            with warnings.catch_warnings(record=True) as caught, contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                warnings.simplefilter("always")
                signal.alarm(int(job["cell_timeout_seconds"]))
                value = execute_with_value(code, f"notebook-cell-{index + 1}", namespace)
                signal.alarm(0)
            result["warnings"] = [
                {
                    "category": item.category.__name__, "message": str(item.message)[:2000],
                    "diagnostic": "The current local runtime emitted this warning. Check the named condition before relying on the computed result.",
                }
                for item in caught[:50]
            ]
            result["value"] = value_payload(value)
            result["plots"] = capture_plots(output_dir, index)
            checkpoint_temporary = checkpoint_path.with_name(checkpoint_path.name + ".tmp")
            with checkpoint_temporary.open("wb") as handle:
                dill.dump(namespace, handle)
            os.replace(checkpoint_temporary, checkpoint_path)
            completed.add(index)
            result["state"] = "done"
        except BaseException as exc:
            signal.alarm(0)
            result["state"] = "error"
            result["error_type"] = type(exc).__name__
            result["error"] = str(exc)[:4000]
            result["diagnostic"] = error_diagnostic(exc)
            result["traceback"] = traceback.format_exc(limit=12).replace(str(Path.cwd()), "<course-workspace>")[:16000]
        result["stdout"] = stdout.getvalue()
        result["stderr"] = stderr.getvalue()
        result["duration_seconds"] = round(time.monotonic() - started, 4)
        status.setdefault("results", []).append(result)
        status["completed_cells"] = sorted(completed)
        status["updated_at"] = time.time()
        if result["state"] == "error":
            status["state"] = "error"
            status["pause_reason"] = "A cell failed. Inspect the local trace before changing or rerunning code."
            atomic_json(status_path, status)
            return 1
        atomic_json(status_path, status)

    status.update({
        "state": "done", "current_cell": None, "worker_pid": None,
        "pause_reason": "", "updated_at": time.time(),
    })
    atomic_json(status_path, status)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
