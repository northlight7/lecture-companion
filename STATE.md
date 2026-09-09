# STATE: Lecture Companion capability gauntlet

Overwritten each round. History lives in `RUNLOG.md`.

## Goal and invariants

Build a robust companion across the five real courses so a student can import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

Frozen inputs verified at Capability Round 4:

- `.internal/course-material-capability-assessment.md`: `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`
- `SPEC.md`: `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875`

## Objectives and metrics

| Area | Current measured evidence | Status |
|---|---|---|
| Six-format import and viewers | 29 files, 32,757 objects, six viewers at two target sizes | done |
| Exact source links and selected questions | Typed links, structured evidence, citations, disclosure, and isolation pass | done foundation |
| Five-course local search | Every course returns exact course-local results | done foundation |
| Semantic adjacency | Inspectable aliases connect shrinkage to regularization and exact evidence | done local foundation |
| Cross-artifact relationships | BDA regression search reaches PDF, IPYNB, and linked CSV | done foundation |
| Concept graph | Measured concept-to-file edges, filename references, labeled prerequisite candidates | done foundation |
| Index freshness | Source replacement marks stale, rebuild removes obsolete evidence | done |
| Search performance | Five-course first search at most 1.831 s, warm search at most 0.136 s in gate | done for corpus |
| Controlled notebook execution | Real notebook and relative CSV, selected and all cells, six output classes | done foundation |
| Execution isolation and resume | OS denial of network, child processes, foreign reads, and outside writes; counter stays 1 after resume | done |
| Notebook UI | Source and computed result at both target sizes, no console error or overflow | done |
| Offline regression | 159 tests pass | done for current scope |
| Resumable mixed-artifact model work | Slides and notebooks only | fail |
| Spreadsheet and subject-aware workflows | Benchmark exists, product workflows not implemented | fail |

## Decisions

- Typed search uses one SQLite FTS5 database inside each course directory. No global course-content index exists.
- The knowledge fingerprint covers current artifact ids, byte hashes, versions, extraction state, and object counts. A schema version invalidates older derived indexes.
- Search is local lexical retrieval with explicit aliases. The UI names the method and never presents it as opaque semantic inference.
- Search diversity caps early results from one artifact. Explicit notebook filename references can add the linked dataset root as a result.
- Concept graph evidence is sampled across artifacts, not filled by the first file alone.
- Concept edges state why artifacts are relevant and carry exact source object ids. Prerequisite relationships are labeled modeled candidates and include an uncertainty warning.
- Notebook code runs only after explicit confirmation in a fixed, disclosed local scientific Python environment. DeepSeek is not called.
- Each execution uses copies of current-course files, a deterministic course-scoped run id, per-cell checkpoints, and exact source-cell provenance. Saved notebook output and newly computed output remain distinct.
- The macOS sandbox denies network, child processes, foreign-course paths, and writes outside the run workspace. Time, output, file, descriptor, and data-segment limits are disclosed.
- Runtime diagnostics describe only observed warnings, exceptions, and traces. They do not guess at unobserved causes.
- True permission-enforced holdout separation is unavailable because all agents share the filesystem. Every round continues to report that protocol gate as failed.

## Work queue

1. Add deterministic workbook inspection, formula and chart diagnosis, and unit-aware calculation verification.
2. Extend artifact-specific grounded explanations and schema validation to non-slide objects with adaptive DeepSeek budgets and duplicate-billing tests.
3. Implement ER diagram validation, balanced ethics scaffolding, finance leakage checks, and practice workflows.
4. Run the two-pass live DeepSeek sample within the remaining $5 cap, then clean-checkout, security, accessibility, and smoke gates.

## Rejected attempts and do-not-repeat notes

- Calling the local hashing index a semantic model was rejected. Use explicit aliases and expose the retrieval method.
- Filling concept evidence with the first matching artifact was rejected. Cap evidence per artifact so cross-file coverage remains visible.
- Returning a related dataset filename alone was rejected. Relationship results show structured dataset facts and exact locators.
- Treating inferred prerequisites as facts was rejected. Keep candidate certainty and the visible warning.
- Searching superseded object files was rejected. Filter every build and query through the current artifact manifest.
- A persistent derived index without an algorithm schema version was rejected. Bump the schema whenever index semantics change.
- Launching the virtual-environment interpreter under a hand-written default-deny profile was rejected because macOS aborted before Python startup. Import `system.sb`, then grant only the current interpreter, runtime reads, course-workspace reads, exact runner state files, and workspace writes.
- `RLIMIT_NPROC=32` was rejected because it counts the user's existing processes and prevented a reliable launch. Deny child creation in the OS sandbox instead and prove it with a live subprocess probe.
- `RLIMIT_AS` was rejected on macOS because it aborted the scientific runtime. Use a disclosed data-segment limit and avoid claiming a total-memory cap.
- A full-width execution panel above the notebook source was rejected because it hid source evidence below the fold. Keep local computation beside the source in the artifact viewer.
- True blind holdout isolation cannot be claimed in this shared filesystem.

## CURRENT STATE

Capability Round 4 is complete. The full frozen product bar remains FAIL. A fresh independent critic passed the controlled notebook-execution increment. The critic identified the missing cross-format teaching workflows as the strongest product failure. The pre-commit dirty-tree gate is resolved by the round commit.

Measured rerunnable commands:

```bash
.venv/bin/python -m pytest -q
uv lock --check
LC_COURSES_ROOT=.internal/notebook-courses LC_FAKE_MODEL=1 LC_PORT=45729 ./run.sh
.venv/bin/python scripts/gate_notebook_execution.py --base http://127.0.0.1:45729 --courses-root .internal/notebook-courses --shots .internal/notebook-execution-shots
```

Measured results: 159 tests passed. A released Business Data Analytics cell read its relative `L2/Airbnb.csv` and returned a 5 by 15 table. Selected-cell and all-cell UI runs passed at 1280x720 and 1440x900 with no console errors or horizontal overflow. The sandbox denied network, child processes, a foreign-course read, and an outside-workspace write with `Errno 1`. A forced interruption resumed cells `[0, 1, 2]` while the completed-cell counter stayed `1`. Confirmation omission returned HTTP 412. Source replacement made prior output stale and blocked resume. A clean environment installed the declared runtime and passed six execution-focused checks.

No paid model call was made in this round.
