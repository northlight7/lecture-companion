"""The only component that spends money: the DeepSeek vision client.

Also the place invariant 2 (grounding) is won or lost, because the prompt is
here. And invariant 4 (no secret leaks): the key is read from the keyring, put
in exactly one header, and scrubbed out of every exception message this module
constructs.

Wire format is OpenAI-compatible chat/completions, sourced from
api-docs.deepseek.com and recorded in CLAUDE.md:

* POST `{base_url}/chat/completions`, `Authorization: Bearer <key>`
* the user message `content` is a list of parts; the image part is
  `{"type": "image_url", "image_url": {"url": "data:image/png;base64,...",
   "detail": "high"}}`
* rate limiting surfaces as HTTP 429
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable, Iterable, Sequence

import httpx

from app import config, keystore
from app.contracts import (
    DEEPSEEK_BASE_URL,
    DEEPSEEK_VISION_MODEL,
    IMAGE_DETAIL,
    BadModelOutput,
    Explanation,
    IndexRow,
    ModelUnavailable,
    NoApiKey,
    RateLimited,
    SlideContext,
    VisionClient,
)

log = logging.getLogger(__name__)

#: Generation is meant to be faithful, not creative.
TEMPERATURE = 0.3
MAX_TOKENS = 1600
SUMMARY_MAX_TOKENS = 900


#: Separates instructions from the source material inside a `summarise` prompt.
#: A real model reads the whole prompt; a stub uses this to echo only the
#: source text, so offline mode never surfaces the instructions as if they
#: were course content.
CONTENT_MARKER = "\n--- SOURCE MATERIAL ---\n"

#: Anything that looks like a DeepSeek key, scrubbed from every message we
#: construct even if the key itself is unknown to us at that point.
_KEY_PATTERN = re.compile(r"sk-[A-Za-z0-9]{8,}")
_REDACTED = "sk-***REDACTED***"

# --------------------------------------------------------------------------
# The prompt. Grounding lives here.
# --------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You explain one lecture slide at a time to a new MSc student who is working \
through a course in order, and who is meeting this material for the first \
time. Write plain, direct language. Assume intelligence, not background.

Rules you must not break:

1. Describe only what this slide actually shows. The slide image and its \
extracted text are your subject; everything else is context for framing.
2. If the slide is thin (a title, a single bullet, one figure), say what it \
means and why it appears at this point in the course. Do NOT invent content \
the slide does not support, and do not pad it out with material from your own \
knowledge presented as if it were on the slide.
3. Never state a fact that neither the slide nor the provided course context \
supports. If something on the slide is ambiguous, say so plainly rather than \
guessing.
4. Connect this slide to earlier material when it genuinely follows from it \
(you may refer to an earlier slide by its number, e.g. "as in slide 4"). If \
the connection is not real, do not manufacture one.
5. Give a concrete example only when one clarifies the slide. An empty string \
is a correct answer for `example`.
6. The diagram is optional. Return a mermaid diagram ONLY when the slide \
describes a structure, a flow, a sequence, or a relationship that is worth \
drawing; otherwise return "" for `mermaid`. When you do return one, use plain \
`graph TD`, `flowchart TD`, or `sequenceDiagram` syntax with no styling, no \
classDef, no click handlers and no colour directives, because it is rendered \
in both a light and a dark theme.

Return STRICT JSON and nothing else. No prose before or after, no code fence. \
The object has exactly these keys:

{"heading": "a short title for this slide",
 "body": "the plain-language explanation, markdown allowed",
 "example": "a concrete example, or an empty string",
 "mermaid": "mermaid source, or an empty string"}
"""

RETRY_REMINDER = (
    "Your previous reply could not be parsed. Return ONLY the JSON object with "
    'the keys "heading", "body", "example" and "mermaid". No code fence, no '
    "commentary, no text before or after the object."
)

