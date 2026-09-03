#!/usr/bin/env bash
# Lecture Companion: one-command start.
#   ./run.sh              serve on http://127.0.0.1:8765
#   LC_PORT=9000 ./run.sh serve on another port
#   LC_FAKE_MODEL=1 ./run.sh   stub the vision client (no key, no spend)
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VENV=".venv"
PY="$VENV/bin/python"
PORT="${LC_PORT:-8765}"
STAMP="$VENV/.deps-stamp"

if [ ! -x "$PY" ]; then
  echo "==> creating $VENV"
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.12 "$VENV"
  else
    python3 -m venv "$VENV"
  fi
fi

# Reinstall only when the dependency declaration changed. `pyproject.toml`
# is the only input to the install, so its mtime is a sufficient stamp.
if [ ! -f "$STAMP" ] || [ pyproject.toml -nt "$STAMP" ]; then
  echo "==> installing dependencies"
  if command -v uv >/dev/null 2>&1; then
    uv pip install --python "$PY" -e ".[dev]"
  else
    "$VENV/bin/pip" install --upgrade pip >/dev/null
    "$VENV/bin/pip" install -e ".[dev]"
  fi
  touch "$STAMP"
else
  echo "==> dependencies up to date (delete $STAMP to force a reinstall)"
fi

echo
echo "    Lecture Companion -> http://127.0.0.1:${PORT}"
echo

exec "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT"
