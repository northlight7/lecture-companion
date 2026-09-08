# Lecture Companion

## What this is

A local web app (FastAPI backend, one-command start, no-build browser frontend) that turns a
course's lecture slides into a plain-language textbook, for a new MSc student. A DeepSeek vision
model writes the explanations; everything else runs locally.

## Status

Round 2 complete in substance. One critic pass banked (PASS). The only thing between here and
the exit condition is a second independent critic pass.

## Current progress

- Next: run critic pass 2 (fresh window, blind authorship, reads SPEC.md first) on a clean,
  pushed tree. Do not edit the repo while it judges — pass 1 was weakened by a concurrent
  mutation.
- Done: objectives O1–O7 (boot, structural course isolation, grounding, no key leak, resumable
  without re-calling the model, truthful README, no-viewport-overflow) all verified live and
  stubbed. Critic pass 1 passed at `636c8de`; all six of its non-gate findings are fixed.

## Decisions

- DeepSeek `deepseek-v4-flash-vision-exp`, base `https://api.deepseek.com`, OpenAI-compatible
  chat/completions, image sent as a base64 `data:` URL. HTTP 429 is the pause signal.
- pypdfium2 (render) + pypdf (text), not PyMuPDF — permissive license vs AGPL, macOS arm64 wheels.
- `.pptx` -> PDF via headless soffice; python-pptx supplies the text layer and speaker notes and
  is the text-only fallback when soffice is absent.
- Retrieval: a signed hashing embedder is the default (no forced torch download, tests stay
  offline); `intfloat/multilingual-e5-small` is opt-in. Both 384-dim, so an index built with one
  is the wrong shape for the other — rebuild a course's index after switching.
- One `index.jsonl` per course dir + numpy cosine, not a vector DB — a course is hundreds of
  slides, and one jsonl per course makes isolation structural.
- `file_id` is content-addressed (sha256 of bytes) so re-importing the same deck does not
  duplicate it or bill every slide again.
- Course-list state is derived from counts, not stored, so a course cannot read "done" while
  some slides are still unexplained.

## Notes

- Build loop: `SPEC.md` (frozen bar) -> `STATE.md` (current round state, overwritten each round)
  -> `RUNLOG.md` (append-only history) -> git. STATE.md is the live "where is the loop" file.
- Durable project rules (deliberate, stated up front): the DeepSeek API key lives only in the OS
  keyring (service `lecture-companion`, account `deepseek-api-key`); `Courses/` is gitignored
  user data; course isolation is structural; `app/contracts.py` is the frozen interface contract
  (builder changes are an orchestrator decision, recorded in RUNLOG.md).
- Run `./run.sh` (serves on :8765). `LC_FAKE_MODEL=1 ./run.sh` exercises the whole pipeline,
  retrieval and frontend with no key and no spend. `.venv/bin/python -m pytest` runs offline and
  free.
- Public repo `northlight7/lecture-companion`; push at every round boundary. Never commit a key,
  credential, or the `Courses/` data.
- Known limits: the e5 path is implemented but unmeasured; complex `.pptx` (animations, embedded
  video, unusual fonts) is untested; the offline stub writes deliberately mechanical prose.