#: Prompt-side truncation. Mirrors the budget in pipeline.py; both are module
#: constants so the whole context budget is tunable in one read.
PROMPT_MAX_SLIDE_TEXT_CHARS = 6000


def _words(text: str, limit: int) -> str:
    parts = (text or "").split()
    if len(parts) <= limit:
        return text or ""
    return " ".join(parts[:limit]) + " ..."


def render_retrieved(rows: Sequence[IndexRow]) -> str:
    """Each retrieved chunk labelled with its slide number, so the model can
    refer back to it in the explanation ("as in slide 4")."""
    if not rows:
        return "(nothing earlier in this course is closely related.)"
    out: list[str] = []
    for row in rows:
        out.append(f"- From slide {row.slide_index + 1}: {row.text.strip()}")
    return "\n".join(out)


def build_prompt_text(ctx: SlideContext) -> str:
    """The text part of the user message. Clearly labelled, clearly separated.

    The critic reads this, so the section headers are stable and the ordering
    goes broad -> recent -> specific -> this slide.
    """
    slide_text = (ctx.slide_text or "").strip()[:PROMPT_MAX_SLIDE_TEXT_CHARS]
    if not slide_text:
        slide_text = "(this slide has no extracted text; work from the image.)"

    overview = (ctx.course_overview or "").strip() or "(no course overview available.)"
    summary = (ctx.running_summary or "").strip() or (
        "(this is the beginning of the course; nothing has been covered yet.)"
    )

    return (
        "## Course overview\n"
        f"{overview}\n\n"
        "## What this course has covered so far\n"
        f"{summary}\n\n"
        "## Relevant earlier material\n"
        f"{render_retrieved(ctx.retrieved)}\n\n"
        f"## This slide ({ctx.deck_title}, {ctx.slide_index + 1} of {ctx.n_slides})\n"
        "Extracted text:\n"
        f"{slide_text}\n\n"
        "The slide image follows. Explain this slide, grounded in what it "
        "actually shows, for a student who has read everything above. Return "
        "only the JSON object."
    )


def build_messages(ctx: SlideContext, *, reminder: str = "") -> list[dict[str, Any]]:
    """The full `messages` array, image included as a base64 data URL."""
    text = build_prompt_text(ctx)
    if reminder:
        text = f"{text}\n\n{reminder}"
    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    if ctx.slide_image_b64:
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{ctx.slide_image_b64}",
                    "detail": IMAGE_DETAIL,
                },
            }
        )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": content},
    ]


# --------------------------------------------------------------------------
# Defensive JSON parsing
# --------------------------------------------------------------------------

_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)


def _outermost_object(text: str) -> str | None:
    """Find the first balanced `{...}` in `text`, ignoring braces in strings."""
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_explanation_json(text: str) -> dict[str, str]:
    """Pull the explanation object out of whatever the model actually said.

    Handles: a bare object, a ```json fence, and an object surrounded by prose.
    Raises `BadModelOutput` when there is no usable object or no `body`.
    """
    raw = (text or "").strip()
    if not raw:
        raise BadModelOutput("the model returned an empty response")

    candidates: list[str] = []
    fence = _FENCE_RE.search(raw)
    if fence:
        candidates.append(fence.group(1).strip())
    candidates.append(raw)
    obj_slice = _outermost_object(raw)
    if obj_slice:
        candidates.append(obj_slice)

    data: dict[str, Any] | None = None
    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except ValueError:
            inner = _outermost_object(candidate)
            if not inner:
                continue
            try:
                parsed = json.loads(inner)
            except ValueError:
                continue
        if isinstance(parsed, dict):
            data = parsed
            break

    if data is None:
        raise BadModelOutput(
            "could not find a JSON object in the model response: "
            f"{_scrub(raw[:300])!r}"
        )

    def _str(key: str) -> str:
        value = data.get(key, "")
        if isinstance(value, str):
            return value.strip()
        if value is None:
            return ""
        return str(value).strip()

    body = _str("body")
    if not body:
        raise BadModelOutput("the model response has no non-empty 'body'")

    mermaid = _str("mermaid")
    if mermaid and not _mermaid_looks_sane(mermaid):
        # Invariant: a bad diagram must not cost us the slide. Drop it.
        log.info("dropping malformed mermaid from a model response")
        mermaid = ""

    return {
        "heading": _str("heading"),
        "body": body,
        "example": _str("example"),
        "mermaid": mermaid,
    }


