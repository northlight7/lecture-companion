# Lecture Companion — durable decisions

Project state lives in `PROJECT.md` (the shared record any tool reads cold). This file is the
tool-specific durable decisions.

Read `SPEC.md` for the bar (frozen). Read `STATE.md` for where the loop is.
`RUNLOG.md` is append-only history. `app/contracts.py` is the frozen interface
contract: every module imports its shared types from there.

## Hard rules

- `app/contracts.py` is read-only for builders. Changing it is an orchestrator
  decision, recorded in RUNLOG.md.
- The DeepSeek API key lives ONLY in the OS keyring
  (service `lecture-companion`, account `deepseek-api-key`). Never in a file,
  never in a log line, never in an HTTP response body. `/api/connection` returns
  a boolean and a masked hint, never the key.
- `Courses/` is user data and is gitignored. Never commit it.
- Course isolation is structural: serving course X reads nothing outside
  `Courses/<X>/`.

## Stack decisions (round 1)

| Choice | Why |
|---|---|
| `pypdfium2` render + `pypdf` text | permissive licence (unlike PyMuPDF's AGPL), wheels on macOS arm64, no system deps |
| `.pptx` -> PDF via `soffice --headless --convert-to pdf` | the only faithful renderer available locally (`/opt/homebrew/bin/soffice`); `python-pptx` supplies the text layer and speaker notes, and is the text-only fallback when soffice is absent |
| `intfloat/multilingual-e5-small` | 384-dim, retrieval-trained, ~118M params, trivial on 24 GiB; needs `query:` / `passage:` prefixes |
| Hashing embedder fallback | tests and CI must run without downloading torch; same 384 dims, deterministic |
| `index.jsonl` + numpy cosine | a course is hundreds of slides, not millions; a real vector DB is unjustified complexity |
| DeepSeek via raw `httpx` | avoids the `openai` dependency for one endpoint; the wire format is documented and stable |

## API facts (verified 2026-09-03, cite when relying on them)

- Base URL `https://api.deepseek.com`, OpenAI-compatible `/chat/completions`.
  <https://api-docs.deepseek.com/quick_start/pricing>
- Vision model `deepseek-v4-flash-vision-exp`; image content part is
  `{"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}`
  with an optional `detail` of low/high/original/auto.
  <https://api-docs.deepseek.com/guides/vision/>
- Limits: 48 MiB request body, 32 MiB per image, 600 images per request,
  8192 px per side, JPEG/PNG/GIF/WebP.
  <https://api-docs.deepseek.com/guides/vision/>
- Rate limiting surfaces as HTTP **429**.
  <https://api-docs.deepseek.com/quick_start/rate_limit>

## Running it

    ./run.sh                # creates .venv on first run, serves on :8765

    .venv/bin/python -m pytest        # offline, free, no key needed

`LC_FAKE_MODEL=1` forces the stub vision client, so the whole pipeline,
retrieval and frontend verify with no key and no spend.
