"""A fallback overview must stay retryable.

Regression test for a bug found only by running against the live API: a single
transient model failure recorded the reference-file ids as consumed, so
`refresh_overview_if_needed` never tried again and a course that HAD a syllabus
described itself as having none, permanently.
"""
from __future__ import annotations

from app.contracts import ModelUnavailable
from app.overview import refresh_overview_if_needed


class _Flaky:
    """Fails the first summarise call, succeeds afterwards."""

    name = "flaky"

    def __init__(self) -> None:
        self.calls = 0

    def summarise(self, prompt: str) -> str:
        self.calls += 1
        if self.calls == 1:
            raise ModelUnavailable("transient")
        return "A real distilled overview of the course."

    def explain_slide(self, ctx):  # pragma: no cover - unused here
        raise NotImplementedError

    def test_connection(self):  # pragma: no cover - unused here
        return True, "ok"


def test_transient_failure_leaves_overview_retryable(store):
    course = store.create_course("Retry Me")
    store.save_ref_text(course.id, "ref1", "Syllabus. Grading is 40/60.")
    client = _Flaky()

    assert refresh_overview_if_needed(store, course.id, client) is True
    first = store.get_course(course.id)
    assert client.calls == 1
    # It fell back, so the refs must NOT be recorded as consumed.
    assert first.overview_source_ids == [], (
        "a fallback recorded its sources, so it would never be retried"
    )

    # The next refresh must try again, and succeed.
    assert refresh_overview_if_needed(store, course.id, client) is True
    second = store.get_course(course.id)
    assert client.calls == 2
    assert second.overview == "A real distilled overview of the course."
    assert second.overview_source_ids == ["ref1"]

    # And once it has succeeded, it must stop rebuilding.
    assert refresh_overview_if_needed(store, course.id, client) is False
    assert client.calls == 2
