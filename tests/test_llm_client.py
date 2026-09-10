"""Gate G8 and invariant 4, for the DeepSeek client.

Every request here is served by an `httpx.MockTransport`. Nothing in this file
touches the network, and no test needs a key beyond the fake one below.
"""

from __future__ import annotations

import json
import re

import httpx
import pytest

from app.contracts import (
    DEEPSEEK_VISION_MODEL,
    IMAGE_DETAIL,
    BadModelOutput,
    ModelUnavailable,
    NoApiKey,
    RateLimited,
    SlideContext,
)
from app.llm import (
    MAX_TOKENS,
    TEMPERATURE,
    DeepSeekClient,
    FakeClient,
    parse_explanation_json,
    _scrub,
)

FAKE_KEY = "sk-abcdef1234567890"

GOOD_JSON = {
    "heading": "Lamport clocks",
    "body": "A logical counter per process gives a partial order over events.",
    "example": "Two messages sent from A to B always arrive with increasing counters.",
    "mermaid": "graph TD\n  A[Event] --> B[Counter]",
}


def make_ctx(**kw) -> SlideContext:
    base = dict(
        course_overview="Distributed Systems Foundations covers agreement under failure.",
        running_summary="- Slide 1: Physical clocks — Clock skew makes timestamps unreliable.",
        retrieved=[],
        slide_text="Lamport clocks\nA logical counter per process",
        slide_image_b64="aGVsbG8=",
        deck_title="Week 1",
        slide_index=1,
        n_slides=6,
    )
    base.update(kw)
    return SlideContext(**base)


def client_for(handler, **kw) -> DeepSeekClient:
    """A DeepSeekClient wired to a mock transport. No sockets are opened."""
    return DeepSeekClient(
        FAKE_KEY, transport=httpx.MockTransport(handler), timeout=5.0, **kw
    )


def reply(content: str, status: int = 200) -> httpx.Response:
    return httpx.Response(
        status,
        json={"choices": [{"message": {"content": content}}]},
    )


# --------------------------------------------------------------------------
# The wire format
# --------------------------------------------------------------------------


def test_the_request_body_matches_the_documented_deepseek_shape():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["auth"] = request.headers.get("Authorization")
        captured["body"] = json.loads(request.content.decode())
        return reply(json.dumps(GOOD_JSON))

    client = client_for(handler)
    exp = client.explain_slide(make_ctx())

    assert captured["method"] == "POST"
    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["auth"] == f"Bearer {FAKE_KEY}"

    body = captured["body"]
    assert body["model"] == DEEPSEEK_VISION_MODEL
    assert body["temperature"] == TEMPERATURE
    assert body["max_tokens"] == MAX_TOKENS == 900

    system, user = body["messages"]
    assert system["role"] == "system"
    assert user["role"] == "user"
    assert isinstance(user["content"], list)

    text_parts = [p for p in user["content"] if p["type"] == "text"]
    image_parts = [p for p in user["content"] if p["type"] == "image_url"]
    assert len(text_parts) == 1 and len(image_parts) == 1

    url = image_parts[0]["image_url"]["url"]
    assert url.startswith("data:image/png;base64,")
    assert url == "data:image/png;base64,aGVsbG8="
    assert image_parts[0]["image_url"]["detail"] == IMAGE_DETAIL

    assert exp.heading == "Lamport clocks"
    assert exp.body == GOOD_JSON["body"]
    assert exp.mermaid.startswith("graph TD")
    assert exp.model == DEEPSEEK_VISION_MODEL


def test_the_prompt_carries_the_labelled_context_blocks():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        captured["text"] = body["messages"][1]["content"][0]["text"]
        captured["system"] = body["messages"][0]["content"]
        return reply(json.dumps(GOOD_JSON))

    client_for(handler).explain_slide(make_ctx())

    text = captured["text"]
    for header in (
        "## Course overview",
        "## What this course has covered so far",
        "## Relevant earlier material",
        "## This slide (Week 1, 2 of 6)",
    ):
        assert header in text, f"missing {header!r}"
    # The grounding instruction is not optional.
    assert "only what this slide actually shows" in captured["system"]
    assert "Do NOT invent content" in captured["system"]
    assert "between 100 and 180 words" in captured["system"]
    assert "define it in plain words" in captured["system"]
    assert "Do not use an em dash character" in captured["system"]


def test_learner_facing_punctuation_is_normalized():
    fields = parse_explanation_json(json.dumps({
        "heading": "Risk—return",
        "body": "Beta is technical; it measures market sensitivity—roughly.",
        "example": "One stock; one comparison.",
        "mermaid": "",
    }))
    assert "—" not in fields["heading"] + fields["body"] + fields["example"]
    assert ";" not in fields["heading"] + fields["body"] + fields["example"]


