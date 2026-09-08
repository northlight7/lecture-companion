# STATE: Lecture Companion capability gauntlet

Overwritten each round. History lives in `RUNLOG.md`.

## Goal and invariants

Build a robust companion across the five real courses so a student can import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

Frozen inputs verified at Capability Round 3:

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
| Offline regression | 153 tests pass | done for current scope |
| Resumable mixed-artifact model work | Slide workflow only | fail |
| Computational and subject-aware workflows | Benchmark exists, product workflows not implemented | fail |

## Decisions

- Typed search uses one SQLite FTS5 database inside each course directory. No global course-content index exists.
- The knowledge fingerprint covers current artifact ids, byte hashes, versions, extraction state, and object counts. A schema version invalidates older derived indexes.
- Search is local lexical retrieval with explicit aliases. The UI names the method and never presents it as opaque semantic inference.
- Search diversity caps early results from one artifact. Explicit notebook filename references can add the linked dataset root as a result.
- Concept graph evidence is sampled across artifacts, not filled by the first file alone.
- Concept edges state why artifacts are relevant and carry exact source object ids. Prerequisite relationships are labeled modeled candidates and include an uncertainty warning.
- True permission-enforced holdout separation is unavailable because all agents share the filesystem. Every round continues to report that protocol gate as failed.

## Work queue

1. Add controlled notebook execution with environment disclosure, confirmation, limits, network denial, output capture, and interruption-safe resume.
2. Add deterministic workbook inspection, formula and chart diagnosis, and unit-aware calculation verification.
3. Extend artifact-specific grounded explanations and schema validation to non-slide objects with adaptive DeepSeek budgets and duplicate-billing tests.
4. Implement ER diagram validation, balanced ethics scaffolding, finance leakage checks, and practice workflows.
5. Run the two-pass live DeepSeek sample within the remaining $5 cap, then clean-checkout, security, accessibility, and smoke gates.

## Rejected attempts and do-not-repeat notes

- Calling the local hashing index a semantic model was rejected. Use explicit aliases and expose the retrieval method.
- Filling concept evidence with the first matching artifact was rejected. Cap evidence per artifact so cross-file coverage remains visible.
- Returning a related dataset filename alone was rejected. Relationship results show structured dataset facts and exact locators.
- Treating inferred prerequisites as facts was rejected. Keep candidate certainty and the visible warning.
- Searching superseded object files was rejected. Filter every build and query through the current artifact manifest.
- A persistent derived index without an algorithm schema version was rejected. Bump the schema whenever index semantics change.
- True blind holdout isolation cannot be claimed in this shared filesystem.

## CURRENT STATE

Capability Round 3 is complete. The full frozen product bar remains FAIL. A fresh independent critic passed the cross-artifact search and concept-graph increment.

Measured rerunnable commands:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/verify_real_corpus.py
LC_COURSES_ROOT=.internal/knowledge-courses LC_FAKE_MODEL=1 LC_PORT=45711 ./run.sh
.venv/bin/python scripts/gate_course_knowledge.py --base http://127.0.0.1:45711 --courses-root .internal/knowledge-courses --shots .internal/knowledge-shots
```

Measured results: 153 tests passed. The five-course gate found exact local results and nonempty concept relationships in all five courses. Business Data Analytics linked shrinkage evidence across PDF, IPYNB, and CSV. First UI passed 1280x720 and 1440x900 with no console errors or horizontal overflow. The critic measured 20 warm searches at p50 3.87 ms, p95 4.33 ms, and maximum 4.41 ms. Source replacement made the index stale, automatic rebuild found the current marker, and obsolete-marker search returned no results.

No paid model call was made in this round.
