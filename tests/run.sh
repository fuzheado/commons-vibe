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

echo "▶ Running STL spec..."
playwright-cli run-code --filename=tests/stl.spec.js >/dev/null 2>&1 && echo "✔ spec: all assertions pass" || {
  echo "✘ spec failed — run 'playwright-cli run-code --filename=tests/stl.spec.js' for details"
  exit 1
}

mkdir -p tests/artifacts
echo "▶ Recording video tour..."
playwright-cli video-start tests/artifacts/stl-3d-tour.webm >/dev/null
playwright-cli run-code --filename=tests/stl-tour.js >/dev/null && echo "✔ tour complete" || echo "⚠ tour had errors (video still saved)"
playwright-cli video-stop tests/artifacts/stl-3d-tour.webm >/dev/null
echo "✔ artifact: tests/artifacts/stl-3d-tour.webm"