# --------------------------------------------------------------------------
# G8: status mapping
# --------------------------------------------------------------------------


def test_429_raises_rate_limited_with_the_retry_after_header():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "42"}, text="slow down")

    with pytest.raises(RateLimited) as info:
        client_for(handler).explain_slide(make_ctx())
    assert info.value.retry_after == 42.0


def test_429_without_a_header_defaults_to_five_seconds():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="slow down")

    with pytest.raises(RateLimited) as info:
        client_for(handler).explain_slide(make_ctx())
    assert info.value.retry_after == 5.0


@pytest.mark.parametrize("status", [500, 502, 503])
def test_5xx_raises_model_unavailable(status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="upstream exploded")

    with pytest.raises(ModelUnavailable):
        client_for(handler).explain_slide(make_ctx())


@pytest.mark.parametrize("status", [401, 403])
def test_401_and_403_raise_no_api_key_with_a_clear_message(status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="bad key")

    with pytest.raises(NoApiKey) as info:
        client_for(handler).explain_slide(make_ctx())
    message = str(info.value)
    assert "key" in message.lower()
    assert str(status) in message


def test_a_transport_error_raises_model_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with pytest.raises(ModelUnavailable):
        client_for(handler).explain_slide(make_ctx())


def test_a_timeout_raises_model_unavailable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    with pytest.raises(ModelUnavailable):
        client_for(handler).explain_slide(make_ctx())


def test_no_key_at_construction_raises_no_api_key():
    with pytest.raises(NoApiKey):
        DeepSeekClient("")


# --------------------------------------------------------------------------
# Defensive parsing
# --------------------------------------------------------------------------


def test_a_fenced_json_response_parses():
    fenced = "```json\n" + json.dumps(GOOD_JSON) + "\n```"

    def handler(request: httpx.Request) -> httpx.Response:
        return reply(fenced)

    exp = client_for(handler).explain_slide(make_ctx())
    assert exp.body == GOOD_JSON["body"]


def test_a_prose_wrapped_json_object_parses():
    wrapped = (
        "Sure! Here is the explanation you asked for:\n\n"
        + json.dumps(GOOD_JSON)
        + "\n\nLet me know if you would like a different angle."
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return reply(wrapped)

    exp = client_for(handler).explain_slide(make_ctx())
    assert exp.heading == "Lamport clocks"
    assert exp.example == GOOD_JSON["example"]


def test_garbage_raises_bad_model_output_after_exactly_one_retry():
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode())
        calls.append(body["messages"][1]["content"][0]["text"])
        return reply("I am afraid I cannot help with that.")

    with pytest.raises(BadModelOutput):
        client_for(handler).explain_slide(make_ctx())

    assert len(calls) == 2, "expected the first attempt plus exactly one retry"
    assert "return ONLY the JSON object" in calls[1] or "Return ONLY the JSON" in calls[1]
    assert "ONLY the JSON" in calls[1]


def test_a_retry_that_returns_good_json_succeeds():
    state = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["n"] += 1
        if state["n"] == 1:
            return reply("no json here, sorry")
        return reply(json.dumps(GOOD_JSON))

    exp = client_for(handler).explain_slide(make_ctx())
    assert state["n"] == 2
    assert exp.body == GOOD_JSON["body"]


def test_a_malformed_mermaid_is_dropped_not_fatal():
    payload = dict(GOOD_JSON, mermaid="here is a picture of a cat, not a diagram")

    def handler(request: httpx.Request) -> httpx.Response:
        return reply(json.dumps(payload))

    exp = client_for(handler).explain_slide(make_ctx())
    assert exp.body == GOOD_JSON["body"]
    assert exp.mermaid == ""


def test_a_styled_mermaid_is_dropped_because_it_breaks_the_theme_swap():
    payload = dict(
        GOOD_JSON,
        mermaid="graph TD\n  A --> B\n  classDef big fill:#fff\n",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return reply(json.dumps(payload))

    assert client_for(handler).explain_slide(make_ctx()).mermaid == ""


def test_an_empty_body_is_bad_model_output():
    with pytest.raises(BadModelOutput):
        parse_explanation_json(json.dumps({"heading": "x", "body": "  "}))


def test_missing_optional_keys_are_just_empty_strings():
    fields = parse_explanation_json(json.dumps({"body": "the explanation"}))
    assert fields == {
        "heading": "",
        "body": "the explanation",
        "example": "",
        "mermaid": "",
    }


# --------------------------------------------------------------------------
# test_connection never raises
# --------------------------------------------------------------------------


def test_test_connection_reports_ok_and_is_text_only():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content.decode())
        return reply("ok")

    ok, detail = client_for(handler).test_connection()
    assert ok is True
    assert DEEPSEEK_VISION_MODEL in detail
    # Cheap: no image part, a small token cap.
    assert captured["body"]["max_tokens"] <= 32
    assert json.dumps(captured["body"]).count("image_url") == 0


