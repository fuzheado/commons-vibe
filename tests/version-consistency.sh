#!/bin/bash
# Version-consistency guard — catches the drift fixed 2026-09-11, when the footer
# badge and the app.js header comment still said v1.11 while UA_NOTE said v1.14.1.
#
# Static check: no browser, no local server, no network. Run it from tests/run.sh
# (it goes first) or directly:
#
#   tests/version-consistency.sh
set -e
cd "$(dirname "$0")/.."

fail() { echo "✘ version-consistency: $1"; exit 1; }

# 1. app.js declares VERSION — the single source of truth.
V=$(sed -n 's/^const VERSION = "\([0-9][0-9.]*\)";.*/\1/p' app.js | head -1)
[ -n "$V" ] || fail 'app.js has no `const VERSION = "X.Y.Z";` declaration'
echo "  VERSION const   : $V"

# 2. UA_NOTE must interpolate it, never hardcode a version.
UA=$(grep -E '^const UA_NOTE' app.js || true)
[ -n "$UA" ] || fail 'app.js has no UA_NOTE declaration'
echo "$UA" | grep -q 'CommonsVibeExplorer/\${VERSION} ' || fail 'UA_NOTE must contain CommonsVibeExplorer/${VERSION}'
echo "$UA" | grep -qE 'CommonsVibeExplorer/[0-9]' && fail 'UA_NOTE hardcodes a version literal — interpolate ${VERSION}' || true

# 3. The footer badge must be wired to VERSION at boot, with a no-JS fallback in HTML.
grep -q 'versionEl.textContent = `v\${VERSION}`' app.js || fail 'init() does not set #app-version from VERSION'
HTML=$(sed -n 's/.*<span id="app-version">v\([0-9][0-9.]*\)<\/span>.*/\1/p' index.html | head -1)
[ -n "$HTML" ] || fail 'index.html needs <span id="app-version">vX.Y.Z</span> as the no-JS fallback'
echo "  html fallback   : $HTML"
[ "$HTML" = "$V" ] || fail "index.html fallback is v$HTML but VERSION is v$V"

# 4. The header comment is the first line a human reads — keep it honest.
CMT=$(sed -n 's/^\/\* CommonsVibe[^(]*(v\([0-9][0-9.]*\).*/\1/p' app.js | head -1)
[ -n "$CMT" ] || fail 'could not parse the version from the app.js header comment'
echo "  header comment  : $CMT"
[ "$CMT" = "$V" ] || fail "app.js header comment is v$CMT but VERSION is v$V"

echo "✔ version-consistency: all 4 sites agree on v$V"
