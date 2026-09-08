# STATE: Lecture Companion capability gauntlet

Overwritten each round. History lives in `RUNLOG.md`.

## Goal and invariants

Build a robust companion across the five real courses so a student can import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

Frozen inputs verified at Capability Round 1:

- `.internal/course-material-capability-assessment.md`: `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`
- `SPEC.md`: `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875`

## Objectives and metrics

| Area | Current measured evidence | Status |
|---|---|---|
| Six-format import | 29 of 29 real files, exact distribution, zero failures | done |
| Typed evidence | 32,757 objects with page, slide, note, block, sheet, cell, range, chart, notebook, output, and field locators | done foundation |
| Original preservation | SHA-256 round trip checked for every real artifact | done |
| Hierarchy and deduplication | Relative paths retained, repeated bytes keep occurrences and share one stored original | done |
| Incremental and failed imports | Unchanged imports no-op, changed paths version, failed artifacts quarantine and retry | done |
| Extraction fidelity | Per-format source-versus-object counts and workbook feature inventory pass | done for measured structures |
| Legacy slide system | 143 tests and eight-screen G2 pass | done, no regression measured |
| Native mixed viewers | Slide viewer only | fail |
| Selected-context questions | Not implemented | fail |
| Cross-artifact search and graph | Not implemented | fail |
| Subject-aware workflows | Benchmark exists, product workflows not implemented | fail |

## Decisions

- The orchestrator extended `app/contracts.py` with `Artifact`, `LearningObject`, and `SourceLocator`. The slide types remain backward compatible. This was necessary because the frozen slide-only contract cannot represent the frozen six-format capability bar.
- Artifact identity separates a byte content hash from a path occurrence id. This deduplicates storage while retaining intentional week-level references.
- Parser degradation is never hidden. Warnings lower extraction quality and unsupported workbook package parts are retained with byte hashes for exact recovery.
- Rich notebook output data stays local in typed objects. CSV ingestion profiles complete local data without sending entire datasets to a model.
- True permission-enforced holdout separation is unavailable because all agents share the filesystem. Every round must continue to report that protocol gate as failed.

## Work queue

1. Build native read-only viewers for DOCX, XLSX, CSV, and IPYNB plus exact deep links and selected-context questions at 1280x720 and 1440x900.
2. Index typed objects and add course-scoped search, evidence citations, version staleness, and a cross-artifact concept graph.
3. Extend resumable model processing and schema validation to every artifact type with interruption and duplicate-billing tests.
4. Add safe notebook execution, workbook inspection, and deterministic calculation verification.
5. Implement the five subject-aware workflows and golden tasks.
6. Run the two-pass live DeepSeek sample within the remaining $5 cap, then clean-checkout, security, accessibility, and smoke gates.

## Rejected attempts and do-not-repeat notes

- Treating any non-empty learning-object set as proof of extraction fidelity was rejected. Compare source structure against extracted structure by format.
- Letting parser warnings print while reporting perfect extraction was rejected. Capture them, lower quality, and preserve unsupported package parts.
- `uv sync --extra dev` was rejected for environment setup because `dev` is declared as an optional dependency. Use `uv pip install --python .venv/bin/python -e '.[dev]'` as `run.sh` does.
- Diagnostic snippets must use the function-based `process_course` API. There is no `Pipeline` class.
- Ports 8799 and 8801 were already occupied during this round. Use a verified free port.

## CURRENT STATE

Capability Round 1 is complete. The independent critic passed the six-format fidelity increment and returned full-bar FAIL. Its single largest remaining product gap is the native six-format viewer and selected-context question workflow. Holdout source was independently authored, but isolation was procedural rather than permission-enforced.

Measured rerunnable commands:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/verify_real_corpus.py
LC_COURSES_ROOT=.internal/g2-round1-run LC_FAKE_MODEL=1 LC_PORT=45678 ./run.sh
.venv/bin/python scripts/gate_g2.py --base http://127.0.0.1:45678 --course round-1-g2 --deck deck-8b13a0e40cdc --last 5 --shots .internal/round1-shots
```

No paid model call was made in this round.
