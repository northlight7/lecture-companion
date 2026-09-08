# Lecture Companion

## What this is

A local web app that turns mixed course material into a grounded, plain-language learning companion for a new MSc student. The current build is a FastAPI backend with a no-build browser frontend. A DeepSeek vision model writes explanations while storage, retrieval, and processing run locally.

## Status

The slide-based foundation is working and its first independent critic pass passed. An audit of all currently released material from five courses is complete. The actual source set expands the product beyond slides into documents, spreadsheets, notebooks, datasets, exercises, diagrams, equations, code, and argument-based learning.

## Current progress

- Done: audited 29 course files across PDF, PowerPoint, Word, Excel, CSV, and Jupyter Notebook formats. Parsed their structure and visually reviewed all PDFs, PowerPoint decks, and Word tutorials.
- Done: converted the findings into a detailed capability assessment at `.internal/course-material-capability-assessment.md`.
- Done: objectives O1 to O7 for the original slide pipeline are verified. This includes boot, structural course isolation, grounding, key protection, resumability without repeat model calls, truthful documentation, and responsive layout.
- Next: plan the typed learning-object architecture and phased build against the assessment, beginning with universal ingestion, exact citations, native artifact views, cross-artifact course links, and subject-aware validation.

## Decisions

- Preserve the proven structural course isolation and resumability mechanisms.
- Replace the slide-only content model with typed learning objects. A learning object can be a slide, note, document block, exercise, spreadsheet range, chart, notebook cell, output, dataset field, equation, diagram, or argument.
- Exact source locators and inspectable evidence are required across every artifact type.
- The shared architecture must be domain-neutral, with subject-aware teaching and validation for spreadsheets, analytics code, database diagrams, ethical reasoning, and finance.
- DeepSeek `deepseek-v4-flash-vision-exp` uses the OpenAI-compatible chat completions endpoint at `https://api.deepseek.com`. Images are sent as base64 data URLs and HTTP 429 pauses processing.
- PDF pages use pypdfium2 for rendering and pypdf for text. PowerPoint files use headless soffice for rendering and python-pptx for text and speaker notes.
- Retrieval uses one index per course. The signed hashing embedder is the offline default and `intfloat/multilingual-e5-small` is optional. Switching embedders requires rebuilding that course's index.
- File identifiers are content-addressed with SHA-256 so identical bytes are not processed or billed twice. Intentional week-level references to repeated material must still be retained.

## Notes

- Run `./run.sh` to serve on port 8765. `LC_FAKE_MODEL=1 ./run.sh` exercises the existing slide pipeline without an API key or model spend.
- `.venv/bin/python -m pytest` runs the current offline suite.
- Durable project rules remain unchanged. The DeepSeek key lives only in the OS keyring under service `lecture-companion` and account `deepseek-api-key`. `Courses/` is gitignored user data. Course isolation is structural.
- Public repository: `northlight7/lecture-companion`.
