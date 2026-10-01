#!/bin/bash
# TDD runner: version-consistency guard, then every behavioural spec —
# viewer (in-app media viewer), category-search (type-ahead combobox),
# header-collapse (touch header), wrongcase-cat (case-doppelgänger guard),
# thumb-recovery (broken-thumbnail recovery, v1.16), STL (3D viewer),
# engine-quirks (cross-engine facts + portability guards).
#
#   tests/run.sh                 → guard, specs, then (on green) the recorded video tour
#   tests/engine-matrix.sh       → the same specs on Chromium + Firefox + WebKit
#
# Requires: a local server on :8123 (python3 -m http.server 8123) AND an open
#           playwright browser in the default session (`playwright-cli open`) —
#           the specs run via `playwright-cli run-code`, which needs one.
#           The version guard is static and needs neither.
#
# NOTE: this runner gates on the spec OUTPUT, not on playwright-cli's exit code,
# which is always 0 even when a spec throws. See tests/spec-lib.sh for the why.
#
# Artifacts: tests/artifacts/stl-3d-tour.webm (final passing artifact)
#            tests/artifacts/tour-*.png (chapter screenshots)
set -e
cd "$(dirname "$0")/.."
# shellcheck source=tests/spec-lib.sh
source tests/spec-lib.sh

echo "▶ Running version-consistency guard (static, no browser)..."
bash tests/version-consistency.sh || {
  echo "✘ version guard failed — the app version disagrees across app.js/index.html"
  exit 1
}

echo "▶ Running specs (playwright-cli run-code)..."
run_spec tests/viewer.spec.js          "viewer spec (issue #23 — in-app media viewer)" || exit 1
run_spec tests/category-search.spec.js "category-search spec (type-ahead combobox)"   || exit 1
run_spec tests/header-collapse.spec.js "header-collapse spec (issue #17, touch)"      || exit 1
run_spec tests/wrongcase-cat.spec.js   "wrong-case-cat spec (CirrusSearch case leak)" || exit 1
run_spec tests/thumb-recovery.spec.js  "thumb-recovery spec (v1.16)"                  || exit 1
run_spec tests/stl.spec.js             "STL spec (3D viewer)"                         || exit 1
run_spec tests/engine-quirks.spec.js   "engine-quirks spec (cross-engine facts)"      || exit 1

mkdir -p tests/artifacts
echo "▶ Recording video tour..."
playwright-cli video-start tests/artifacts/stl-3d-tour.webm >/dev/null
playwright-cli run-code --filename=tests/stl-tour.js >/dev/null && echo "✔ tour complete" || echo "⚠ tour had errors (video still saved)"
playwright-cli video-stop >/dev/null
echo "✔ artifact: tests/artifacts/stl-3d-tour.webm"
