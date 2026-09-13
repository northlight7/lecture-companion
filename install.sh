#!/usr/bin/env bash
# Install Lecture Companion, or update the copy already installed.
#
#   ./install.sh              build, install to /Applications, launch, verify
#   ./install.sh --no-launch  build and install, leave the app closed
#
# Installing and updating are the same operation on purpose. The app bundle is
# replaced whole, and the reader's work is in the per-user application data
# directory, which this script only ever writes to when it is migrating an
# older checkout for the first time. Nothing it does can lose a course.
#
# The installed app runs the backend out of this project, which is what makes
# development fast: a backend change needs only a restart, and this script is
# for changes to the interface or the launcher. When the app is ready for other
# people, the backend moves inside the bundle and that dependency goes away.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Lecture Companion"
INSTALLED="/Applications/${APP_NAME}.app"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$ROOT/launcher/Info.plist")"
DATA_ROOT="${LC_DATA_ROOT:-$HOME/Library/Application Support/LectureCompanion}"
LIBRARY="$DATA_ROOT/library"
LOG="$HOME/Library/Logs/LectureCompanion/launcher.log"
LAUNCH=1

for arg in "$@"; do
  case "$arg" in
    --no-launch) LAUNCH=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n==> %s\n' "$1"; }

# ---------------------------------------------------------------- the backend

say "checking the backend"
if [ ! -x "$ROOT/.venv/bin/python" ]; then
  echo "This project has no virtualenv. Run ./run.sh once to create it, then" >&2
  echo "run this script again." >&2
  exit 1
fi
echo "backend: $ROOT/.venv/bin/python"

# ------------------------------------------------------------- the migration

# One time only. An older install kept the courses inside the checkout, which
# meant a clean, a fresh clone or a sync conflict could take a reader's work
# with it. They move to the data directory now, and they are copied rather than
# moved, then checked, and only then removed from the checkout.
say "checking for courses left in the checkout"
if [ -d "$ROOT/Courses" ] && [ -n "$(ls -A "$ROOT/Courses" 2>/dev/null)" ]; then
  if [ -n "$(ls -A "$LIBRARY" 2>/dev/null)" ]; then
    echo "Both $ROOT/Courses and $LIBRARY have content, so nothing was moved."
    echo "Look at both, keep the one you want, and delete the other by hand."
  else
    mkdir -p "$LIBRARY"
    ditto "$ROOT/Courses" "$LIBRARY"
    before=$(find "$ROOT/Courses" -type f | wc -l | tr -d ' ')
    after=$(find "$LIBRARY" -type f | wc -l | tr -d ' ')
    if [ "$before" != "$after" ]; then
      echo "Copied $after of $before files, so the copy is incomplete." >&2
      echo "Nothing was deleted. The originals are still in $ROOT/Courses." >&2
      exit 1
    fi
    rm -rf "$ROOT/Courses"
    echo "moved $after file(s) to $LIBRARY"
  fi
else
  echo "nothing to move"
fi

# ----------------------------------------------------------------- the build

say "building"
"$ROOT/launcher/build-app.sh" | tail -2

# --------------------------------------------------------------- the install

say "installing to /Applications"
# Built, then swapped. The old copy stays as `.old` until the new one answers a
# health check, so a failed update leaves something to go back to.
STAGING="/Applications/.${APP_NAME}.staging"
rm -rf "$STAGING"
ditto "$ROOT/$APP_NAME.app" "$STAGING"

pkill -f "MacOS/LectureCompanion" 2>/dev/null || true
sleep 1
pkill -f "uvicorn app.main:app" 2>/dev/null || true

rm -rf "${INSTALLED}.old"
if [ -d "$INSTALLED" ]; then
  mv "$INSTALLED" "${INSTALLED}.old"
fi
mv "$STAGING" "$INSTALLED"

# The app is installed away from the project, so it has to be told where the
# backend lives. A preference rather than a hardcoded path, because the same
# build can be installed against any checkout.
defaults write "$BUNDLE_ID" ProjectRoot "$ROOT"

VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INSTALLED/Contents/Info.plist")
echo "installed version $VERSION, pointed at $ROOT"

if [ "$LAUNCH" = "0" ]; then
  say "not launching, as asked"
  echo "The previous copy is at ${INSTALLED}.old until you remove it."
  exit 0
fi

# ------------------------------------------------------------ the check

say "launching"
# The launcher creates this directory on its first run, but the check below
# wants to read the log from the moment the app starts, so make it now.
mkdir -p "$(dirname "$LOG")"
: > "$LOG"
open "$INSTALLED"

PORT=""
for _ in $(seq 1 60); do
  PORT=$(grep -o 'Uvicorn running on http://127\.0\.0\.1:[0-9]*' "$LOG" 2>/dev/null | tail -1 | grep -o '[0-9]*$' || true)
  [ -n "$PORT" ] && break
  sleep 1
done

if [ -z "$PORT" ]; then
  echo "The backend did not come up in 60 seconds." >&2
  echo "The log is $LOG." >&2
  echo "The previous copy is still at ${INSTALLED}.old." >&2
  exit 1
fi

if ! curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "The backend answered on port $PORT but not on /api/health." >&2
  exit 1
fi

COURSES=$(curl -sf "http://127.0.0.1:$PORT/api/courses" | grep -o '"id"' | wc -l | tr -d ' ')

say "running"
echo "version $VERSION on port $PORT, $COURSES course(s) in $LIBRARY"
rm -rf "${INSTALLED}.old"
echo
echo "Updates are this same command. Nothing in $DATA_ROOT is touched."
