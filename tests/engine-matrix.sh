#!/bin/bash
# Cross-engine matrix — run every behavioural spec on Chromium, Firefox and WebKit.
#
#   tests/engine-matrix.sh                 # all three engines
#   tests/engine-matrix.sh firefox webkit  # a subset
#
# Why this exists (2026-10-01): tests/run.sh only ever exercised the DEFAULT
# session, which is bundled Chromium. Running the same specs on the other two
# engines found four real divergences — one genuine app fragility (the header
# tap-zone restore was bound to `pointerdown` alone) and three engine-dependent
# test assumptions. See "Cross-engine notes" in HANDOFF.md.
#
# Requires a local server on :8123:  python3 -m http.server 8123
#
# Session names are kept SHORT on purpose: playwright-cli derives a UNIX socket
# path from the session name, and a long one overflows the path limit and dies
# with `listen EINVAL`. ("iso-firefox-header-collapse" was long enough to fail.)
set -u
cd "$(dirname "$0")/.."
# shellcheck source=tests/spec-lib.sh
source tests/spec-lib.sh

BASE=http://127.0.0.1:8123
SPECS="viewer category-search header-collapse wrongcase-cat thumb-recovery stl engine-quirks"
ENGINES="${*:-chromium firefox webkit}"

curl -sf -o /dev/null "$BASE/" || {
  echo "✘ no server on :8123 — start one:  python3 -m http.server 8123"
  exit 1
}

n=0
fails=0
for eng in $ENGINES; do
  n=$((n + 1))
  sess="mx$n"
  playwright-cli -s="$sess" close >/dev/null 2>&1
  # NOTE: "--browser=chromium" is REJECTED by playwright-cli; the default *is*
  # bundled Chromium, so chromium must be opened with no --browser flag.
  if [ "$eng" = chromium ]; then
    playwright-cli -s="$sess" open "$BASE/" >"/tmp/mx-$eng.open.log" 2>&1
  else
    playwright-cli -s="$sess" open --browser="$eng" "$BASE/" >"/tmp/mx-$eng.open.log" 2>&1
  fi
  if grep -qE "is not open|listen EINVAL" "/tmp/mx-$eng.open.log"; then
    echo "✘ [$eng] browser failed to open"
    sed -n '1,3p' "/tmp/mx-$eng.open.log" | sed 's/^/    /'
    fails=$((fails + 1))
    continue
  fi

  echo "── $eng ──────────────────────────────────────────────"
  for spec in $SPECS; do
    run_spec "tests/$spec.spec.js" "[$eng] $spec" "$sess" || fails=$((fails + 1))
  done
  playwright-cli -s="$sess" close >/dev/null 2>&1
  echo
done

if [ "$fails" -eq 0 ]; then
  echo "✔ engine matrix: every spec passed on: $ENGINES"
  exit 0
fi
echo "✘ engine matrix: $fails spec run(s) failed"
exit 1
