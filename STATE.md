# STATE — Lecture Companion

Overwritten in place each round. History lives in `RUNLOG.md`.
Read this first, then `git log`, then smoke-test last round's work.

## Objectives and progress

| # | Objective (from SPEC.md) | Metric | Status |
|---|---|---|---|
| O1 | App boots, imports a course, explains every slide | G1, G5 green | in progress (round 1) |
| O2 | Course isolation is structural | G6 green | in progress (round 1) |
| O3 | Explanations grounded in the actual slide | G5 + critic reads real output | in progress (round 1) |
| O4 | Key only ever in the OS keyring | G9 green, no key in any log | in progress (round 1) |
| O5 | Resume never re-calls the model for a done slide | G7, G8 green | in progress (round 1) |
| O6 | README describes reality | G11, critic reads code vs README | not started |
| O7 | Viewer reads like a textbook, no overflow at 1440px | G2 green + critic screenshot | in progress (round 1) |

## Decisions ledger

| Round | Decision | Why | Source |
|---|---|---|---|
| 1 | Vision model `deepseek-v4-flash-vision-exp`, base `https://api.deepseek.com`, OpenAI-compatible | confirmed live in the docs, not from memory | <https://api-docs.deepseek.com/guides/vision/> |
| 1 | Treat HTTP 429 as the pause signal | the documented rate-limit status | <https://api-docs.deepseek.com/quick_start/rate_limit> |
| 1 | `pypdfium2` + `pypdf`, not PyMuPDF | permissive licence, macOS arm64 wheels, no system deps | licence check |
| 1 | `.pptx` via `soffice --headless --convert-to pdf`, text layer from `python-pptx` | only faithful local renderer; measured at `/opt/homebrew/bin/soffice` | measured |
| 1 | `intfloat/multilingual-e5-small` (384-dim) for retrieval | retrieval-trained, ~118M params, trivial on the measured 24 GiB | <https://huggingface.co/Marqo/multilingual-e5-small> |
| 1 | Hashing embedder fallback, same 384 dims | tests must run free and offline without torch | design |
| 1 | `index.jsonl` + numpy cosine, one index file per course dir | a course is hundreds of slides; isolation becomes structural | design |
| 1 | `app/contracts.py` frozen, builders may not edit it | four parallel builders cannot be allowed to drift on shared types | design |

## Work queue

| Item | Owner | Gate | Result |
|---|---|---|---|
| Frozen SPEC.md + contracts.py | orchestrator | — | done |
| Storage core, keyring, run.sh | builder A | G9 | running |
| PDF/.pptx extraction + import filing | builder B | G3, G4 | running |
| Embeddings, vector index, DeepSeek client, pipeline | builder C | G5, G6, G7, G8 | running |
| FastAPI routes + no-build frontend | builder D | G1, G2 | running |
| Fresh-critic pass 1 | critic | all | pending |

## Rejected attempts (do not repeat)

_(none yet)_

## CURRENT STATE

Round 1, first build. Four builders fanned out in parallel against the frozen
`app/contracts.py`, with disjoint file ownership:

- A: `app/config.py`, `app/keystore.py`, `app/course.py`, `run.sh`, `tests/conftest.py`, `tests/test_course_store.py`
- B: `app/extract/*`, `app/importer.py`, `scripts/make_fixtures.py`, `tests/test_extract.py`, `tests/test_import_filing.py`
- C: `app/embed.py`, `app/vectors.py`, `app/llm.py`, `app/overview.py`, `app/pipeline.py`, `tests/test_pipeline.py`, `tests/test_isolation.py`, `tests/test_resume.py`, `tests/test_llm_client.py`
- D: `app/main.py`, `web/*`, `tests/test_api.py`

Next after they land: run the full suite, smoke-test the real app in a browser
at 1440px, then hand the artifact to a fresh blind critic.

Resume cursor: round 1, item "collect builder output and run the full gate
suite". No product course is mid-processing.
