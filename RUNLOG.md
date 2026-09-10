# RUNLOG

Append-only. One entry per round, never edited.

## Round 1 — 2026-09-03, paused mid-round

**Item chosen and why:** there was no product at all, only a README describing a
plan. The highest-value item was the first vertical slice: a frozen bar, a frozen
interface contract, and the whole spine from import to explanation, because every
later round's gates need something real to run against.

**Attempted:** froze `SPEC.md` and `app/contracts.py`, then fanned out four
builders with disjoint file ownership (A storage/keyring, B extraction/filing,
C pipeline/retrieval/model client, D API/frontend).

**Research before deciding** (nothing here is from memory):
- Vision model id, base URL and the image content-part shape confirmed at
  <https://api-docs.deepseek.com/guides/vision/>.
- Limits (48 MiB body, 32 MiB per image, 600 images, 8192 px/side) same source.
- HTTP 429 as the rate-limit signal at
  <https://api-docs.deepseek.com/quick_start/rate_limit>.
- Embedding choice `intfloat/multilingual-e5-small`, 384-dim, retrieval-trained,
  against the measured 24 GiB of this machine
  (<https://huggingface.co/Marqo/multilingual-e5-small>).
- `soffice` presence measured at `/opt/homebrew/bin/soffice`, and a real
  .pptx -> PDF conversion timed at 1.29s.

**Critic verdict:** none. No critic ran; the round was paused before the critique
step. This round is NOT judged.

**Single biggest gap:** the app has never been booted. G1, G2, G10 and G11 are
all unmeasured, and `README.md` still describes a plan rather than the code.

**What shipped:** commit `ccbf533`, 20 files, containing builders A, B and C.
Measured 134 passing tests. Two invariants probed by the orchestrator directly
rather than through the builders' own tests: resume never re-called a done slide
(client calls after a 429 pause were exactly 3,4,5 of 6), and a second course's
assembled prompts contained none of the first course's vocabulary.

**What was rejected:** PyMuPDF for PDF rendering, on its AGPL licence, in favour
of pypdfium2 + pypdf. A vector database, in favour of one `index.jsonl` per
course directory, because that makes course isolation structural rather than a
rule to remember. Builder D's five files were rejected FROM THIS COMMIT, not from
the project: the agent never reported, so they are unverified and stay
uncommitted until re-checked.

**Skills reached for:** Builder B invoked the `pptx` skill and reported it
changed nothing in the implementation, being an authoring skill whose read-path
advice is `markitdown` (not installed, and it does not expose per-slide notes);
it did confirm reading runs individually rather than trusting `shape.text`.
Builder D was briefed to load `design-taste-frontend` but has not reported, so
whether it did is unverified.

**Drift check:** the round served invariants 1, 2, 4 and 5 (isolation, grounding
scaffolding, key handling, resume). It did not serve invariant 3 (boots end to
end) or 6 (truthful repo), which is exactly what the biggest-gap line says.

Round 1 done — paused, unjudged — the spine of the app exists and 134 tests pass, but it has never been booted and the README still lies.

### Round 1 addendum — Builder D outcome (recorded after the pause)

Builder D did not complete. The harness killed it as stalled: "no progress for
600s (stream watchdog did not recover)". Its last reported line was "State is
`done`, 6/6 explained. Now measuring gate G2 in a real browser."

Read carefully, that line is a claim about the FAKE-model end-to-end run
(6 slides of the `lecture_w1.pdf` fixture explained), reported by the builder
about its own work, with no output pasted. It is therefore `modeled`, not
`measured`, and it is exactly the kind of self-report the critic protocol says
not to accept. It stands as a hint that `app/main.py` may work, nothing more.

D died at the point of measuring G2, so G2 has no result at all.

Nothing changes about the pause state: D's five files stay uncommitted and
unverified, and the resume cursor in STATE.md already covers re-checking them
from scratch.

## Round 2 — 2026-09-04

**Item chosen and why:** round 1 ended without the app ever being booted. Every
remaining gate (G1, G2, G10, G11) needed a running server, and the README still
described a plan. Booting it was the only item that could move anything.

**What was attempted:** boot the app, drive a real course through it, measure
the unmeasured gates, then hand the artifact to a fresh blind critic. Mid-round
the human supplied a DeepSeek key, so the live path was verified too.

**Skills / tools reached for:** the `claude-in-chrome` MCP tools failed (the
Claude extension is not installed in this Chrome profile) and `playwright` MCP
hung (it is configured with `--extension`, which waits for a human to click
"connect" in the Playwright Extension popup and never times out). Documented
swap: drove Playwright's own headless Chromium from a script instead, which
needs no extension. That became `scripts/gate_g2.py`, so G2 is re-runnable.

**What booting it found that 134 green tests did not:**

1. The course overview was the prompt template. `build_overview` concatenated
   its instructions with the reference text and the stub echoed all of it, so
   every course opened with "Below are the reference documents for one
   university course..." displayed as its overview, and every explanation
   quoted that back. Fixed with an explicit `CONTENT_MARKER`.
2. The mermaid path had never executed once. `FakeClient` always returned an
   empty diagram, so the renderer, its light/dark theming and its CDN fallback
   were dead code in every test run.
3. My own first G2 script was rigged to pass. It navigated to a guessed URL,
   silently landed on the course list, measured that twice and reported a
   viewer pass. It now asserts the viewer actually rendered first.

**What the live API found that the stub did not:** a transient model failure
recorded the reference-file ids as consumed anyway, so `refresh_overview_if_needed`
would never retry, and a course that HAD a syllabus described itself as having
none, permanently. Observed on the first live course. Fixed so a fallback
leaves the ids unrecorded, with a regression test.

**Critic verdict: PASS.** A fresh critic, blind to authorship, read SPEC.md
first, cloned the repo to a clean directory to test `./run.sh`, built its own
two-course isolation probe with disjoint vocabulary, ran a real `kill -9`
mid-course, and pushed a canary key through six error paths. It ran every gate
and quoted real output for each. Its resume probe landed in the worst window —
slide 10's explanation written but not yet in the checkpoint — and the run
still finished 30/30 with 30 distinct calls, because `_done_set` unions the
checkpoint with the explanations on disk.

**Single biggest gap on failure:** not applicable, the verdict was a pass. The
critic's sharpest finding was that re-importing the same file created a
duplicate deck, which would silently bill a student for every slide again.

**What shipped:** commit `636c8de` (API, viewer, the three boot fixes) and the
round-2 commit below (six critic findings fixed, live verification, records
brought current). Live: a 6-slide deck explained by
`deepseek-v4-flash-vision-exp`, grounding spot-checked by hand against the
slides' extracted text, and resume proven against the paid API after an
accidental kill — five slides done, exactly one call on restart.

**What was rejected:** random per-upload `file_id`s (caused the duplicate
deck); the stub's `A --> B --> C` mermaid, which asserted relationships the
slide never states inside the field the viewer renders as content; and the
README's claim that e5 is the retrieval model, when the default install runs
the hashing embedder and the e5 path has never been measured.

**Process failure worth recording:** I edited the repo while critic pass 1 was
judging it, and the critic said so. Its measurements were taken against a tree
that was changing underneath it. Pass 2 must run against a frozen tree.

**Drift check:** the round served invariants 2 (grounding, now checked against
real model output rather than assumed), 3 (boots end to end, the round's whole
point) and 6 (truthful repo, README rewritten twice and then verified claim by
claim by the critic). Invariants 1, 4 and 5 were re-proven rather than newly
served.

Round 2 done — pass — the app was booted for the first time, verified against the live DeepSeek API, and a fresh critic passed it; six findings fixed.

## Capability Round 1: 2026-09-08T22:29:18+0800

**Goal and invariants:** build a five-course companion that lets a student import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

**Frozen bar:** both required hashes matched before work. The capability assessment was `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`. `SPEC.md` was `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875`.

**Item chosen and why:** six-format ingestion was the highest-value failing P0 gate. A fresh baseline critic measured that only 11 of 29 released files were supported and that every DOCX, XLSX, CSV, and IPYNB upload was rejected.

**Orchestrator contract decision:** extend the frozen slide-only `app/contracts.py` without breaking its existing types. `Artifact`, `LearningObject`, and `SourceLocator` were added because exact block, cell, chart, notebook, output, and dataset-field evidence cannot be represented by `Slide`. This is an orchestrator decision required by the expanded frozen capability bar.

**Attempt:** implemented deterministic extractors for DOCX, XLSX, CSV, and IPYNB. Added typed page and slide objects, separate speaker-note objects, content hashes, versioned path occurrences, hierarchy retention, canonical original storage, intentional duplicate references, incremental no-op imports, failure quarantine, exact-locator APIs, and original downloads. Added parser-quality warnings and hashed package-part preservation for unsupported workbook extensions. Added a source-versus-extraction fidelity gate for every format.

**Measured results:** `.venv/bin/python -m pytest -q` passed 143 tests. `.venv/bin/python scripts/verify_real_corpus.py` imported 29 of 29 files with the exact 8 PDF, 3 PPTX, 2 DOCX, 3 XLSX, 11 CSV, and 2 IPYNB distribution. It verified 32,757 typed objects and every original SHA-256. It found zero structural mismatches. Four artifacts were explicitly marked degraded instead of silently perfect. The browser G2 gate passed eight screens across light and dark at 1440x900 with no horizontal overflow. No paid model call was made.

**Critic verdict:** full bar FAIL. The final fresh critic passed the Capability Round 1 six-format fidelity increment. Its independently authored non-LLM inventory holdout passed, and the real-corpus gate exited 0. True permission-enforced holdout separation remains unavailable because agents share the filesystem, so that protocol gate is honestly failed.

**Largest remaining gap:** native read-only viewers and selected-context questions do not yet work across all six artifact types at both required viewport sizes.

**Shipped work:** the typed evidence architecture, four new deterministic extractors, exact artifact and object APIs, byte-preserving deduplication and versioning, explicit quality degradation, comprehensive unit coverage, a rerunnable 29-file corpus verifier, updated upload controls, and truthful documentation.

**Rejected work and do-not-repeat notes:** non-empty output is not fidelity evidence. Parser warnings cannot be printed and ignored. `uv sync --extra dev` prunes optional development packages in this project, so use the install command documented in state. Diagnostic scripts must use `process_course`, not a nonexistent `Pipeline` class. Two occupied test ports were abandoned rather than disturbing unknown listeners.

**Drift check:** course isolation gained adversarial typed-object API coverage. Grounding gained exact locators and versioned source identity. Originals are byte-verified. Unchanged imports avoid duplicate processing. Failed artifacts quarantine and retry. Credential handling was not changed. Warnings and unsupported structures are visible. The legacy slide pipeline and viewer remained green.

Capability Round 1 done: FAIL, six-format import and measured structural fidelity shipped. Native mixed viewers and selected-context questions remain.

## Capability Round 2: 2026-09-09T00:06:47+0800

**Goal and invariants:** build a five-course companion that lets a student import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

**Frozen bar:** both required hashes matched before work and in every critic run. The capability assessment was `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`. `SPEC.md` was `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875`.

**Item chosen and why:** native viewers and selected-context questions were the largest failure left by Capability Round 1. Without them, typed extraction was not usable by a student and exact provenance could not be operated in the product.

**Attempt:** added read-only artifact routes and browser views for PDF, PPTX, DOCX, XLSX, CSV, and IPYNB. Added paginated object loading, sheet selection, exact course-artifact-object URLs, current-source focus, copyable source links, source selection, bounded grounded questions, citations, uncertainty, and explicit remote disclosure. Preserved reference page renders. Added structured workbook and dataset displays, real DOCX image rendering, saved notebook plot rendering, course-scoped media routes, 32 MiB media limits, byte and MIME validation, and a rerunnable real browser gate.

**Measured results:** `.venv/bin/python -m pytest -q` passed 148 tests. `.venv/bin/python scripts/verify_real_corpus.py` imported all 29 files, produced 32,757 typed objects, reported four explicit degradations, and found zero failures. The Chromium gate passed PDF, PPTX, DOCX, XLSX, CSV, and IPYNB at 1280x720 and 1440x900. It verified exact citation and deep-link round trips, structured XLSX and CSV evidence, sheet metadata, real Word images, saved notebook plots, no horizontal overflow, and no console errors. Production paths contained no key-like strings. No paid model call was made.

**Critic verdict:** full frozen product bar FAIL. Round 2 increment PASS from the final fresh critic. True permission-enforced holdout separation remains unavailable because all agents share readable filesystem access, so that protocol gate remains failed.

**Largest remaining gap:** course-scoped cross-artifact search and a concept relationship view are absent. Broader computational notebook execution, workbook verification, and subject-aware workflows also remain.

**Shipped work:** six native viewers, typed exact URLs, selected-context grounded questions, structured evidence serialization, remote disclosure, saved embedded visual rendering, media hardening, 148-test coverage, a real-corpus verifier, a two-viewport browser gate, and truthful documentation.

**Rejected work and do-not-repeat notes:** a stale hash-navigation selector was rejected and replaced with artifact-load synchronization. Text-only question evidence was rejected because it hid formulas and dataset statistics. Filtering sheet objects was rejected because it broke exact sheet links. Metadata-only treatment of saved visuals was rejected. MIME declarations without byte validation were rejected. An occupied critic port produced missing browser evidence, so the critic reran on a known-free port rather than disturbing the listener.

**Drift check:** course isolation covers artifact data, questions, citations, and media. Exact grounding covers every observed typed object and selected evidence. Original bytes remain untouched. Import idempotence and the slide resume system remain green. Credential handling was unchanged and scanned. Parser degradation, uncertainty, and remote transmission remain explicit. The new views passed both required viewport sizes.

Capability Round 2 done: FAIL, the native six-format viewer and selected-context question increment passed independently. Cross-artifact search and concept relationships remain.

## Capability Round 3: 2026-09-09T03:57:37+0800

**Goal and invariants:** build a five-course companion that lets a student import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

**Frozen bar:** both required hashes matched before work and in the fresh critic run. The capability assessment was `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`. `SPEC.md` was `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875`.

**Item chosen and why:** course-local cross-artifact search and concept relationships were the highest-value failure after typed viewers became usable. The frozen milestone requires a course graph that links lecture, practice, code, outputs, and data without crossing course boundaries.

**Attempt:** added an atomic course-local SQLite FTS5 index over current typed objects, source fingerprints, schema invalidation, automatic stale rebuild, explicit concept aliases, diversified results, exact typed links, measured concept-to-file edges, explicit filename references, and visibly uncertain prerequisite candidates. Added a browser search and relationship view. Added a five-course gate for search quality, exact resolution, isolation, performance, and responsive layout.

**Measured results:** `.venv/bin/python -m pytest -q` passed 153 tests. The five-course gate returned results and graph edges for every real course. Business Data Analytics search for shrinkage expanded through regularization and found PDF, notebook, output, and explicitly linked CSV evidence. Initial search was at most 1.831 seconds and warm search was at most 0.136 seconds across the gate. Both browser sizes passed without console errors or horizontal overflow. The critic measured 20 warm searches at p50 3.87 ms, p95 4.33 ms, and maximum 4.41 ms. Replacing a source marked the index stale, rebuilt it automatically, returned the current marker, and removed obsolete evidence. No paid model call was made.

**Critic verdict:** full frozen product bar FAIL. Round 3 increment PASS from a fresh independent critic. Its non-LLM holdout was authored before implementation inspection. True permission-enforced isolation remains unavailable because agents share the filesystem, so that protocol gate remains failed.

**Largest remaining gap:** resumable artifact-specific teaching across non-slide material. Controlled notebook execution, spreadsheet diagnosis, ER validation, ethics scaffolding, and finance checks remain absent.

**Shipped work:** course-local typed search, explicit alias expansion, exact search links, cross-artifact relationships, concept and prerequisite views, staleness detection, automatic atomic rebuilding, adversarial isolation tests, five-course performance measurements, responsive browser coverage, and truthful documentation.

**Rejected work and do-not-repeat notes:** opaque semantic claims were rejected in favor of named lexical aliases. Concept evidence dominated by one artifact was rejected and replaced with per-artifact sampling. Dataset relationship results showing only a filename were rejected and now expose structured facts. Unlabeled prerequisite inference as fact was rejected. Superseded objects are excluded. Index algorithm changes require a schema bump.

**Drift check:** retrieval remains structurally isolated by one database per course. Every result and relationship carries exact current object identity. Source changes invalidate derived knowledge. Search and graph work entirely offline. Original bytes, slide resume, credential storage, media validation, and uncertainty display remain unchanged and green.

Capability Round 3 done: FAIL, local cross-artifact search and the course concept graph passed independently. Resumable artifact-specific teaching remains.

## Capability Round 4: 2026-09-09T11:29:40+0800

**Goal and invariants:** build a five-course companion that lets a student import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

**Frozen bar:** both required hashes matched before work and in the fresh critic run. The capability assessment was `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`. `SPEC.md` was `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875`.

**Item chosen and why:** controlled notebook execution was the highest-value gap after notebook source, output, and dataset relationships became inspectable. The released analytics notebooks require real relative paths, execution order, scientific packages, output capture, and honest diagnostics.

**Attempt:** added a confirmed local notebook runtime for all or selected code cells. Each deterministic run receives current-course file copies, an artifact-hash identity, a restricted working directory, per-cell timeout, bounded streams and files, a data-segment cap, durable status, and a serialized namespace checkpoint. The macOS sandbox denies network, child processes, foreign-course reads, and writes outside the run workspace. Computed stdout, tables, plots, warnings, errors, and evidence-based diagnostics remain distinct from saved notebook output and link to exact source cells. The viewer presents the actual runtime, packages, file scope, and limits before confirmation, with stop, resume, stale-source blocking, and side-by-side source evidence.

**Measured results:** `.venv/bin/python -m pytest -q` passed 159 tests. A clean environment installed 66 declared packages and passed six execution-focused checks. The real-course gate ran released regression notebook cell 26 against its relative `L2/Airbnb.csv`, returned a 5 by 15 table, and linked eight current-course files. A forced interruption resumed cells `[0, 1, 2]` while the first-cell counter remained `1`. The browser ran all cells at 1280x720 and one selected cell at 1440x900 with exact source links, visible computed output, no console errors, and no horizontal overflow. Confirmation omission returned HTTP 412. Live adversarial probes returned `Errno 1` for network, child process, foreign-course read, and `/tmp` write, without exposing the foreign marker. `uv lock --check` passed. No paid model call was made.

**Critic verdict:** full frozen product bar FAIL. Round 4 increment PASS from a fresh independent critic after a restarted stable-tree inspection. The critic recorded unchanged frozen hashes, implementation hashes, diff hash, git status, HEAD, and `origin/main` throughout its inspection. True permission-enforced holdout isolation remains unavailable because agents share the filesystem, so that protocol gate remains failed. One earlier critic launch failed at the delegated-agent usage boundary and issued no product verdict.

**Largest remaining gap:** artifact-specific grounded teaching and resumable processing remain incomplete across DOCX, XLSX, and CSV. Deterministic spreadsheet formula, chart, and calculation verification is the next highest-value gate.

**Shipped work:** the isolated execution service and child runner, actual environment disclosure, confirmation and lifecycle APIs, deterministic run identity, current-course workspace linking, exact computed provenance, scientific dependencies, local diagnostics, notebook controls, responsive source-and-output layout, unit and HTTP coverage, a real-course browser gate, and truthful documentation.

**Rejected work and do-not-repeat notes:** a hand-written default-deny sandbox without `system.sb` aborted the Python runtime. `RLIMIT_NPROC` inherited the user's existing process count and was unreliable. `RLIMIT_AS` aborted the macOS scientific stack. These were replaced by the system baseline plus narrow path and process rules, OS child-process denial, and an accurately labeled data-segment cap. A full-width execution panel hid notebook source below the fold and was replaced by a side-by-side panel. A rerun-only interruption gate was replaced by an idempotent gate that verifies the persisted counter on later runs.

**Drift check:** every execution directory remains structurally nested under one course and artifact. Exact source object ids and locators accompany every result. Imported originals are copied, never modified. Run identity and checkpoints prevent duplicate completed work. No credential or model call enters execution. Failures, warnings, environment limits, and stale state remain visible. The frozen contracts file was unchanged.

Capability Round 4 done: FAIL, controlled notebook execution passed independently. Cross-format teaching and spreadsheet verification remain.

## Capability Round 5 checkpoint: 2026-09-10T14:26:49+08:00

**Goal and invariants:** build a five-course companion that lets a student import, inspect, search, understand, question, practise, and verify mixed material. Preserve structural course isolation, exact grounding, byte-preserved originals, resumable idempotent processing, credential secrecy, and honest uncertainty.

**Frozen bar:** the capability assessment matched `2c51dd51651b8b0467986f85836f4377dde66bb0f039e91ef5f0cff6413a9587`. `SPEC.md` matched `7641e3135ce5eb7b5369393f72ad875eb70af8bc51178af3e0165b45e7b9e875` before the increment and at checkpoint.

**Chosen items and reason:** the user identified four connected learning blockers. Slide explanations were too long and repetitive. Earlier-slide links lacked deck names. Related tutorials and data were not grouped into teaching context. The native macOS app could not select a whole folder. File and course deletion also needed a complete UI.

**Attempt:** reduced the slide completion ceiling to 900 tokens and added a 100 to 180 word normal target, a 240 word dense-slide ceiling, plain definitions for jargon, repetition controls, and learner-facing punctuation normalization. Context now always includes the previous completed slide, includes only strictly earlier vector matches, labels earlier deck and slide names, and adds bounded exact objects from editable course-local study folders. DeepSeek can propose folders from current-course metadata and short extracted samples. The UI exposes editable folder names and exact related-source links. File deletion removes all versions at one source path plus orphaned derivations while preserving shared canonical bytes. Course deletion is now visible. The macOS launcher now uses a native `NSOpenPanel` bridge to enumerate supported files recursively and upload preserved relative paths. Browser folder input remains as fallback.

**Measured results:** 176 offline tests passed. `node --check web/app.js`, `swiftc launcher/LectureCompanion.swift -framework AppKit -framework WebKit -o /tmp/LectureCompanion-folder-test`, `./launcher/build-app.sh`, `git diff --check`, and both frozen hash checks passed. The built native app visibly exposed `Choose a whole folder`. It imported five released Database Management Systems files from L1 through L3 into a temporary course and preserved paths such as `Database Management Systems/L2/IS5413_Tutorial_01.docx`. The temporary course was deleted afterward. The organization page showed no console errors or horizontal overflow in the isolated browser check. No live explanation call was made. The native folder test did not make a paid model call.

**Critic verdict:** pending. This is a graceful user-requested checkpoint, not a Round 5 PASS. A fresh critic must read the frozen bar and inspect the product without builder reasoning.

**Largest remaining gap:** Round 5 has not received a fresh independent verdict. The full product bar remains FAIL. Broader subject-aware teaching and practice remain incomplete after the critic gate.

**Shipped work:** concise continuity-aware explanations, prior-deck links, future-slide exclusion, exact grouped-file context, editable and model-assisted study folders, file and course deletion, native recursive folder upload, browser fallback, tests, and updated project handoff notes.

**Rejected work and do-not-repeat notes:** relying on `webkitdirectory` alone was rejected because WKWebView did not expose a usable folder flow. Nesting the folder action inside a button-like drop zone was rejected because the native accessibility tree hid it. The working design uses a separate real button and a native chooser bridge. Study folders do not rewrite original paths or bytes.

**Drift check:** all new storage remains inside one course. Model grouping validates ids against current course artifacts. Related context comes only from the current course and carries exact object ids. Future slides are excluded. Deletion checks course ownership and refuses while processing. The frozen assessment, spec, and contracts were not weakened.

Round 5 checkpoint ready: FAIL, fresh critic pending after concise teaching, organization, deletion, and native folder upload.
