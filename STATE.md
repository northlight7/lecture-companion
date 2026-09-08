# STATE: Lecture Companion capability gauntlet

Overwritten each round. History lives in `RUNLOG.md`.

## Goal and invariants

Build a robust companion across the five real courses so a student can import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

Frozen inputs verified at Capability Round 2:

- `.internal/course-material-capability-assessment.md`: `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`
- `SPEC.md`: `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875`

## Objectives and metrics

| Area | Current measured evidence | Status |
|---|---|---|
| Six-format import | 29 of 29 real files, exact distribution, zero failures | done |
| Typed evidence | 32,757 objects with exact artifact-native locators | done foundation |
| Original preservation | SHA-256 round trip checked for every real artifact | done |
| Native mixed viewers | Six formats pass at 1280x720 and 1440x900 | done |
| Exact source links | Direct typed-object focus passes, including non-first XLSX sheets | done |
| Selected-context questions | Structured evidence, citations, disclosure, and isolation pass | done foundation |
| Embedded visuals | Real DOCX images and saved IPYNB plots render with byte validation | done |
| Offline regression | 148 tests pass | done for current scope |
| Cross-artifact search and graph | Not implemented | fail |
| Resumable mixed-artifact model work | Slide workflow only | fail |
| Computational and subject-aware workflows | Benchmark exists, product workflows not implemented | fail |

## Decisions

- Native viewers remain local and read-only. Originals are downloaded separately and never rewritten.
- Exact object URLs carry course, artifact, and object identity. XLSX links select the locator's sheet before rendering.
- Selected-question evidence always includes object type, exact locator, structured data, and extracted text within fixed object and request budgets.
- Only explicit selected excerpts can reach DeepSeek. Offline fake answers remain local and the UI states both cases before submission.
- Embedded DOCX and notebook raster images are served only through course-scoped object routes. Decoded media is limited to 32 MiB and validated by image format before response.
- True permission-enforced holdout separation is unavailable because all agents share the filesystem. Every round continues to report that protocol gate as failed.

## Work queue

1. Index typed objects and add course-scoped cross-artifact search, evidence citations, version staleness, and a concept relationship view.
2. Extend resumable model processing and schema validation to every artifact type with interruption and duplicate-billing tests.
3. Add safe notebook execution, workbook inspection, and deterministic calculation verification.
4. Implement the five subject-aware workflows and golden tasks for spreadsheets, notebook diagnostics, ER notation, ethics balance, and finance leakage.
5. Run the two-pass live DeepSeek sample within the remaining $5 cap, then clean-checkout, security, accessibility, and smoke gates.

## Rejected attempts and do-not-repeat notes

- A browser gate that selected the previous artifact's object during hash navigation was rejected. Wait for `data-artifact-id` before interacting.
- Relying on the browser's default `[hidden]` rule was rejected because author CSS overrode it. Keep the explicit global hidden rule.
- Sending `obj.text` alone was rejected. Dataset filenames, field names, and formula text omit the structured facts a student selected.
- Omitting XLSX sheet objects from the grid was rejected because exact sheet links and sheet-level metadata then disappear.
- Treating metadata-only image objects as a native viewer was rejected. Render preserved DOCX images and saved notebook raster outputs.
- Trusting a declared image MIME type was rejected. Validate byte content and enforce size limits before serving it.
- Port 45679 was occupied during critic verification. Use a verified free port and do not disturb unknown listeners.
- True blind holdout isolation cannot be claimed in this shared filesystem.

## CURRENT STATE

Capability Round 2 is complete. The full frozen product bar remains FAIL. The final independent critic passed the Round 2 increment after earlier critics exposed missing XLSX sheet links, lossy structured question evidence, unrendered embedded visuals, and unvalidated media bytes. Each largest gap was fixed and remeasured before the round closed.

Measured rerunnable commands:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python scripts/verify_real_corpus.py
LC_COURSES_ROOT=.internal/native-viewer-courses LC_FAKE_MODEL=1 LC_PORT=45701 ./run.sh
.venv/bin/python scripts/gate_native_viewers.py --base http://127.0.0.1:45701 --courses-root .internal/native-viewer-courses --shots .internal/native-viewer-shots
```

Measured results: 148 tests passed. The real corpus gate imported 29 artifacts and produced 32,757 objects with zero structural failures and four explicit degradations. The browser gate passed all six formats at both required viewports with exact link and citation round trips, structured XLSX and CSV evidence, real DOCX images, saved notebook plots, no console errors, and no horizontal overflow.

No paid model call was made in this round.