@pytest.mark.parametrize("status", [401, 429, 500])
def test_test_connection_never_raises(status):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="nope")

    ok, detail = client_for(handler).test_connection()
    assert ok is False
    assert detail
    assert FAKE_KEY not in detail


def test_test_connection_never_raises_on_a_transport_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("no route to host", request=request)

    ok, detail = client_for(handler).test_connection()
    assert ok is False
    assert FAKE_KEY not in detail


# --------------------------------------------------------------------------
# Invariant 4: the key never leaks
# --------------------------------------------------------------------------


def test_scrub_removes_a_known_key_and_anything_key_shaped():
    assert FAKE_KEY not in _scrub(f"failed with key {FAKE_KEY}")
    assert "sk-0987654321zzzz" not in _scrub("Authorization: Bearer sk-0987654321zzzz")
    assert "REDACTED" in _scrub(f"key={FAKE_KEY}")
    # A short, non-key-shaped string is left alone.
    assert _scrub("no secrets here") == "no secrets here"


def test_the_key_never_appears_in_a_repr_or_a_str():
    client = client_for(lambda request: reply(json.dumps(GOOD_JSON)))
    assert FAKE_KEY not in repr(client)
    assert FAKE_KEY not in str(client)
    assert FAKE_KEY not in repr(client.__dict__.get("model", ""))


@pytest.mark.parametrize(
    "handler_kind", ["401", "429", "500", "timeout", "transport", "garbage", "html"]
)
def test_the_key_never_appears_in_any_exception_message(handler_kind):
    """Every failure path, including ones whose body echoes the key back."""

    def handler(request: httpx.Request) -> httpx.Response:
        if handler_kind == "timeout":
            raise httpx.ReadTimeout(f"timed out talking to {FAKE_KEY}", request=request)
        if handler_kind == "transport":
            raise httpx.ConnectError(f"refused for {FAKE_KEY}", request=request)
        if handler_kind == "garbage":
            return reply("not json at all")
        if handler_kind == "html":
            # An upstream proxy that helpfully echoes the request back at us.
            return httpx.Response(
                500, text=f"<html>bad gateway, Authorization: Bearer {FAKE_KEY}</html>"
            )
        return httpx.Response(
            int(handler_kind), text=f"error for key {FAKE_KEY}"
        )

    client = client_for(handler)
    with pytest.raises(Exception) as info:
        client.explain_slide(make_ctx())

    message = str(info.value)
    assert FAKE_KEY not in message, message
    assert not re.search(r"sk-[A-Za-z0-9]{8,}", message), message


def test_a_400_body_echoing_the_key_is_scrubbed():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text=f"bad request from {FAKE_KEY}")

    with pytest.raises(BadModelOutput) as info:
        client_for(handler).explain_slide(make_ctx())
    assert FAKE_KEY not in str(info.value)


# --------------------------------------------------------------------------
# The stub, which is what everything else in the suite runs on
# --------------------------------------------------------------------------


def test_the_fake_client_is_derived_from_its_context_not_a_constant():
    client = FakeClient()
    a = client.explain_slide(make_ctx())
    b = client.explain_slide(
        make_ctx(slide_text="Quorums\nOverlapping read and write sets", slide_index=4)
    )
    assert a.body != b.body
    assert "quorums" in b.body.lower()
    # It echoes a verbatim phrase from the overview, which is how G5 is checked.
    assert " ".join(make_ctx().course_overview.split()[:6]) in a.body
    assert client.calls == [("Week 1", 1), ("Week 1", 4)]


def test_the_fake_client_injects_the_requested_failure():
    client = FakeClient(fail_on=[("Week 1", 1)], error=RateLimited)
    with pytest.raises(RateLimited):
        client.explain_slide(make_ctx())
    # A different slide is unaffected.
    assert client.explain_slide(make_ctx(slide_index=2)).body
    assert client.calls == [("Week 1", 1), ("Week 1", 2)]


def test_the_fake_client_never_reports_a_broken_connection():
    ok, detail = FakeClient().test_connection()
    assert ok is True
    assert "no spend" in detail
