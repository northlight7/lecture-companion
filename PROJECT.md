# Lecture Companion

## What this is

A local web app that turns mixed course material into a grounded, plain-language learning companion for a new MSc student. The current build is a FastAPI backend with a no-build browser frontend. A DeepSeek vision model writes explanations while storage, retrieval, and processing run locally.

## Status

The slide pipeline remains green. Capability Round 1 added measured six-format ingestion and typed exact-locator evidence for all 29 real course files. The expanded product bar still fails because native mixed-artifact viewers and selected-context questions are not implemented.

## Current progress

- Done: imported all 29 course files across PDF, PowerPoint, Word, Excel, CSV, and Jupyter Notebook with zero failures and verified every preserved original by SHA-256.
- Done: created 32,757 typed learning objects with exact page, slide, speaker-note, document-block, sheet, cell, range, chart, notebook-cell, output, and dataset-field locators.
- Done: measured source-versus-extraction fidelity for every format, including workbook formulas, charts, tables, hidden state, merges, filters, conditional formatting, validation, and notebook rich outputs. Four parser degradations are reported explicitly.
- Done: converted the findings into a detailed capability assessment at `.internal/course-material-capability-assessment.md`.
- Done: ran 24 live DeepSeek requests across eight representative course tasks. The initial token budget produced 6 of 8 usable structured responses. The corrected configuration produced 16 of 16 across two passes.
- Done: objectives O1 to O7 for the original slide pipeline are verified. This includes boot, structural course isolation, grounding, key protection, resumability without repeat model calls, truthful documentation, and responsive layout.
- Next: build native read-only viewers and exact deep links for every artifact type, then add selected-context questions at 1280x720 and 1440x900.

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

## Notes

- Run `./run.sh` to serve on port 8765. `LC_FAKE_MODEL=1 ./run.sh` exercises the existing slide pipeline without an API key or model spend.
- `.venv/bin/python -m pytest` runs the current offline suite.
- Durable project rules remain unchanged. The DeepSeek key lives only in the OS keyring under service `lecture-companion` and account `deepseek-api-key`. `Courses/` is gitignored user data. Course isolation is structural.
- Public repository: `northlight7/lecture-companion`.
- Detailed backend research and test evidence lives at `.internal/model-backend-evaluation.md`.
- `.venv/bin/python scripts/verify_real_corpus.py` reruns the read-only 29-file import and structural fidelity gate.
- The current browser UI remains slide-native. DOCX, XLSX, CSV, and IPYNB are available through typed APIs but do not yet have native viewers or question workflows.
