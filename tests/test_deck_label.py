"""`deckLabel`, the pure function behind every deck row on the course screen.

`bar.md` C2 requires a deck row to show a display name that is not a raw source
filename:

    the visible name equals `deckLabel(deck.title)`, where `deckLabel` is the
    pure function in `web/src/lib/deckLabel.ts` and is unit-tested in `tests/`
    against raw filenames (`Lec01_Data_and_Vibe_Coding_FINAL.pptx` ->
    `Lec01 Data and Vibe Coding`, `lecture 3 - regression.pptx` ->
    `Lecture 3 Regression`, extension stripped, `_` and `-` runs collapsed to
    single spaces, whitespace collapsed, every all-caps word title-cased).

HOW THIS RUNS THE TYPESCRIPT. There is no node bridge in this suite and no
`ts-node` in the project, so this is a SOURCE-LEVEL assertion plus a node-driven
check, which is the fallback the brief allows. The node half reads the file as
text, strips `import type`, type and interface declarations, `export` keywords
and the primitive annotations a pure function needs none of, and evaluates what
is left with `new Function`. If what is left does not parse, node says so and
the test fails with node's own message rather than with a verdict this file
invented. It is not a TypeScript compiler and it does not pretend to be one: it
runs the function's body, which is all a pure string function needs.

WHAT FAILS, AND WHY THAT IS CORRECT. These tests fail until
`web/src/lib/deckLabel.ts` exists and behaves as the bar says. That is the point
of writing them before the function: the bar names the exact outputs, including
`Lec01 Data and Vibe Coding` for a filename ending in `FINAL`, which the four
rules listed beside it do not by themselves produce.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DECK_LABEL_TS = ROOT / "web" / "src" / "lib" / "deckLabel.ts"

#: Reads the TypeScript as text and runs `deckLabel` out of it.
NODE_HARNESS = r"""
const fs = require("fs");
const file = process.argv[1];
const cases = JSON.parse(process.argv[2]);
let src = fs.readFileSync(file, "utf8");
const kept = [];
let skipping = false;
for (const line of src.split("\n")) {
  if (!skipping && /^\s*import\s+type\s/.test(line)) continue;
  if (!skipping && /^\s*(export\s+)?(type|interface)\s+\w/.test(line)) {
    skipping = !/;\s*$/.test(line);
    continue;
  }
  if (skipping) { if (/^[}];?\s*$/.test(line)) skipping = false; continue; }
  kept.push(line);
}
src = kept.join("\n");
src = src.replace(/\bexport\s+(?=(?:async\s+)?function|const|let|var|class)/g, "");
src = src.replace(/:\s*(string|number|boolean|void|any|unknown)\b(\s*\[\])?/g, "");
let fn = null;
try { fn = new Function(src + "\nreturn typeof deckLabel === 'function' ? deckLabel : null;")(); }
catch (err) { console.log(JSON.stringify({__error: "does not evaluate: " + err.message})); process.exit(0); }
if (!fn) { console.log(JSON.stringify({__error: "no deckLabel function after stripping types"})); process.exit(0); }
const out = {};
for (const c of cases) { try { out[c] = fn(c); } catch (e) { out[c] = "__threw: " + e.message; } }
console.log(JSON.stringify(out));
"""

#: `bar.md` C2's two examples, verbatim. The first one is the one the rule list
#: beside it does not produce on its own: title-casing `FINAL` gives `Final`,
#: and the bar's output has no such word, so a trailing all-caps noise marker is
#: dropped. Asserted because the bar states it, not because it was inferred.
BAR_EXAMPLES = [
    ("Lec01_Data_and_Vibe_Coding_FINAL.pptx", "Lec01 Data and Vibe Coding"),
    ("lecture 3 - regression.pptx", "Lecture 3 Regression"),
]

#: One case per rule the bar names, so a failure points at the rule and not at
#: the example.
RULES = [
    ("the extension is stripped", "Lecture_4.pptx", "Lecture 4"),
    ("a `-` run collapses to one space", "Lecture---4.pptx", "Lecture 4"),
    ("a `_` run collapses to one space", "Lecture___4.pptx", "Lecture 4"),
    ("whitespace is collapsed", "Lecture    4.pptx", "Lecture 4"),
    ("an all-caps word is title-cased", "ADVANCED_TOPICS.pptx", "Advanced Topics"),
    ("an all-caps first word is title-cased", "INTRO.pptx", "Intro"),
    ("a non-caps word keeps its own case", "Lecture 4.pptx", "Lecture 4"),
    ("the first word is capitalised", "regression.pptx", "Regression"),
    ("a .pdf source is treated the same", "Lec02---Regression.pdf", "Lec02 Regression"),
]

_ALL = [c for c, _ in BAR_EXAMPLES] + [c for _, c, _ in RULES]


def _node() -> str:
    node = shutil.which("node")
    if node is None:
        pytest.fail("node is not on PATH, so deckLabel.ts cannot be run at all")
    return node


@pytest.fixture(scope="module")
def labels() -> dict[str, str]:
    if not DECK_LABEL_TS.is_file():
        pytest.fail(
            f"{DECK_LABEL_TS.relative_to(ROOT)} does not exist. bar.md C2 requires "
            f"`export function deckLabel(title: string): string` there, and every deck "
            f"row on the course screen has to show its result"
        )
    proc = subprocess.run(
        [_node(), "-e", NODE_HARNESS, str(DECK_LABEL_TS), json.dumps(_ALL)],
        capture_output=True, text=True, cwd=str(ROOT), timeout=60,
    )
    if proc.returncode != 0:
        pytest.fail(f"node exited {proc.returncode} running deckLabel.ts: "
                    f"{proc.stderr.strip()[:400]}")
    try:
        got = json.loads(proc.stdout)
    except json.JSONDecodeError:
        pytest.fail(f"the node harness printed something that is not JSON: "
                    f"{proc.stdout[:200]!r}")
    if "__error" in got:
        pytest.fail(f"deckLabel.ts could not be run: {got['__error']}")
    for case, out in got.items():
        if isinstance(out, str) and out.startswith("__threw"):
            pytest.fail(f"deckLabel({case!r}) threw: {out}")
        if not isinstance(out, str):
            pytest.fail(f"deckLabel({case!r}) returned {out!r}, not a string")
    return got


def test_file_declares_the_frozen_signature() -> None:
    """The name and the signature are the interface other files import."""
    if not DECK_LABEL_TS.is_file():
        pytest.fail(f"{DECK_LABEL_TS.relative_to(ROOT)} does not exist")
    src = DECK_LABEL_TS.read_text()
    assert re.search(
        r"export\s+function\s+deckLabel\s*\(\s*title\s*:\s*string\s*\)\s*:\s*string",
        src,
    ), "deckLabel.ts must export `function deckLabel(title: string): string`"


@pytest.mark.parametrize("raw,want", BAR_EXAMPLES, ids=[c for c, _ in BAR_EXAMPLES])
def test_bar_examples_verbatim(labels: dict[str, str], raw: str, want: str) -> None:
    """The two examples bar.md C2 states word for word."""
    assert labels[raw] == want


@pytest.mark.parametrize(
    "raw,want", [(r, w) for _, r, w in RULES],
    ids=[f"{rule} -> {w}" for rule, _, w in RULES],
)
def test_each_named_rule(labels: dict[str, str], raw: str, want: str) -> None:
    """One case per rule the bar names, so a failure names the rule."""
    assert labels[raw] == want


def test_no_raw_filename_survives(labels: dict[str, str]) -> None:
    """A label never carries the separators or the extension it was given."""
    bad = {
        raw: out for raw, out in labels.items()
        if "_" in out or "--" in out or "  " in out
        or out.lower().endswith((".pptx", ".pdf", ".ppt", ".key"))
    }
    assert not bad, f"these labels still look like source filenames: {bad}"


def test_label_is_idempotent(labels: dict[str, str]) -> None:
    """Running the label back through the function changes nothing.

    A course screen that shows `deckLabel(deck.title)` and a sidebar that shows
    the stored title sit next to each other, so a label that is not a fixed
    point of its own function reads as two different decks.
    """
    from_all = list(labels.values())
    proc = subprocess.run(
        [_node(), "-e", NODE_HARNESS, str(DECK_LABEL_TS), json.dumps(from_all)],
        capture_output=True, text=True, cwd=str(ROOT), timeout=60,
    )
    if proc.returncode != 0:
        pytest.fail(f"node exited {proc.returncode}: {proc.stderr.strip()[:400]}")
    again = json.loads(proc.stdout)
    for once, twice in zip(from_all, (again[c] for c in from_all)):
        assert once == twice, f"deckLabel({once!r}) is {twice!r}, not a fixed point"