_MERMAID_HEADS = (
    "graph ",
    "flowchart ",
    "sequencediagram",
    "classdiagram",
    "statediagram",
    "erdiagram",
    "mindmap",
    "journey",
    "gantt",
    "pie",
)


def _mermaid_looks_sane(src: str) -> bool:
    """Cheap plausibility check. A diagram we cannot recognise is dropped."""
    text = src.strip()
    if text.startswith("```"):
        text = _FENCE_RE.sub(r"\1", text).strip()
    if not text:
        return False
    first = text.splitlines()[0].strip().lower()
    if not any(first.startswith(head) for head in _MERMAID_HEADS):
        return False
    lowered = text.lower()
    # Styling directives break the light/dark theme swap in the viewer.
    if "classdef" in lowered or "style " in lowered or "click " in lowered:
        return False
    return True


# --------------------------------------------------------------------------
# Secret scrubbing (invariant 4)
# --------------------------------------------------------------------------

_extra_secrets: list[str] = []


def register_secret(value: str | None) -> None:
    """Teach the scrubber about a key we hold, so it can be removed literally."""
    if value and len(value) >= 8 and value not in _extra_secrets:
        _extra_secrets.append(value)


def _scrub(text: object) -> str:
    """Remove anything that looks like, or is, an API key.

    Applied to every message this module puts into an exception or a log line.
    """
    out = text if isinstance(text, str) else str(text)
    for secret in _extra_secrets:
        if secret:
            out = out.replace(secret, _REDACTED)
    out = _KEY_PATTERN.sub(_REDACTED, out)
    # Never let a raw Authorization header survive either.
    out = re.sub(
        r"(?i)(authorization\s*[:=]\s*)(bearer\s+)?\S+", r"\1" + _REDACTED, out
    )
    return out


# --------------------------------------------------------------------------
# DeepSeek
# --------------------------------------------------------------------------


