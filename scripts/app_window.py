#!/usr/bin/env python3
"""Drive the running Lecture Companion macOS app: capture it, click it, type at it.

The product is the native bundle, so visual and interaction checks run against the
real WKWebView window rather than a browser.

    .venv/bin/python scripts/app_window.py bounds
    .venv/bin/python scripts/app_window.py shot .internal/shots/home.png
    .venv/bin/python scripts/app_window.py click --rel 320 210
    .venv/bin/python scripts/app_window.py key return
    .venv/bin/python scripts/app_window.py type "Statistical Learning"
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

APP = "LectureCompanion"

# Key names osascript understands, mapped from the friendlier CLI spelling.
KEYS = {
    "return": 36, "enter": 36, "tab": 48, "space": 49, "escape": 53,
    "delete": 51, "down": 125, "up": 126, "left": 123, "right": 124,
}


def osascript(script: str) -> str:
    result = subprocess.run(
        ["osascript", "-e", script], capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        raise SystemExit(f"osascript failed: {result.stderr.strip()}")
    return result.stdout.strip()


def bounds() -> tuple[int, int, int, int]:
    """(x, y, width, height) of the app window in screen points, origin top-left."""
    raw = osascript(
        f'tell application "System Events" to tell process "{APP}" '
        f"to get {{position, size}} of window 1"
    )
    left, top, width, height = (
        int(value.strip()) for value in raw.replace("{", "").replace("}", "").split(",")
    )
    return left, top, width, height


def focus() -> None:
    osascript(f'tell application "System Events" to set frontmost of process "{APP}" to true')
    time.sleep(0.3)


def shot(path: str, whole_screen: bool = False) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    if whole_screen:
        subprocess.run(["screencapture", "-x", path], check=True)
    else:
        left, top, width, height = bounds()
        subprocess.run(
            ["screencapture", "-x", "-R", f"{left},{top},{width},{height}", path], check=True
        )
    print(path)


def click(x: int, y: int, relative: bool) -> None:
    if relative:
        left, top, _, _ = bounds()
        x, y = left + x, top + y
    focus()
    osascript(f'tell application "System Events" to click at {{{x}, {y}}}')
    time.sleep(0.7)
    print(f"clicked {x},{y}")


def key(name: str) -> None:
    code = KEYS.get(name.lower())
    if code is None:
        raise SystemExit(f"unknown key {name!r}, known: {', '.join(sorted(KEYS))}")
    focus()
    osascript(f'tell application "System Events" to key code {code}')
    time.sleep(0.4)


def type_text(text: str) -> None:
    focus()
    osascript(
        'tell application "System Events" to keystroke '
        + repr(text).replace("'", '"')
    )
    time.sleep(0.4)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("bounds")
    sub.add_parser("focus")

    capture = sub.add_parser("shot")
    capture.add_argument("path")
    capture.add_argument("--screen", action="store_true", help="whole screen, not just the window")

    press = sub.add_parser("click")
    press.add_argument("x", type=int)
    press.add_argument("y", type=int)
    press.add_argument("--rel", action="store_true", help="relative to the window origin")

    tap = sub.add_parser("key")
    tap.add_argument("name")

    typed = sub.add_parser("type")
    typed.add_argument("text")

    args = parser.parse_args()
    if args.cmd == "bounds":
        left, top, width, height = bounds()
        print(f"x={left} y={top} w={width} h={height}")
    elif args.cmd == "focus":
        focus()
    elif args.cmd == "shot":
        shot(args.path, whole_screen=args.screen)
    elif args.cmd == "click":
        click(args.x, args.y, args.rel)
    elif args.cmd == "key":
        key(args.name)
    elif args.cmd == "type":
        type_text(args.text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
