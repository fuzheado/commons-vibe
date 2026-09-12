#!/bin/bash
# TDD runner for the 3D STL viewer, plus the version-consistency guard.
#
#   tests/run.sh          → guard, specs, then (on green) the recorded video tour
#
# Requires: a local server on :8123 (python3 -m http.server 8123) AND an open
#           playwright browser in the default session (`playwright-cli open`) —
#           the specs run via `playwright-cli run-code`, which needs one.
#           The version guard is static and needs neither.
# Artifacts: tests/artifacts/stl-3d-tour.webm (final passing artifact)
#            tests/artifacts/tour-*.png (chapter screenshots)
set -e
cd "$(dirname "$0")/.."

echo "▶ Running version-consistency guard (static, no browser)..."
bash tests/version-consistency.sh || {
  echo "✘ version guard failed — the app version disagrees across app.js/index.html"
  exit 1
}

echo "▶ Running viewer spec (issue #23 — in-app media viewer, no new tabs)..."
playwright-cli run-code --filename=tests/viewer.spec.js >/dev/null 2>&1 && echo "✔ viewer spec: all assertions pass" || {
  echo "✘ viewer spec failed — run 'playwright-cli run-code --filename=tests/viewer.spec.js' for details"
  exit 1
}

echo "▶ Running header-collapse spec (issue #17, touch context)..."
playwright-cli run-code --filename=tests/header-collapse.spec.js >/dev/null 2>&1 && echo "✔ header-collapse spec: all assertions pass" || {
  echo "✘ header spec failed — run 'playwright-cli run-code --filename=tests/header-collapse.spec.js' for details"
  exit 1
}

echo "▶ Running wrong-case-cat spec (CirrusSearch case leak, v1.14.1)..."
playwright-cli run-code --filename=tests/wrongcase-cat.spec.js >/dev/null 2>&1 && echo "✔ wrong-case-cat spec: all assertions pass" || {
  echo "✘ wrong-case spec failed — run 'playwright-cli run-code --filename=tests/wrongcase-cat.spec.js' for details"
  exit 1
}

echo "▶ Running STL spec..."
playwright-cli run-code --filename=tests/stl.spec.js >/dev/null 2>&1 && echo "✔ spec: all assertions pass" || {
  echo "✘ spec failed — run 'playwright-cli run-code --filename=tests/stl.spec.js' for details"
  exit 1
}

mkdir -p tests/artifacts
echo "▶ Recording video tour..."
playwright-cli video-start tests/artifacts/stl-3d-tour.webm >/dev/null
playwright-cli run-code --filename=tests/stl-tour.js >/dev/null && echo "✔ tour complete" || echo "⚠ tour had errors (video still saved)"
playwright-cli video-stop >/dev/null
echo "✔ artifact: tests/artifacts/stl-3d-tour.webm"
