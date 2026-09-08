# Lecture Companion

## What this is

A local web app that turns mixed course material into a grounded, plain-language learning companion for a new MSc student. The current build is a FastAPI backend with a no-build browser frontend. A DeepSeek vision model writes explanations while storage, retrieval, and processing run locally.

## Status

The slide pipeline remains green. Capability Round 3 added course-local typed search, exact cross-artifact relationships, a concept graph, and source-version invalidation. Its fresh critic passed the increment. The expanded product bar still fails because computational tools and resumable subject-aware learning workflows are not implemented.

## Current progress

- Done: imported all 29 course files across PDF, PowerPoint, Word, Excel, CSV, and Jupyter Notebook with zero failures and verified every preserved original by SHA-256.
- Done: created 32,757 typed learning objects with exact page, slide, speaker-note, document-block, sheet, cell, range, chart, notebook-cell, output, and dataset-field locators.
- Done: measured source-versus-extraction fidelity for every format, including workbook formulas, charts, tables, hidden state, merges, filters, conditional formatting, validation, and notebook rich outputs. Four parser degradations are reported explicitly.
- Done: converted the findings into a detailed capability assessment at `.internal/course-material-capability-assessment.md`.
- Done: ran 24 live DeepSeek requests across eight representative course tasks. The initial token budget produced 6 of 8 usable structured responses. The corrected configuration produced 16 of 16 across two passes.
- Done: objectives O1 to O7 for the original slide pipeline are verified. This includes boot, structural course isolation, grounding, key protection, resumability without repeat model calls, truthful documentation, and responsive layout.
- Done: native read-only viewers operate PDF, PPTX, DOCX, XLSX, CSV, and IPYNB at 1280x720 and 1440x900 without measured console errors or horizontal overflow.
- Done: exact object links and selected-context questions preserve typed locators, structured evidence, citations, uncertainty, remote disclosure, and course isolation.
- Done: real Word images and saved notebook plots render from byte-validated course-local media endpoints.
- Done: all five real courses pass local typed search, exact result links, concept-to-file evidence, explicit notebook-to-dataset references, and responsive relationship views.
- Done: source changes mark the course knowledge index stale. The next search rebuilds it atomically and removes superseded evidence.
- Next: add resumable artifact-specific teaching workflows, starting with controlled notebook execution and deterministic spreadsheet inspection.

## Decisions

- Preserve the proven structural course isolation and resumability mechanisms.
- Replace the slide-only content model with typed learning objects. A learning object can be a slide, note, document block, exercise, spreadsheet range, chart, notebook cell, output, dataset field, equation, diagram, or argument.
- Exact source locators and inspectable evidence are required across every artifact type.
- Artifact identity separates byte content from path occurrence so repeated weekly datasets retain their hierarchy while sharing one canonical original.
- Parser degradation lowers extraction quality and stays visible. Unsupported package parts are preserved with byte hashes for recovery.
- The shared architecture must be domain-neutral, with subject-aware teaching and validation for spreadsheets, analytics code, database diagrams, ethical reasoning, and finance.
- Use a provider-neutral model interface. DeepSeek `deepseek-v4-flash-vision-exp` is the application backend and the only paid API permitted in the current gauntlet.
- Do not treat a ChatGPT subscription or the ChatGPT application as a production backend. ChatGPT subscriptions do not include OpenAI API usage.
- Select reasoning effort and completion budget by task type. The current fixed 1,600-token ceiling is inadequate for complex ethics and notebook-diagnostic tasks.
- PDF pages use pypdfium2 for rendering and pypdf for text. PowerPoint files use headless soffice for rendering and python-pptx for text and speaker notes.
- Retrieval uses one index per course. The signed hashing embedder is the offline default and `intfloat/multilingual-e5-small` is optional. Switching embedders requires rebuilding that course's index.
- File identifiers are content-addressed with SHA-256 so identical bytes are not processed or billed twice. Intentional week-level references to repeated material must still be retained.
- Selected questions send only the question and bounded selected evidence when connected. Structured metadata precedes extracted prose so formulas, cached values, dataset profiles, and sheet state remain answerable.
- Embedded DOCX and notebook raster visuals are capped at 32 MiB and verified against their declared image type before serving.
- Cross-artifact search uses a course-local SQLite FTS5 index and an explicit, inspectable alias catalog. It does not claim that lexical matching is a semantic model.
- Concept-to-artifact edges are measured source matches. Filename references are measured links. Prerequisite arrows remain visibly labeled candidates unless the source states the dependency.

## Notes

- Run `./run.sh` to serve on port 8765. `LC_FAKE_MODEL=1 ./run.sh` exercises the existing slide pipeline without an API key or model spend.
- `.venv/bin/python -m pytest` runs the current offline suite.
- Durable project rules remain unchanged. The DeepSeek key lives only in the OS keyring under service `lecture-companion` and account `deepseek-api-key`. `Courses/` is gitignored user data. Course isolation is structural.
- Public repository: `northlight7/lecture-companion`.
- Detailed backend research and test evidence lives at `.internal/model-backend-evaluation.md`.
- `.venv/bin/python scripts/verify_real_corpus.py` reruns the read-only 29-file import and structural fidelity gate.
- `.venv/bin/python scripts/gate_native_viewers.py --courses-root <project-internal-course-root>` reruns the six-format viewer, exact-link, selected-question, embedded-media, viewport, overflow, and console gate against a running fake-model server.
- `.venv/bin/python scripts/gate_course_knowledge.py --courses-root <project-internal-course-root>` reruns five-course search, relationship, isolation, staleness, performance, and responsive-browser checks.
