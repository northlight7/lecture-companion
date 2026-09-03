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
