# Lecture Companion — FROZEN SPEC (the bar)

Status: frozen at Round 1. Read-only for builders. Revisions appear only as a
clearly-marked `## Revision N` section, and only after being recorded in RUNLOG.md.

## The effort

A local web app (Python FastAPI backend, one-command start, no-build browser
frontend) that turns uploaded lecture slides into a per-course plain-language
textbook, for a new MSc student.

- **Connect screen**: one field to paste a DeepSeek API key, stored in the OS
  keyring (never in the repo), a test-connection call, and a green "Connected"
  badge you can reopen to change the key. Base URL `https://api.deepseek.com`,
  model `deepseek-v4-flash-vision-exp`, OpenAI-compatible chat/completions,
  images sent as a base64 `data:` URL in `content`.
- **Setup / import**: select an existing course or create a new one, then upload
  its files (PDF + .pptx) to that course only. Every course is a sealed container
  (its own slides, reference docs, overview, and memory). Files are filed
  automatically as slides vs reference doc (syllabus or program requirements), no
  review step, and a course overview is distilled from the reference docs. A bulk
  drop with no course selected is a shortcut: the app sorts a pile into courses on
  its own.
- **Viewer**: course list -> two-pane view. Left the rendered slide, right a
  plain-language explanation with a concrete example where it fits and a small
  diagram (mermaid) only when it helps, so the sequence reads like one coherent
  textbook.
- **Per-slide pipeline**: extract slide image + text -> build context = course
  overview + running plain-language summary + top-k relevant prior explanations
  from vector search scoped to this course only -> DeepSeek vision -> explanation,
  then store, embed, update the running summary, index. Retrieval and memory never
  cross course boundaries. Generation is remote (network, paid, key-gated);
  retrieval embeddings run locally from a small multilingual model.

## The goal

Good means a student can open a real course's slides and get, for every slide, an
explanation that is (a) grounded in what that slide actually shows, (b) aware of
what the course covered before, and (c) never polluted by another course.
Features are the means, not the bar.

## Invariants, never regressed

1. **Course isolation.** Explaining a slide in course A pulls zero content or
   memory from course B.
2. **Grounding.** The explanation is faithful to the actual slide; it does not
   invent claims the slide does not support.
3. **End to end.** The app boots, imports a course, and produces an explanation
   for every slide.
4. **No secret leaks.** No API key or credential is ever committed, logged, or
   written to a visible file. The key lives only in the OS keyring.
5. **Resumable and idempotent.** Pausing mid-course and resuming never re-calls
   the model for a slide already explained; it continues exactly from the first
   unfinished slide. An interrupt is a pause, never a loss of position.
6. **Truthful repo.** README and any docs describe what the app actually does,
   not a plan.

## Gates (each runnable, each fails loudly)

| # | Gate | Check |
|---|------|-------|
| G1 | Boot | the documented start command launches the server; `curl -s localhost:<port>/api/health` returns `{"ok": true}` |
| G2 | No horizontal overflow | screenshot at 1440px where `document.documentElement.scrollWidth <= document.documentElement.clientWidth` evaluates true on the viewer |
| G3 | Slide extraction | a fixture PDF of known page count yields that many page images and non-empty extracted text; asserted by a test |
| G4 | Import filing | a fixture folder (a PDF plus a syllabus doc) is classified and filed into the right folder and right role; asserted by a test |
| G5 | End-to-end generation | with the model stubbed, a slideshow produces exactly one non-empty explanation per slide, each referencing the course overview; asserted by a test |
| G6 | Course isolation | a test enriches course A then processes course B and asserts zero course-A chunks in course B's context |
| G7 | Resume | a test processes two slides, simulates a pause (kill mid-run or fake a 429), then resumes and asserts only the unfinished slides call the model and the total is exactly one explanation per slide |
| G8 | Rate-limit pause | a test makes the generation client return a 429 and asserts the app emits a paused/retry state, not an error that loses position |
| G9 | No key in repo | over committed files, `git grep -iE "sk-\|api_key\|secret"` returns no real secret and local files are gitignored |
| G10 | Repo clean and synced | at a round boundary `git status` is clean and `origin/main` equals local `main` after a push |
| G11 | Docs accurate | the README describes actually-implemented behavior; a documented feature with no code is a fail |

## Critic protocol

- Verdict is binary: **pass** or **fail**.
- The critic opens the actual artifact (running app, screenshots, extracted
  files, test output), never a summary.
- Fixed read order: this SPEC first, then the artifact, then the verdict.
- Blind authorship: the critic is never told who produced the work.
- The critic is a falsifier: it builds the strongest case the work FAILS, and
  each criterion is backed by a quote from the artifact, never a paraphrase.
- At least one gate per round is non-LLM (a run, a render, a diff, a grep).
- On failure it names the single biggest gap.
- If two critics disagree, tighten the bar and re-judge.

## Exit

- Primary: two consecutive independent fresh-critic passes.
- Failsafe: 20 rounds or 8 hours, whichever first.
- Escalation: after 5 rejected attempts on one item, switch approach or emit
  a single `BLOCKED` line.

## Operating limits

- The DeepSeek key is never hardcoded, committed, logged, or exfiltrated.
- No paid API calls unless a key is configured by the human. A `FAKE`/stub mode
  for the model client verifies the pipeline, RAG, and frontend offline and free.
- Never fabricate: an explanation must be traceable to the slide's actual
  extracted content.
- Label every claim `measured` (with the re-runnable command) or `modeled`
  (with the method). Cite the URL for anything sourced externally.
- Public repo discipline: push to `northlight7/lecture-companion` at every round
  boundary, keep README and docs truthful, never commit a key, credential, or
  `Courses/` user data.
