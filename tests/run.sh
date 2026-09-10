#!/bin/bash
# TDD runner for the 3D STL viewer.
#
#   tests/run.sh          → spec, then (on green) the recorded video tour
#
# Requires: local server on :8123 (python3 -m http.server 8123)
# Artifacts: tests/artifacts/stl-3d-tour.webm (final passing artifact)
#            tests/artifacts/tour-*.png (chapter screenshots)
set -e
cd "$(dirname "$0")/.."

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
