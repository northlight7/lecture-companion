#!/usr/bin/env python
"""Gate G2: the viewer must not overflow horizontally at 1440px.

Re-runnable evidence, not a claim. Drives a real headless Chromium against a
running server, walks Connect -> Courses -> Viewer, and asserts
`document.documentElement.scrollWidth <= document.documentElement.clientWidth`
on each screen, in both colour schemes. Writes screenshots for the critic.

    .venv/bin/python scripts/gate_g2.py --base http://127.0.0.1:8799 --course <id>

Exits non-zero, loudly, on the first overflow.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

WIDTH = 1440
HEIGHT = 900


def measure(page, label: str, shots: Path, scheme: str) -> tuple[bool, dict]:
    page.wait_for_timeout(600)
    m = page.evaluate(
        """() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            bodyScroll: document.body.scrollWidth,
            widest: (() => {
                let worst = null, w = 0;
                for (const el of document.querySelectorAll('*')) {
                    const r = el.getBoundingClientRect();
                    if (r.right > w) { w = r.right; worst = el; }
                }
                return worst ? `${worst.tagName}.${worst.className}`.slice(0, 80)
                             + ` right=${Math.round(w)}` : null;
            })(),
        })"""
    )
    ok = m["scrollWidth"] <= m["clientWidth"]
    shots.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(shots / f"{label}-{scheme}.png"), full_page=False)
    return ok, m


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8799")
    ap.add_argument("--course", required=True)
    ap.add_argument("--deck", required=True)
    ap.add_argument("--last", default="5")
    ap.add_argument("--shots", default=".internal/shots")
    args = ap.parse_args()

    shots = Path(args.shots)
    failures: list[str] = []
    console: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for scheme in ("light", "dark"):
            ctx = browser.new_context(
                viewport={"width": WIDTH, "height": HEIGHT},
                color_scheme=scheme,
            )
            page = ctx.new_page()
            page.on("console", lambda msg: console.append(f"[{msg.type}] {msg.text}")
                    if msg.type in ("error", "warning") else None)
            page.on("pageerror", lambda e: console.append(f"[pageerror] {e}"))

            screens = [
                ("courses", f"{args.base}/#/"),
                ("course", f"{args.base}/#/c/{args.course}"),
                ("viewer", f"{args.base}/#/c/{args.course}/{args.deck}/0"),
                ("viewer-last", f"{args.base}/#/c/{args.course}/{args.deck}/{args.last}"),
            ]
            for label, url in screens:
                page.goto(url, wait_until="networkidle")
                page.wait_for_timeout(1500)
                ok, m = measure(page, label, shots, scheme)
                if label.startswith("viewer"):
                    # The three screens all live in the DOM; only one is
                    # visible. Assert the VIEWER is the visible one and that it
                    # actually has a slide image and explanation prose in it,
                    # so a silent fallback to the course list cannot pass G2.
                    rendered = page.evaluate(
                        """() => {
                            const v = document.querySelector('#screen-viewer');
                            if (!v || v.offsetParent === null) return false;
                            const img = v.querySelector('img');
                            const prose = (v.innerText || '').trim();
                            return !!img && prose.length > 200;
                        }"""
                    )
                    if not rendered:
                        failures.append(
                            f"{label}/{scheme}: viewer did not render; "
                            "the page fell back to another screen, so this "
                            "measurement would be meaningless"
                        )
                        print(f"FAIL {label:8} {scheme:5} viewer did not render")
                status = "PASS" if ok else "FAIL"
                print(
                    f"{status} {label:8} {scheme:5} "
                    f"scrollWidth={m['scrollWidth']} clientWidth={m['clientWidth']}"
                    + ("" if ok else f"  widest={m['widest']}")
                )
                if not ok:
                    failures.append(f"{label}/{scheme}: {m}")
            ctx.close()
        browser.close()

    if console:
        print("\nConsole errors/warnings:")
        for line in dict.fromkeys(console):
            print("  ", line)

    print(f"\nScreenshots: {shots}")
    if failures:
        print("\nG2 FAILED:")
        for f in failures:
            print("  ", f)
        return 1
    print("\nG2 PASSED: no horizontal overflow at 1440px in either scheme.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
