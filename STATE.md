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

**PAUSED by the human at round 1, mid-round, awaiting Builder D.**

Committed and safe: `ccbf533` on local `main`. NOT yet pushed to origin.

Done and independently verified by the orchestrator (not merely self-reported):

- Builder A — `app/config.py`, `app/keystore.py`, `app/course.py`, `run.sh`,
  `tests/conftest.py`, `tests/test_course_store.py`. Path traversal blocked on
  all five hostile ids; keystore has zero file writes; slug collision handled.
- Builder B — `app/extract/*`, `app/importer.py`, `scripts/make_fixtures.py`,
  `tests/test_extract.py`, `tests/test_import_filing.py`. G3 measured: 6-page
  fixture -> 6 images, all text non-empty, max side 1684px. G4 measured:
  lecture -> slides deck of 6, syllabus -> reference with no deck.
- Builder C — `app/embed.py`, `app/vectors.py`, `app/llm.py`, `app/overview.py`,
  `app/pipeline.py` and four test files. G7 probed directly: 429 on slide 3
  pauses with done=[0,1,2], the resumed run calls only 3,4,5. G6 probed
  directly: course B's literal assembled prompts contain none of course A's
  vocabulary.

In flight when the pause landed:

- Builder D — `app/main.py`, `web/index.html`, `web/app.js`, `web/styles.css`,
  `tests/test_api.py`. **FAILED.** The harness killed it as stalled ("no
  progress for 600s"). All five files exist on disk (written 17:49-17:55) but
  they are UNVERIFIED and deliberately left UNCOMMITTED. Its final line claimed
  a fake-model run reached "done, 6/6 explained" and that it was about to
  measure G2 — that is a self-report with no pasted output, so it is `modeled`,
  not `measured`, and the critic protocol says not to accept it. It died before
  producing any G2 result. Treat all five files as an unreviewed draft.

## RESUME CURSOR

Round 1, item: "collect Builder D's output and run the full gate suite".

On resume, in this order:
1. Read this file, then `git log`, then run
   `.venv/bin/python -m pytest -q -p no:warnings` and confirm it is still green
   (it was 134 passed before D's files were counted).
2. Re-check Builder D's five uncommitted files against its brief. Do not trust
   them; D never reported. Run `tests/test_api.py` and boot the server for G1:
   `LC_FAKE_MODEL=1 .venv/bin/python -m uvicorn app.main:app --port 8799` then
   `curl -s localhost:8799/api/health` must return `{"ok": true}`.
3. Gate G2 is still unmeasured: load the viewer at 1440px and evaluate
   `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
4. Gate G11 is still unmet: `README.md` currently ends with a "Status: Early
   prototype ... being built out" section that predates the code. Rewrite it to
   describe what actually exists before any critic pass.
5. Then, and only then, hand the artifact to a fresh blind critic using
   `.internal/critic-prompt.md`. No critic has run yet.
6. Commit D's work at the round boundary and push `main` to
   `northlight7/lecture-companion`. G10 is unmet: nothing is pushed yet.

No product course is mid-processing; there is no user data to resume. The pause
is a loop-level pause only.