class DeepSeekClient:
    """OpenAI-compatible vision client for DeepSeek."""

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str = DEEPSEEK_BASE_URL,
        model: str = DEEPSEEK_VISION_MODEL,
        timeout: float = 120.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        key = api_key if api_key is not None else keystore.get_key()
        if not key:
            raise NoApiKey(
                "No DeepSeek API key is configured. Add one on the connect "
                "screen; it is stored in the OS keyring."
            )
        self._key = key
        register_secret(key)
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.name = f"deepseek:{model}"
        self._transport = transport

    # The key must never reach a log, a traceback frame dump, or a repr.
    def __repr__(self) -> str:
        return f"<DeepSeekClient model={self.model!r} base_url={self.base_url!r}>"

    __str__ = __repr__

    # -- transport --------------------------------------------------------

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self.timeout, transport=self._transport)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "application/json",
        }

    def _post(self, payload: dict[str, Any]) -> str:
        """POST chat/completions and return the assistant's text content.

        Maps transport and status failures onto the contract's error types.
        Every message is scrubbed before it leaves this method.
        """
        url = f"{self.base_url}/chat/completions"
        try:
            with self._client() as client:
                resp = client.post(url, headers=self._headers(), json=payload)
        except httpx.TimeoutException as exc:
            raise ModelUnavailable(
                f"the model timed out after {self.timeout:g}s: {_scrub(exc)}"
            ) from None
        except httpx.TransportError as exc:
            raise ModelUnavailable(
                f"could not reach the model: {_scrub(exc)}"
            ) from None

        status = resp.status_code
        if status == 429:
            raise RateLimited(
                "DeepSeek is rate limiting this key; pausing.",
                retry_after=_retry_after(resp),
            )
        if status in (401, 403):
            raise NoApiKey(
                "DeepSeek rejected the API key (HTTP "
                f"{status}). Open the connect screen and set a valid key."
            )
        if status >= 500:
            raise ModelUnavailable(
                f"DeepSeek returned HTTP {status}: {_scrub(_body_snippet(resp))}"
            )
        if status >= 400:
            raise BadModelOutput(
                f"DeepSeek returned HTTP {status}: {_scrub(_body_snippet(resp))}"
            )

        try:
            data = resp.json()
        except ValueError:
            raise BadModelOutput(
                f"DeepSeek returned non-JSON: {_scrub(_body_snippet(resp))}"
            ) from None
        return _content_of(data)

    # -- the protocol -----------------------------------------------------

    def _payload(self, messages: list[dict[str, Any]], max_tokens: int) -> dict[str, Any]:
        return {
            "model": self.model,
            "messages": messages,
            "temperature": TEMPERATURE,
            "max_tokens": max_tokens,
        }

    def explain_slide(self, ctx: SlideContext) -> Explanation:
        text = self._post(self._payload(build_messages(ctx), MAX_TOKENS))
        try:
            fields = parse_explanation_json(text)
        except BadModelOutput as first:
            log.info("model output was not parseable, retrying once: %s", _scrub(first))
            retry_text = self._post(
                self._payload(
                    build_messages(ctx, reminder=RETRY_REMINDER), MAX_TOKENS
                )
            )
            fields = parse_explanation_json(retry_text)  # raises if it fails again
        return Explanation(
            deck_id="",  # the pipeline stamps identity; the client does content
            slide_index=ctx.slide_index,
            body=fields["body"],
            example=fields["example"],
            mermaid=fields["mermaid"],
            heading=fields["heading"],
            model=self.model,
            context_used=[r.chunk_id for r in ctx.retrieved],
        )

    def summarise(self, prompt: str) -> str:
        messages = [
            {
                "role": "system",
                "content": (
                    "You write short, factual summaries of course material for "
                    "a student. Use only what you are given; never add facts "
                    "from your own knowledge. Return prose, no preamble."
                ),
            },
            {"role": "user", "content": prompt},
        ]
        return self._post(self._payload(messages, SUMMARY_MAX_TOKENS)).strip()

    def test_connection(self) -> tuple[bool, str]:
        """A cheap, text-only call. Never raises."""
        messages = [{"role": "user", "content": "Reply with the single word: ok"}]
        try:
            reply = self._post(self._payload(messages, 16))
        except NoApiKey as exc:
            return False, _scrub(str(exc))
        except RateLimited as exc:
            return False, f"Connected, but rate limited: {_scrub(str(exc))}"
        except (ModelUnavailable, BadModelOutput) as exc:
            return False, _scrub(str(exc))
        except Exception as exc:  # never raise out of a connection test
            return False, _scrub(f"{type(exc).__name__}: {exc}")
        return True, f"Connected to {self.model} ({reply.strip()[:40] or 'ok'})"


def _retry_after(resp: httpx.Response) -> float:
    raw = resp.headers.get("Retry-After") or resp.headers.get("retry-after")
    if raw:
        try:
            return max(0.0, float(str(raw).strip()))
        except ValueError:
            pass
    return 5.0


def _body_snippet(resp: httpx.Response, limit: int = 300) -> str:
    try:
        return resp.text[:limit]
    except Exception:  # pragma: no cover - defensive
        return "<unreadable body>"


def _content_of(data: Any) -> str:
    if not isinstance(data, dict):
        raise BadModelOutput("the model response was not a JSON object")
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise BadModelOutput("the model response had no choices")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, list):  # some gateways return content parts
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    if not isinstance(content, str):
        raise BadModelOutput("the model response had no text content")
    return content


