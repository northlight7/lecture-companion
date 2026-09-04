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
