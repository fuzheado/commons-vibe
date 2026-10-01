#!/bin/bash
# Shared spec runner for CommonsVibe's playwright-cli specs — sourced by
# tests/run.sh and tests/engine-matrix.sh so the pass/fail rule lives in ONE place.
#
# ── WHY THIS EXISTS (2026-10-01) ─────────────────────────────────────────────
# `playwright-cli run-code` ALWAYS exits 0 — even when the spec throws. Verified
# directly: a spec body of `async page => { throw new Error("x") }` exits 0.
# tests/run.sh used to gate on that exit code while sending stdout to /dev/null,
# so EVERY spec printed "✔ all assertions pass" unconditionally and the suite
# could not fail — a regression in the app would have shipped green.
#
# The only failure signals are on STDOUT:
#   "### Error"    → the spec threw (our specs throw the assertion summary)
#   "### Result"   → the spec returned normally
#   "is not open"  → no browser session; the spec never ran at all
# So: classify on the OUTPUT, never on the exit code. The "is not open" branch
# matters because that reply contains no "### Error" and would otherwise score
# as a pass.

# spec_log <spec.js> [session] → per-spec log path (kept outside the repo)
spec_log () {
  local tag=""
  [ -n "${2:-}" ] && tag="$2-"
  echo "/tmp/commons-vibe-spec-${tag}$(basename "$1" .js).log"
}

# run_spec <spec-path> <label> [session] → 0 = pass, 1 = fail (own diagnostics)
# With no session it targets the DEFAULT session (what tests/run.sh uses);
# tests/engine-matrix.sh passes an engine-specific session name instead.
run_spec () {
  local spec="$1" label="$2" session="${3:-}" log
  log="$(spec_log "$spec" "$session")"
  if [ -n "$session" ]; then
    playwright-cli -s="$session" run-code --filename="$spec" >"$log" 2>&1
  else
    playwright-cli run-code --filename="$spec" >"$log" 2>&1
  fi
  if grep -qE "is not open|listen EINVAL" "$log"; then
    echo "✘ $label — browser session unavailable, spec never ran"
    sed -n '1,3p' "$log" | sed 's/^/    /'
    echo "    open one first: playwright-cli open [--browser=firefox|webkit] http://127.0.0.1:8123/"
    return 1
  fi
  if grep -q '^### Error' "$log"; then
    echo "✘ $label — assertions failed:"
    sed -n '/^### Error/,$p' "$log" | grep -E '^FAIL' | head -25 | sed 's/^/    /'
    echo "    full output: $log"
    return 1
  fi
  if ! grep -q '^### Result' "$log"; then
    echo "✘ $label — no ### Result or ### Error marker; the run did not complete"
    echo "    full output: $log"
    return 1
  fi
  echo "✔ $label (log: $log)"
  return 0
}
