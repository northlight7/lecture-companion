# STATE — Lecture Companion

Overwritten in place each round. History lives in `RUNLOG.md`.
Read this first, then `git log`, then smoke-test last round's work.

## Objectives and progress

| # | Objective (from SPEC.md) | Metric | Status |
|---|---|---|---|
| O1 | App boots, imports a course, explains every slide | G1, G5 green | **done** — measured live and stubbed |
| O2 | Course isolation is structural | G6 green | **done** — critic probed the literal prompt, zero leaks |
| O3 | Explanations grounded in the actual slide | G5 + real output read | **done** — 3 live explanations read against slide text, no invented claims |
| O4 | Key only ever in the OS keyring | G9 green | **done** — critic ran a canary key through 6 error paths, no leak |
| O5 | Resume never re-calls the model for a done slide | G7, G8 green | **done** — proven under SIGKILL, and again against the live paid API |
| O6 | README describes reality | G11 | **done** — critic traced every claim to code |
| O7 | Viewer reads like a textbook, no overflow at 1440px | G2 green | **done** — 8/8 across 4 screens x 2 themes |

## Decisions ledger

| Round | Decision | Why | Source |
|---|---|---|---|
| 1 | Vision model `deepseek-v4-flash-vision-exp`, base `https://api.deepseek.com` | confirmed in the docs, then confirmed live | <https://api-docs.deepseek.com/guides/vision/> |
| 1 | HTTP 429 is the pause signal | the documented rate-limit status | <https://api-docs.deepseek.com/quick_start/rate_limit> |
| 1 | `pypdfium2` + `pypdf`, not PyMuPDF | permissive licence, macOS arm64 wheels | licence check |
| 1 | `.pptx` via `soffice`, text from `python-pptx` | only faithful local renderer | measured |
| 1 | Hashing embedder is the DEFAULT, e5 opt-in | no forced torch download; tests stay offline | design |
| 1 | `index.jsonl` per course dir | makes isolation structural, not a rule to remember | design |
| 1 | `app/contracts.py` frozen | four parallel builders must not drift on shared types | design |
| 2 | Instructions and source split by `CONTENT_MARKER` | the stub echoed the prompt as the course overview | measured, first boot |
| 2 | A fallback overview does NOT record its source ids | one transient failure made a course claim forever that it had no syllabus | measured, live API |
| 2 | `file_id` is content-addressed (sha256 of bytes) | re-importing the same deck duplicated it and would bill every slide again | measured, critic finding 1 |
| 2 | Course-list state derived from counts, not stored | a course read "done" while 4 slides were unexplained | measured, critic finding 2 |

## Work queue

| Item | Gate | Result |
|---|---|---|
| Frozen SPEC.md + contracts.py | — | done |
| Storage core, keyring, run.sh (A) | G9 | done, verified |
| Extraction + import filing (B) | G3, G4 | done, verified |
| Embeddings, index, client, pipeline (C) | G5-G8 | done, verified |
| FastAPI + frontend (D) | G1, G2 | done, verified (builder stalled; work re-checked, not trusted) |
| Live API verification | O3 | done — real key, real slides, grounding read by hand |
| Critic pass 1 | all | **PASS** |
| Critic pass 2 | all | pending — needed for the exit condition |

## Rejected attempts (do not repeat)

| Attempt | Why rejected |
|---|---|
| PyMuPDF for PDF rendering | AGPL; pypdfium2 is permissive and has arm64 wheels |
| A vector database | a course is hundreds of slides; one jsonl per course dir also makes isolation structural |
| Trusting Builder D's "done, 6/6 explained" self-report | no pasted output; the critic protocol forbids accepting it |
| A G2 script that navigates to a guessed URL | it silently measured the course list twice and called it a viewer pass |
| Random `file_id` per upload | made re-import create a duplicate deck |
| Stub mermaid drawing `A --> B --> C` | asserted relationships the slide never states, inside the field the viewer renders as content |

## CURRENT STATE

Round 2 complete in substance, awaiting the second critic.

Critic pass 1 returned **PASS** at commit `636c8de`, with 6 non-gate findings.
All 6 are now fixed and verified:

1. duplicate deck on re-import -> content-addressed `file_id` (measured: two
   uploads of the same PDF now give one deck, 6 slides)
2. course badge read "done" with slides unexplained -> derived state
   (measured: reads `partial 6 / 10` after a second deck is added)
3. stale poisoned test data in `Courses/` -> deleted
4. README asserted e5 while hashing actually runs -> table and prose corrected
5. stub claimed to read the image it cannot see -> reworded
6. stub mermaid asserted unstated edges -> now only claims the terms appear

The project directory MOVED during round 2, from
`~/Documents/Claude/Lecture_Companion` to `~/Documents/AI/Lecture_Companion`.
Git history, the venv and all work survived; a grep for `Documents/Claude`
across the tree returns nothing.

## RESUME CURSOR

Next action: run **critic pass 2** on the current tree (fresh window, blind
authorship, reads SPEC.md first). Two consecutive passes is the exit condition,
and pass 1 is banked.

Before spawning it: commit and push, and do NOT edit the tree while the critic
runs. Pass 1 explicitly noted a concurrent process was mutating the repo mid
judgement, which weakened its measurements.

No product course is mid-processing. The live key is in the OS keyring only.
