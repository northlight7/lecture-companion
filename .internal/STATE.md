# STATE: Lecture Companion capability gauntlet

Overwritten each round. History lives in `.internal/RUNLOG.md`.

## Goal and invariants

Build a robust companion across the five real courses so a student can import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

Frozen inputs verified at Capability Round 5:

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
| Workbook verification | Three real workbooks, exact precedents, cached-value separation, units, charts, rules, copy-only experiment | implemented, critic pending |
| macOS app launcher and icon | Native bundle opens, pauses cleanly, and shows the blue icon in Finder | done |
| Slide teaching continuity | Previous completed slide is mandatory, future slides are excluded, related earlier decks are exact-linked | done foundation |
| Concise learner language | 900-token cap, 100 to 180 word target, jargon definitions, punctuation normalization | done foundation |
| Related-file context | Editable study folders and exact grouped-source links reach slide prompts | done foundation |
| Native recursive folder upload | Built app imported five real files with all L1 to L3 paths preserved | done |
| File and course deletion | Confirmed UI controls and scoped backend cleanup with shared-byte preservation | done |
| Offline regression | 176 tests pass | done for current scope |
| Resumable mixed-artifact model work | Slides and notebooks only | fail |
| Subject-aware workflows | Spreadsheet foundation exists, broader teaching workflows remain | fail |

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
- Workbook checks keep source cached values separate from locally calculated values. Checks using cached formula precedents are not labeled independently verified.
- Formula experiments run on course-scoped copies. Original workbook hashes are checked before and after inspection.
- The macOS bundle uses one transparent-corner blue icon master for its native `.icns` resource and browser favicon.
- Study folders are saved as course-local metadata. They do not rewrite source paths or original bytes.
- DeepSeek folder proposals receive only current-course ids, names, paths, purposes, and bounded extracted samples. Proposed ids are validated against the current course before saving.
- The previous completed slide is always supplied for continuity. Related vector hits must have a strictly earlier course reading rank.
- Grouped non-slide context carries exact `object:<artifact-id>:<object-id>` provenance into stored explanations and clickable source links.
- Normal slide bodies target 100 to 180 words. Dense technical slides may reach 240 words. Model output is normalized to remove em dashes and semicolons from learner-facing text.
- The native app uses an `NSOpenPanel` folder bridge because `webkitdirectory` is unreliable in WKWebView. Browser fallback remains available.
- True permission-enforced holdout separation is unavailable because all agents share the filesystem. Every round continues to report that protocol gate as failed.

## Work queue

1. From a clean checkout, smoke-test the latest commit, then run the fresh Round 5 critic against the workbook, teaching-continuity, folder, and deletion increment.
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
- Calling a formula independently verified when it consumes cached formula precedents was rejected. Label that state `verified_using_cached_precedents` and disclose its calculation basis.
- The generated transparency edit that removed the blue app tile was rejected. The blue rounded-square gradient is part of the icon, and only its outer corners are transparent.
- True blind holdout isolation cannot be claimed in this shared filesystem.

## CURRENT STATE

Capability Round 5 is in progress. The full frozen product bar remains FAIL. A fresh independent critic remains required before the round can close. The latest increment adds concise continuity-aware slide teaching, exact earlier-slide and grouped-file links, editable model-assisted study folders, guarded file and course deletion, and a native recursive folder chooser. Business Data Analytics remains paused at 7 of 110 and resumes from slide 8. No live explanation run was started.

Measured rerunnable commands:

```bash
.venv/bin/python -m pytest -q
uv lock --check
./launcher/build-app.sh
swiftc launcher/LectureCompanion.swift -framework AppKit -framework WebKit -o /tmp/LectureCompanion-folder-test
node --check web/app.js
LC_COURSES_ROOT=.internal/workbook-courses LC_FAKE_MODEL=1 LC_PORT=45751 ./run.sh
.venv/bin/python scripts/gate_workbook_inspection.py --base http://127.0.0.1:45751 --courses-root .internal/workbook-courses
```

Measured results: 176 tests passed. The frozen hashes still match. The rebuilt native app opened its folder chooser and recursively imported five released files from `Database Management Systems`, preserving paths from `L1` through `L3`. The temporary imported course was deleted after verification. The browser organization view had no console errors or horizontal overflow. All three released workbooks retained matching source hashes in the prior workbook gate. The verifier independently reproduced `1 Comparison!C8` as 420.0 from 260.4, 113.4, and 46.2 with the source unit identified as HKD thousands.

No paid model call was made in this round.