# --------------------------------------------------------------------------
# The offline stub
# --------------------------------------------------------------------------


def _first_line(text: str) -> str:
    for line in (text or "").splitlines():
        line = line.strip()
        if line:
            return line
    return ""


def _distinctive_phrase(text: str, n: int = 6) -> str:
    """A short verbatim slice of the overview, so a test can prove the
    explanation actually saw it."""
    words = (text or "").split()
    if not words:
        return ""
    return " ".join(words[:n])


def _terms(text: str, limit: int = 8) -> list[str]:
    """Real terms lifted from the slide, longest first, deduped."""
    seen: dict[str, None] = {}
    for token in re.findall(r"[A-Za-z][\w-]{3,}", text or ""):
        key = token.lower()
        if key not in seen:
            seen[key] = None
    ordered = sorted(seen, key=lambda t: (-len(t), t))
    return ordered[:limit]


def _mermaid_label(term: str) -> str:
    """A mermaid-safe node label: quotes and brackets break the parser."""
    cleaned = re.sub(r'[^\w \-]', "", str(term)).strip()
    return (cleaned[:28] or "term")


class FakeClient:
    """A deterministic stand-in for DeepSeek. No network, no spend.

    It is deliberately *derived from the actual SlideContext* rather than a
    constant, so the offline pipeline verifies something real: the body quotes
    terms that were on the slide, echoes a verbatim phrase from the course
    overview (which is what gate G5 asserts), and lists the chunk_ids it was
    given. Anything it says can be traced to its input.

    Fault injection for the resume and pause tests:

        FakeClient(fail_on=[(deck_id, 3)], error=RateLimited)

    `calls` records every `(deck_id, slide_index)` asked for, and `prompts`
    records the full assembled prompt text, which is how the isolation test
    proves no course-A vocabulary reached the client.
    """

    name = "fake"

    def __init__(
        self,
        *,
        fail_on: Iterable[tuple[str, int]] = (),
        error: type[Exception] | Callable[[], Exception] = RateLimited,
        fail_times: int | None = None,
    ) -> None:
        self.fail_on = {(str(d), int(i)) for d, i in fail_on}
        self.error = error
        #: How many times a fail_on slide keeps failing. None = always.
        self.fail_times = fail_times
        self._failures: dict[tuple[str, int], int] = {}
        self.calls: list[tuple[str, int]] = []
        self.prompts: list[str] = []
        self.contexts: list[SlideContext] = []
        self.summarise_calls: list[str] = []

    # -- helpers ----------------------------------------------------------

    def _raise(self) -> None:
        err = self.error
        try:
            exc = err() if callable(err) else err
        except TypeError:  # pragma: no cover - defensive
            exc = RateLimited()
        if isinstance(exc, BaseException):
            raise exc
        raise RateLimited()  # pragma: no cover

    # -- the protocol -----------------------------------------------------

    def explain_slide(self, ctx: SlideContext) -> Explanation:
        # `SlideContext` carries no deck id (the pipeline owns identity), but
        # fault injection and the resume test's `calls` assertions need one.
        # `pipeline.build_context` stamps `_deck_id` on the context for exactly
        # this; `deck_title` is the fallback for a hand-built context.
        deck_id = getattr(ctx, "_deck_id", "") or ctx.deck_title
        key = (deck_id, ctx.slide_index)

        self.calls.append(key)
        self.prompts.append(build_prompt_text(ctx))
        self.contexts.append(ctx)

        if key in self.fail_on:
            n = self._failures.get(key, 0)
            if self.fail_times is None or n < self.fail_times:
                self._failures[key] = n + 1
                self._raise()

        heading = _first_line(ctx.slide_text) or (
            f"{ctx.deck_title} slide {ctx.slide_index + 1}"
        )
        terms = _terms(ctx.slide_text)
        overview_echo = _distinctive_phrase(ctx.course_overview)

        parts = [
            f"This slide, {ctx.slide_index + 1} of {ctx.n_slides} in "
            f"{ctx.deck_title}, sets out: {heading}.",
        ]
        if terms:
            parts.append(
                "It works with the terms "
                + ", ".join(terms)
                + ", which are the words the slide itself puts on the page."
            )
        else:
            parts.append(
                "The slide carries no extracted text. The offline stub cannot "
                "see the image, so it has nothing to describe here; the real "
                "model reads the image and would."
            )
        if overview_echo:
            parts.append(
                "In the context of the course overview "
                f'("{overview_echo}"), this is where that thread continues.'
            )
        if ctx.retrieved:
            refs = ", ".join(
                f"slide {row.slide_index + 1}" for row in ctx.retrieved
            )
            parts.append(f"It follows on from earlier material: {refs}.")

        body = " ".join(parts)
        example = (
            f"Concretely: picture applying {terms[0]} to a single worked case "
            "from this week's lab."
            if terms
            else ""
        )
        # Emit a diagram on roughly every third slide, so the offline path
        # actually exercises mermaid rendering (and its light/dark theming)
        # instead of leaving that code permanently untested. A real model
        # decides for itself; the stub just has to reach the same code path.
        mermaid = ""
        if len(terms) >= 3 and ctx.slide_index % 3 == 2:
            # Only claim what is actually true: these terms appear on this
            # slide. An earlier version drew A --> B --> C, which asserted
            # relationships the slide never states — a fabrication sitting in
            # the field the viewer renders as content. A real model is asked
            # to draw real structure; the stub has no business inventing any.
            root = _mermaid_label(heading or f"Slide {ctx.slide_index + 1}")
            lines = [f'graph TD\n  S["{root}"]']
            for n, term in enumerate(terms[:3]):
                lines.append(f'  S --> T{n}["{_mermaid_label(term)}"]')
            mermaid = "\n".join(lines)

        return Explanation(
            deck_id="",
            slide_index=ctx.slide_index,
            body=body,
            example=example,
            mermaid=mermaid,
            heading=heading[:120],
            model=self.name,
            context_used=[row.chunk_id for row in ctx.retrieved],
        )

    def summarise(self, prompt: str) -> str:
        self.summarise_calls.append(prompt)
        # Echo the SOURCE MATERIAL in compressed form: deterministic, and
        # traceable. Everything before CONTENT_MARKER is instructions addressed
        # to the model, not course content, so echoing it would put prompt
        # boilerplate on screen as though it were the course overview.
        text = prompt or ""
        if CONTENT_MARKER in text:
            text = text.rsplit(CONTENT_MARKER, 1)[1]
        lines = [
            ln.strip()
            for ln in text.splitlines()
            if ln.strip() and not ln.lstrip().startswith("###")
        ]
        return _words(" ".join(lines), 220)

    def test_connection(self) -> tuple[bool, str]:
        return True, "Fake model (LC_FAKE_MODEL): no network, no spend."


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------


def get_client() -> VisionClient:
    """`FakeClient` under LC_FAKE_MODEL, else a real `DeepSeekClient`.

    Raises `NoApiKey` when a real client is wanted and no key is stored, which
    is the signal for the UI to show the connect screen.
    """
    if config.fake_model():
        return FakeClient()
    key = keystore.get_key()
    if not key:
        raise NoApiKey(
            "No DeepSeek API key is configured. Add one on the connect screen, "
            "or set LC_FAKE_MODEL=1 to run the pipeline offline."
        )
    return DeepSeekClient(key)


__all__ = [
    "DeepSeekClient",
    "FakeClient",
    "get_client",
    "build_prompt_text",
    "build_messages",
    "parse_explanation_json",
    "register_secret",
    "CONTENT_MARKER",
    "SYSTEM_PROMPT",
    "TEMPERATURE",
    "MAX_TOKENS",
]
