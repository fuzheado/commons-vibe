# CommonsVibe — Project Handoff

_Last updated: 2026-09-11. Read this first if you're continuing work on this project._

## What this is

A stateless, URL-driven visual discovery tool for Wikimedia Commons categories — a
"Pinterest-style" masonry feed (detailed/minimal views, alphabetical or random-shuffle
ordering, per-tile category drawer for jumping around the category graph).
Live at **https://commons-vibe.toolforge.org/**.

## Current state (updated 2026-10-02, v1.23 shipped with this commit; v1.15–v1.22 deployed)

- **2026-10-02 — case-faithful, wrapped tile titles (v1.23, this commit).** DET
  tiles rendered filenames ALL CAPS (`uppercase tracking-widest`) and truncated
  to one line (`truncate`), so long names were cut off and case was lost. The
  h3 now renders mixed case and wraps: `leading-snug break-words` replaces
  `uppercase tracking-widest truncate`. Dropping caps + tracking also frees
  ~30% of the line width — most names now fit fully on one line ("20231126
  Former Hankou Railway Station.jpg" used to render as "20231126 FORMER HANKOU
  RAILWAY ST…"). Measured on real data: 783-file WLM China sample, max title
  81 chars → 2 lines; Louvre worst case (138-char König title) → 3 lines,
  +14px on a 485px card (+2.9%). Masonry is unaffected by construction —
  `placeCard()` measures `card.offsetHeight` per card and the media box is
  aspect-ratio-driven, so title-height variance is absorbed exactly like
  image-height variance. No new Tailwind pinning needed: `break-words` and
  `leading-snug` already occur in `index.html`, so the JIT compiles them at
  first paint (the v1.21 trap only hit utilities exclusive to app-generated
  HTML). The print/PDF sheet inherits the change — full mixed-case names there.
  Regression: `tests/title-wrap.spec.js` (10 assertions — computed-style
  contract + a real 138-char title wraps to 3 lines with no overflow).

- **2026-10-02 — export dialog (v1.22, issue #30 phase 1, this commit).** New
  **Export** button in the header (next to ⚡ Lite) opens a dialog modelled on the
  tree modal. Scope: **this feed** (the tiles drawn this session — backed by the
  new `state.feedPages`, populated in `renderPages`, reset by `resetAndFetch`
  and `redrawFeedInPlace`) or **my clips** (the v1.18 collection; fetched
  fresh, batched 50 titles per call since the collection is titles-only in
  localStorage). Limit: 12/24/50/100/500/all. Formats: **JSON** (versioned
  envelope — `tool`, `version`, `exported`, `scope`, `source`, `count`, `files[]`
  — the future re-import/shareable-session seed), **CSV** (11 columns, RFC-4180
  quoting), **plain text** (bare `File:` list, one per line), **wiki gallery**
  (`<gallery mode="packed">` with description captions; `|`/newlines stripped).
  Every format has a live preview, **Copy** (`navigator.clipboard`) and
  **Download** (`Blob` → `commonsvibe-<scope>-<source>-<n>.<ext>`, `.wiki` for
  the gallery). Metadata is quick-mode only: whatever the tile already carries
  (title, description, hidden-filtered categories, file/page/thumb URLs,
  dimensions, mime, mediatype) — the feed's 2-key `iiextmetadatafilter` trim
  means artist/license are absent; that is the enriched pass of issue #30
  phase 2, and the dialog says so in its note.
  **PDF/Print** button calls `window.print()` — the `@media print` block in
  `style.css` re-lays the feed as a light-themed 3-column contact sheet
  (masonry columns flattened with `display: contents` so the sheet paginates),
  hides all chrome, keeps each card intact (`break-inside: avoid`), and a
  `beforeprint` listener labels the sheet `CommonsVibe — <source> — <n> files
  — commons-vibe.toolforge.org` (hidden `#print-header`). No jsPDF/vendor —
  the browser's own print-to-PDF is the renderer (CSP-safe, zero bytes).
  Verified end to end by rendering a 48-tile sample:
  `cache/export-sample/commonsvibe-print-sample.pdf` (gitignored artifact).
  Regression: `tests/export.spec.js` (21 assertions) — empty-feed disabled
  states, per-format previews (CSV header/Files, TXT bare list, JSON envelope
  parses, wiki gallery tags), limit slicing, download file naming, clips-scope
  fetch. The export dialog is intentionally **not** in the URL contract:
  it is a transient view of state already in the URL (feed) or in localStorage
  (clips).

- **2026-10-02 — lite toggle preserves the feed (v1.21, this PR).** Reported:
  toggling lite in shuffle mode reshuffled everything. Root cause chain:
  (a) `toggleLite` called `resetAndFetch`, which redraws from fresh random
  draws — replaced with `redrawFeedInPlace()`: imageinfo for exactly the
  on-screen titles (batched 50, `ttl: 0`, new width), rebuilt in the same
  order; `seenTitles`/`continueToken`/`hasReachedEnd`/`deepWalk`/list cursor
  all preserved, so every mode keeps its position and the drawn set.
  (b) Even with (a), the masonry placement drifted across the toggle — two
  real bugs found by a MutationObserver measuring placement-time geometry:
  **aspect-ratio** used the API's per-width thumb dims (480×360 vs 330×248 —
  rounded differently per requested width) → now uses the ORIGINAL file dims
  (`iiprop` gains `size`), identical in every mode; and **Tailwind JIT
  latency**: `line-clamp-3`/`truncate`/`text-[11px]`/`leading-relaxed`/
  `gap-y-2` exist only in app-generated HTML, so batch 1 was placed before
  the JIT compiled them — unclamped descriptions made cards 10–48px taller
  and EVERY cold load's column assignment was subtly wrong (any reflow
  shifted tiles). Those five utilities are now pinned in `style.css` with
  identical values, so first placement = final placement. Also added
  `html { scrollbar-gutter: stable; }` (no-op where scrollbars are overlay,
  prevents width wobble where they take space) and the `window.__cvState`
  spec hook.
  (c) `tests/stl.spec.js` broke for an unrelated reason: the live category's
  alphabetically-first STL file changed (now a 16:9 landscape poster, ~160px
  tall), so the hardcoded +90px vertical drag exited the tile mid-drag →
  pointerleave disposed the rig → camera null. Drag distances now derive from
  the tile's real bounding box, and 5b/5c wait for the registry before
  reading the camera. Regression: `tests/lite.spec.js` extended to 22
  assertions (visual-order preservation in shuffle, both directions).

- **2026-10-02 — lite mode (v1.20, this PR).** Speed-over-quality toggle, first
  class UI control: the ⚡ **Lite** chip in the header (next to S/M/L). Full mode
  is untouched (480 request → 500px bucket + 960w retina candidate). In lite,
  the three feed calls request `iiurlwidth=feedThumbWidth()` — the smallest
  thumbnail-ladder bucket ≥ the slot width (250/330px in S/M densities, 960/1280
  in L so nothing is upscaled) — and `srcsetFor` never declares retina (2×)
  candidates. Measured gain (3-file sample, Category:Quality images of China,
  re-measured 2026-10-02): retina default ~213KB/tile → lite 330px
  ~18–41KB/tile ≈ **7× less image data**; DPR-1 users ~55% less (64→29KB). The **viewer always stays high-res** (1600 request
  → 1920px bucket) — skim in lite, inspect in full. Precedence: URL param
  `lite=1`/`lite=0` > localStorage `vibe_lite` > off; the toggle persists per
  device and `lite=1` in a shared URL carries the choice to the recipient.
  Different requested width = different cache key, so modes never poison each
  other's cached API responses. Regression: `tests/lite.spec.js` (15 assertions).
- **2026-10-01 — vendored Tailwind + smaller Fix-images button (v1.19).**
  Tailwind Play CDN was the app's only third-party script — every visitor contacted
  `cdn.tailwindcss.com` (and it drove the Toolforge CSP console violation). It is now
  **vendored same-origin** (`vendor/tailwindcdn-3.4.16.js`, pinned 3.4.16, MIT),
  verified in-browser: zero third-party requests, all utilities still applying
  (runtime JIT works identically from our origin). The Play CDN build's own
  "should not be used in production" console warning remains — it is baked into the
  script, console-only, and tracked under open item 4 (full precompile into
  `style.css` would remove it). The amber **Fix images** button was also shrunk a
  step (text 9px→8px/bold, padding p-1 px-1.5, icon 2.5, no shadow) after feedback
  that it dominated the header.
- **2026-10-01 — clips / personal collection (v1.18).** First slice of the
  "Personal Collections" roadmap item: every tile and the viewer footer carry a
  bookmark **Clip** button; clipped files persist in a new `vibe_clips` localStorage
  key (File: titles, newest first) and a header chip (hidden while empty) shows the
  count. Clicking it opens the **clips feed** — list mode with `source: 'clips'`, so
  batching, size/view/type toggles and list-order rendering are reused, not
  duplicated. URL param `?clips=1` boots/round-trips the feed (local-only by
  nature — the collection lives in the browser, no account). Unclipping inside the
  clips feed drops the tile in place (reflow, no reload) and shows End of
  Collection when the feed empties. Regression: `tests/clips.spec.js` (17
  assertions). Still open: named/multiple collections, export (copy file list /
  PagePile-style share), a "remove" affordance distinct from the clip toggle.
- **2026-10-01 — v1.17 deployed.** v1.16 (broken-thumb recovery) had already been
  deployed from `main`; v1.17 (cross-engine hardening) is now also live — SHA256
  verified local = server = live (`app.js` `ef1c8c7c…`, `index.html` `2a8fc56b…`),
  live smoke test green (12/12 tiles, v1.17 badge, URL contract intact).
- **2026-10-01 — cross-engine hardening (v1.17).** The suite had only ever
  run on the default Playwright session, which is bundled Chromium. Running the same
  specs on Firefox and WebKit surfaced four divergences; § Cross-engine notes has the
  measured facts and the workarounds they justify.
  * **The test gate could not fail — fixed first, since everything else depended on
    it.** `playwright-cli run-code` ALWAYS exits 0, even when the spec throws, and
    `run.sh` gated on that exit code while sending stdout to `/dev/null` — so every
    spec printed `✔ all assertions pass` unconditionally, and a real regression would
    have shipped green. Gating now classifies on the spec's OUTPUT (`### Error` /
    `### Result` / `is not open`) in one shared place, `tests/spec-lib.sh`.
    `thumb-recovery.spec.js` was the one spec that RETURNED its failure counts instead
    of throwing, so it had no `### Error` line to detect; it now throws like the rest.
  * **Header tap-zone restore — an app fix, not a spec fix.** The restore was bound to
    `pointerdown` alone, and the `click` branch only swallowed a trailing click that
    `pointerdown` had already armed. Firefox's programmatic mouse input delivers
    `mousedown`+`click` with NO `pointerdown`, so the header stayed stuck collapsed.
    The `click` branch now performs the restore itself when nothing armed it (existing
    swallow semantics preserved). Latent for real users — genuine Firefox input always
    fires `pointerdown` — but it was a real dependency on one input event.
  * **Four spec-side corrections:** the `header-collapse` env probe required
    `maxTouchPoints > 0` on top of the coarse-pointer query the app actually gates on
    (Firefox/WebKit never set it); the `stl` scroll step assumed one wheel tick equals
    one batch (Firefox scrolls ~575px per tick vs WebKit's ~1276px, so a tick could
    trigger no request at all and the step waited 25s for it); the viewer's
    "really opened a new tab" assertion dispatched a SYNTHETIC ctrl-click, which only
    Chromium acts on — and on macOS ctrl+click is a secondary click in every engine,
    so it now uses a real click with the platform's modifier (Cmd); and the
    `header-collapse` outside-zone step sampled the collapsed state immediately, racing
    the rAF frame that carries the (directional) scroll delta — the new gate caught
    that as a one-off flake at scrollY 1200 before the state was waited for instead.
  * **New tooling:** `tests/engine-matrix.sh` (every spec on all three engines) and
    `tests/engine-quirks.spec.js` (the engine facts as executable assertions).

- **2026-10-01 — broken-thumbnail recovery (v1.16, this PR).** Tiles that failed to
  load used to stay empty until a page reload — unacceptable in shuffle mode, where
  reloading discards the drawn set. Four changes:
  * **Recover in place.** One capture-phase `error` listener on `document` covers the
    grid, the viewer and every future batch (no per-`<img>` wiring). Per tile: drop
    `srcset`/`sizes`, refetch the 1x thumb with a cache-busting `thumbretry=N` param
    (a bare re-assignment of the same URL often refetches nothing — browsers
    negative-cache failed images), then two more attempts at 1s/3s backoff, then mark
    the tile `.thumb-dead`. Clicking a dead tile retries it instead of opening the file.
  * **Why it was needed at all** (measured 2026-10-01, Chromium 1243): when the
    *chosen* srcset candidate fails, the browser does NOT fall back to `src`. Aborting
    every 960px request broke **12/12** tiles whose 500px `src` was reachable and fine.
    One bad request meant one permanently empty tile.
  * **srcset is now filtered** (`cleanThumbCandidate`): only `/thumb/` bucket URLs
    ≤1280px may be declared. The API's `responsiveUrls["2"]` **is the original file**
    whenever the original is barely wider than the requested size — 172 of 783 files
    (22%) in `Category:Images from Wiki Loves Monuments 2026 in China` are 1200×1800
    originals of 1.6–2.9 MB, so a fifth of that grid was fetching multi-MB originals
    for retina slots. Re-checked against live imageinfo: those files now declare a
    single 960px candidate, while a 1800×1200 control keeps its 1280px 2x.
  * **`Fix images` button** (header, amber, hidden until needed, shows the dead count):
    retries the dead tiles, then — if they stay dead — re-resolves only those titles
    through `api()` with `ttl: 0` (50-title batches) and rewrites their URLs. That is
    the stale-cache case: alpha/list imageinfo responses live 24h in localStorage, so a
    URL that went bad is served from cache on a plain reload too. The button never
    touches feed order, sort, scroll or the URL — which is the whole point versus
    refreshing the page.
  * **`?cat=` normalization:** a category without its namespace made the API answer
    `invalidcategory` and left an empty feed after 4 retries. `asCategoryTitle()` adds
    the `Category:` prefix — prefix only, never a case change (case-doppelgängers are
    real: `Category:Chop Suey` vs `Category:Chop suey`).
  * Removed the old inline `onerror="this.style.display='none'"` on the video/3D tiles:
    it hid the image and left a silent empty placeholder, the opposite of recovery.
  * Regression: `tests/thumb-recovery.spec.js` (19 assertions; injects failures by
    aborting tile requests via route interception) wired into `tests/run.sh`. The five
    pre-existing specs still pass (viewer 36, category-search 29, header-collapse 25,
    wrongcase-cat 8, stl 24 assertions).
- **2026-09-15 — BOTH FEATURES SHIPPED AND LIVE (v1.14.1 badge):** `feature/in-app-viewer`
  (PR #24) and `feature/category-autocomplete` (PR #25) are merged to `main` **and
  deployed** — `index.html`, `app.js`, `style.css` all SHA256-match local = server =
  live. The two entries below were written while they were still prototypes; they are
  now production features. Verified live on 2026-09-15: a tile click opens the
  `#viewer-modal` (9 detail rows, license `CC BY 4.0`, 17 category pills, `Esc` closes,
  no new tab) and typing `chop suey` offers both `Category:Chop suey` (16 files) and
  `Category:Chop Suey` (2 files). Merge order mattered: #24 first, then #25 rebased
  (conflicts in `app.js`, `style.css`, `HANDOFF.md`, `tests/run.sh` — see "Merging the
  viewer + combobox" below). **Version bumped to v1.15** for this batch (the two features
  had shipped under the older v1.14.1 badge); `tests/version-consistency.sh` enforces
  that all four version sites agree.
- **2026-09-11 — in-app media viewer (issue #23, Phase 1) — SHIPPED:**
  clicking a tile now opens the file in a `#viewer-modal` instead of a Commons tab:
  media stage (image/video/audio/STL poster) + a details rail (description, artist,
  credit, date, license + link, usage terms, file facts, all categories as
  clickable teleport pills, and an auto-built attribution line), prev/next through
  the feed, `Esc`/`←`/`→` keys, and `?file=` deep links with Back-to-close.
  **Tiles stay real anchors**: only an unmodified left-click is intercepted, so
  Ctrl/Cmd-click, middle-click and right-click → Copy link address keep working
  (deliberately no "viewer vs new tab" toggle — see issue #23). Metadata comes
  from its own single-title call with a targeted `iiextmetadatafilter` (11 keys,
  ~1.9 KB) because the feed's 2-key trim is a deliberate ~3× win; the batch call
  sites are untouched. Regression: `tests/viewer.spec.js` (36 assertions, green).
  Not yet done: SDC/depicts, EXIF, globalusage, kiosk mode, PDF/DjVu, swipe.
- **2026-09-11 — category type-ahead combobox — SHIPPED:** the `Jump to Category` input no
  longer demands an exact, correctly-cased title. Two tiers fire in parallel and merge
  as they land — `list=prefixsearch` (~319 ms, 0.9 KB) then CirrusSearch
  `list=search&srnamespace=14` (~1034 ms, 1.0 KB) — enriched with batched
  `categoryinfo` counts (7 d cache, reuses `getCatInfo`). Debounced 250 ms, minlength
  2, per-query cached, `role=combobox` + Arrow/Enter/Escape keys.
  **The point is correctness, not convenience:** prefix-only search *hides*
  `Category:Chop Suey` (the Hopper painting) when you type `chop suey`, so the old
  input reproduced the v1.14.1 wrong-case trap at the entry point — a silent landing
  on a different real category. Tier 2 surfaces both twins with counts that separate
  them (dish 16 files vs painting 2 files), and selection inserts the API's **canonical
  title**, never the typed string. Container categories (0 files, N subcats) are
  flagged `— try Deep` instead of leading to an empty feed. Regression:
  `tests/category-search.spec.js` (28 assertions, green). Not done: template-based
  redirect categories (see the note in the code map), "did you mean" in the bulk
  editor, kiosk suppression.
- **2026-09-11 — public-dir exposure closed, version guard, branch cleanup (chore):**
  `.htaccess` was never in effect on the live host (Toolforge's lighttpd ignores it),
  so `HANDOFF.md`, `README.md`, `PRD.md`, `DEPLOY.md`, `GEMINI.md` and
  `.idx/airules.md` were publicly readable. Each was hash-matched to a git revision
  first (nothing unique lost), then deleted from `public_html` — all now return 404
  while the app files still return 200. Added `tests/version-consistency.sh` (a
  4-site version guard, wired first in `run.sh`) so the v1.11-vs-v1.14.1 drift cannot
  return silently. Pruned 12 merged branches on `origin` and 10 locally — only `main`
  remains. `vendor/` was also missing from the documented deploy list (it ships
  three.js, which the STL viewer imports) — added, and verified in parity.
- **2026-09-11 — version single-source (chore):** the app version had drifted across
  three sites — the footer badge and the `app.js` header comment said **v1.11** while
  `UA_NOTE` (boot log) already said v1.14.1. Fix: `const VERSION = "1.14.1"` in
  `app.js`; `UA_NOTE` interpolates it and `init()` writes `#app-version` from it, so
  the footer badge can no longer drift. `index.html` keeps a static `v1.14.1`
  fallback (renders without JS). **Bump `VERSION` only** — the header comment says
  so explicitly. Deployed and SHA256-verified local ↔ server ↔ live; live smoke test:
  12/12 tiles with thumbnails, URL contract intact, 0 console errors.
- **Deployed:** live site matches `main` (verified via SHA256).
- **2026-09-09 — scroll-aware collapsing header (v1.14, issue #17):** on
  touch-primary devices (`(pointer: coarse)` — phones/tablets) the sticky
  header hides after ~100px of downward scroll and returns on upward scroll
  or a tap in the top 48px of the viewport. Implemented transform-only
  (`translateY(-100%)` on the pinned sticky band) — zero reflow, the masonry
  never moves; rAF-throttled passive scroll sampling with an 8px direction
  dead-zone (no jitter/bounce-back flicker); a capture-phase tap-zone swallow
  prevents the tile under the expanding band from opening; collapse never
  fires behind an open modal. **Touch-only by design:** desktop keeps the
  always-visible band (the STL suite parks its mouse in the header zone).
  Coarse-pointer CSS bumps header controls toward 40px+ tap targets.
  Regression: `tests/header-collapse.spec.js` (25 assertions, runs in its own
  touch-emulated context). Both specs now pin their own viewport (stl.spec
  needs 1280×720 desktop layout — the shared playwright session may carry any
  size from another spec).
- **2026-09-10 — case-exact category guard (v1.14.1, live report):** shuffle
  and deep feeds for `Category:Chop Suey` (a Hopper painting) were also
  showing food photos from the case-doppelgänger `Category:Chop suey` (the
  dish). Root cause: CirrusSearch `incategory:`/`deepcategory:` match
  category titles CASE-INSENSITIVELY, while Commons treats the two as
  distinct categories (case-sensitive beyond the first char). Fix: every
  drawn page's own `categories` (already fetched on the same info call) is
  verified against the target's exact title (`exactCatTitle`/`inCategory`/
  `filterShufflePages`); shuffle filters to the current category, deep filters
  to the walked subtree (`state.deepPool`, seeded when the walk resolves).
  A bounded redraw (≤2 extra draws) lets a whole wrong-case batch be replaced
  and then the feed ends once the real members are exhausted (Chop Suey has 2
  painting files vs the twin's 16). `filteredDrawBatch` (alpha+type starve
  fallback) gets the same guard. Residual: the pre-walk `deepcategory:`
  fallback passes unfiltered until the walk lands (cold-start window only).
  Alpha/list modes were never affected (exact generators). Regression:
  `tests/wrongcase-cat.spec.js` (8 assertions, hits live Commons).
- **2026-09-07 — 3D media filter (v1.13):** the type filter gains 3D (STL).
  `pageKind()` now returns `3d` for mediatype `3D` / mime `application/sla`
  (mirrors `buildCard`'s `is3D`, closing the old gap where STL only showed
  under All Media); `TYPE_TERM["3d"] = "filetype:3d"` (validated live — 248
  hits inside Category:STL files; combos like `filetype:"video|3d"` also
  work, banked for a future multi-select). URL param `type=3d` round-trips.
  Issue #14.
- **2026-09-07 — 3D filter zero-match / sparse-type fix (v1.13.1):** alpha
  + media-type filter: `filteredMatchCount()` preflights the category before
  the crawl (CirrusSearch totalhits, 10-min cache); zero matches → instant
  "End of Collection" (was: a full-category crawl of empty batches). If the
  ordered crawl then renders nothing two batches in a row (`starvedBatches`),
  `filteredDrawBatch()` takes over — type-matched random draws via the
  shuffle sampler (deduped by `seenTitles`) — so a rare type paints in
  seconds (3D: 1 file among 22,321 on the default landing ≈ 1,860 blank
  batches before). Draws end on an empty batch → End of Collection. Common
  types (image on photo categories) never starve → alpha order preserved;
  shuffle/deep/list unaffected (empty draws already ended there). New module
  vars reset in `resetAndFetch`. Reported live: "selecting 3D doesn't
  refresh" — actually the crawl marathon / no-op wall on all-STL categories.
  Caveat: incategory: is CirrusSearch — an intermittent server-side zero
  (T246568) can false-positive the preflight; All Media always recovers.
- **2026-09-04 — payload optimization:** all three fetch paths (alpha, shuffle,
  list) now send `iiextmetadatafilter=ImageDescription|ObjectName` — the only
  extmetadata fields the app reads — cutting each 12-tile batch ~3×
  (33→16 KB raw images, 63→39 KB video; smaller localStorage cache entries too).
- **Engine:** Vanilla JS ES module (`app.js`). The PyScript/Pyodide 2026.1.1 build was
  fully replaced (commit `77a3e93`) — the app is DOM/API glue, and the ~10 MB WASM
  runtime was pure overhead. **Do not reintroduce PyScript.**
- **v1.6 — Category tree (shipped):** tree modal (browse current category to depth
  1–5 with file/subcat counts, lazy expand), inline treebar (parent + subcategory
  chips with file counts), and Deep mode (shuffle across the whole subtree via
  CirrusSearch `deepcategory`, URL param `deep=1`). See "Category tree (v1.6)" below.
- **Deployed:** Live site is byte-identical to GitHub `main` (verified via SHA256,
  local ↔ server ↔ live web). Both production bugs found during the rewrite are fixed
  live (see below).
- **Docs:** README, PRD, AGENTS.md, DEPLOY.md all reflect the JS engine.

## Repo layout

| File | Role |
|---|---|
| `index.html` | Thin shell: header controls, masonry columns, category-editor modal. No logic. |
| `app.js` | The whole app (ES module, ~2,400 lines). `VERSION` const at the top is the single source of truth for the displayed version. |
| `style.css` | Custom CSS (drawer, minimal-mode overlay, toggles). Unchanged from PyScript era. |
| `categories.txt` | Seed category list. Format per line: `Category:Name | Label` (label optional). |
| `README.md` / `PRD.md` / `DEPLOY.md` / `AGENTS.md` | Project docs. `AGENTS.md` = agent working rules (renamed from `GEMINI.md` on 2026-09-10 — the name only ever meant "Gemini reads this"). |
| `LICENSE` | MIT (Toolforge rule: OSI license required). |
| `.htaccess` | **Inert on the live host** — Toolforge serves `public_html` via lighttpd, which ignores it (verified 2026-09-10: the file itself returns HTTP 200). The `*.md` docs it was meant to block were **deleted from `public_html` on 2026-09-11** (all now 404), so the effective rule is "never copy `*.md` into `public_html`". Kept for a future Apache-style host. `*.txt` must stay servable (app fetches `categories.txt`), so any real `*.md` block must exclude `*.txt`. |
| `.idx/` | Firebase Studio (IDX) dev-env config — not app code, leave alone. |
| `cache/`, `.playwright-cli/` | Local test artifacts, gitignored. |
| `benchmark/deep-shuffle.js` | Sampler benchmark: enumerates a subtree as ground truth, measures envelope coverage + per-file uniformity, chi-square on the weighted pick, optional live `srsort=random` validation (`--live`). |
| `vendor/` | Vendored libraries, same-origin because Toolforge CSP blocks CDN imports and the privacy rule is "no third-party JS": three.js r170 (MIT) — `three.module.min.js` + `OrbitControls.js` + LICENSE — and Tailwind Play CDN build pinned at 3.4.16 (`tailwindcdn-3.4.16.js`, MIT, v1.19). |
| `tests/` | TDD suite: `version-consistency.sh` (4-site version guard — static, no browser/server, runs first in `run.sh`), `viewer.spec.js` (36 assertions, issue #23 — in-app viewer: no-new-tab, modifier-click passthrough, details, URL state, prev/next, cache, Back/deep link), `category-search.spec.js` (28 assertions — type-ahead combobox: minlength/debounce request discipline, counts, container flags, case twins, canonical insertion, keyboard + ARIA, cache), `thumb-recovery.spec.js` (19 assertions, v1.16 — srcset filtering + in-place recovery + dead-state button + bare `?cat=`; injects failures by aborting tile requests), `clips.spec.js` (17 assertions, v1.18 — clip toggle + persistence + clips feed + `?clips=1` boot + in-feed unclip), `lite.spec.js` (15 assertions, v1.20 — full/lite buckets, no-retina srcset, chip + URL + stored-pref precedence, viewer stays high-res; pins a 1280×720 viewport so the slot math is deterministic), `export.spec.js` (21 assertions, v1.22 — export dialog: open/close, scope counts + disabled states, per-format previews, limit slicing, download naming, clips-scope fetch), `title-wrap.spec.js` (10 assertions, v1.23 — case-faithful wrapped titles: computed-style contract + 138-char real title wraps without overflow; Louvre category, 3 batches), `stl.spec.js` (24 behavioral assertions), `header-collapse.spec.js` (25 assertions, issue #17 — scroll-aware collapsing header, runs in its own touch-emulated context), `wrongcase-cat.spec.js` (8 assertions, v1.14.1 — CirrusSearch case-doppelgänger leak), `stl-tour.js` (showcase tour), `engine-quirks.spec.js` (6 assertions — cross-engine facts + portability guards; see § Cross-engine notes), `spec-lib.sh` (the shared pass/fail rule — `playwright-cli run-code` always exits 0, so the gate reads stdout for `### Error`), `run.sh` (guard + all specs → green → records `tests/artifacts/stl-3d-tour.webm`, the final passing artifact), `engine-matrix.sh` (the same specs on Chromium + Firefox + WebKit). Playwright-cli needs ffmpeg — symlink `/opt/homebrew/bin/ffmpeg` to `~/Library/Caches/ms-playwright/ffmpeg-1011/ffmpeg-mac` if missing. Each spec pins its own viewport (`stl`: 1280×720 desktop; `header-collapse`: 390×844 touch) — the shared playwright session otherwise leaks sizes between runs. |

## URL contract & persistence (do not break)

- **URL params:** `?cat=<Category>&sort=alpha|shuffle&view=det|min&size=s|m|l&type=all|image|video|audio|3d&path=<trail>[&deep=1][&tree=1&depth=N][&file=<File:Name.ext>][&pile=|&psid=|&pet=&petdepth=|&clips=1][&lite=1|0]`.
  `file=` opens the in-app viewer on that file (issue #23 prototype); it is added
  with `pushState` so browser Back closes the viewer, and dropped on close. The
  popstate handler distinguishes a viewer-only history move from a real navigation
  and skips the feed refetch in that case.
  `type=` filters the feed client-side (alpha/list) and server-side (shuffle/deep
  append CirrusSearch `filetype:` terms). `pile=`/`psid=`/`pet=` activate **list
  mode**: the feed renders an external file list instead of a category
  (`pet=` runs a live PetScan query on a category with `petdepth=`; 1h client
  cache). List mode hides the sort pill and treebar; the dropdown shows the
  list label; clicking any category pill exits list mode. `clips=1` (v1.18) is
  list mode over the local personal collection — same rendering path, titles
  from `vibe_clips` instead of a remote service. `lite=1`/`lite=0` (v1.20)
  forces the thumbnail quality mode; absent, the per-device `vibe_lite` pref
  applies. All previous params behave exactly as before.
  `path=` is the breadcrumb trail: segments are URI-encoded (category names may
  contain `/` — it becomes `%2F`) and joined with `/`; written only once the trail
  has 2+ segments (plain `?cat=X` links stay clean). Category navigation
  (`navigateTo`) **pushState**s — browser Back/Forward walks the trail via the
  popstate handler, which re-syncs all state from the URL. Toggles still
  `replaceState`.
  Written with `history.replaceState` on every state change; the logo (`href="/"`) is the
  reset. `size=` picks tile density (S/M/L header toggle; `m` = classic 1–4 columns).
  `deep=1` implies shuffle (deep sampling uses the search API); the "Deep ✓" chip in the
  sort pill shows when it's active and toggles it off. `tree=1&depth=N` boots with the
  tree modal open at depth N; both params drop when the modal closes.
- **localStorage keys:** `vibe_config` (category list, `Category:Name | Label` lines),
  `cv_api_cache_v1` (API response cache), `vibe_clips` (personal collection —
  JSON array of `File:` titles, newest first, v1.18) and `vibe_lite` (thumbnail
  quality pref — "1"/"0", v1.20).
- Categories visited via search/pills/URL are auto-added to `vibe_config`.
- `cat=` is normalized on read (`asCategoryTitle`): a bare `?cat=Images from X` gets
  the `Category:` prefix instead of failing with `invalidcategory`. Only the prefix is
  normalized — never the case, because case-doppelgängers are real categories.
- Tile `<img>`s carry `data-src-one` (the 1x thumb, `data-src-1x` is NOT a valid
  dataset key — a digit after the dash is dropped, so it reads as undefined).

## Run locally

```bash
python3 -m http.server 8123        # any static server works; no build step
# open http://127.0.0.1:8123/
```

## Test checklist (run before deploying)

1. Default load → 12 tiles, URL gains `?cat=...&sort=alpha&view=det`, count badge fills.
2. Infinite scroll → next batch renders (prefetched); short pages self-fill until the
   sentinel leaves viewport+800px (`lastBatchOk` guard in `fetchImages`).
3. Video category (search `Videos of animals`) → tiles are `<video>`, hover plays
   480p VP9, leave pauses + resets to 0.
4. Editor (✏️ button) → Save with no changes closes cleanly; invalid category shows
   the red error box; valid new category persists.
5. Shuffle toggle → purple knob, `sort=shuffle` in URL, random batches on scroll.
   Also shuffle a quote-containing category (e.g. the Albert-Kahn mission
   `"1923 - Suisse Allemande…"` autochromes) — it must render.
6. Minimal/Detailed toggle → `view=min|det`, overlay vs. flowing metadata.
7. Tag button → drawer with pills; hidden categories = ghost pills; pill click teleports
   and adds category to config.
8. Copy URL → open in new tab → same view.
9. Reload a visited category → zero `api.php` network requests (cache hit).
10. Console: no errors beyond favicon 404 + Tailwind CDN warning (both pre-existing).
11. Tree modal (👥 button) → depth select 1–5 auto-expands that many levels;
    clicking a category name navigates; ▸ toggles lazy one-level expansion.
12. Treebar above grid → "↑" parent chips and "↳" subcategory chips (file counts);
    chips navigate; "+N more" opens the tree modal.
13. "Shuffle Entire Subtree" in tree modal → `sort=shuffle&deep=1` in URL, purple
    `Deep ✓` chip appears in the sort pill (next to Shuffle) and a purple explainer
    banner (category name + Turn Off button) shows above the grid; clicking the chip
    or the banner's Turn Off returns to plain shuffle (`deep` dropped). Switching
    back to Alpha also drops deep. Banner/chip state is synced by `syncDeepUI()`.
14. Size toggle (S/M/L, left of the sort pill) → column count changes per
    `SIZE_COLS`, all cards conserved through the reflow (no losses, no image
    re-fetches), `size=` in URL round-trips. Resize the window across the 640/
    1024/1280 breakpoints — card count must never change (the pre-v1.8 resize
    bug). Works in minimal mode too.
15. Breadcrumb trail: descend via chip/pill/tree/search → `path=` grows in URL,
    `#crumbs` row shows `A › B › current`; clicking a crumb truncates; browser
    Back/Forward walks the trail (state re-syncs, tiles reload); sharing a URL
    with `path=` boots with the trail intact; an empty category shows "End of
    Collection" instead of an error.
16. Roulette: 🎲 chip ends the subcategory chip row; each spin lands on a
    subcategory that has files; trail + Back/Forward integrate. The dice is
    hidden entirely below 4 subcats (e.g. Featured pictures on Wikimedia
    Commons — its single "vector" subcat shows as a chip, no dice).
17. Type filter: header select — Images/Video/Audio/**3D** filter the feed
    (3D = mediatype `3D`/mime `application/sla` client-side, `filetype:3d`
    server-side in shuffle; shuffle filters server-side; alpha client-side);
    `type=` round-trips; "All Media" restores. Quick check: `?type=3d` on
    Category:STL files renders only STL tiles; `?type=image` there renders
    nothing (End of Collection after the fill-up loop exhausts the category).
18. List mode: `?pet=<Cat>&petdepth=N` (or `?pile=`/`?psid=`) renders the list
    as a feed — dropdown shows the list label, sort pill hidden, size/view/type
    still work; clicking a tile's category pill exits list mode into that
    category.
19. Tree filter: typing in the modal's filter box narrows the list as you type
    (case/underscore-insensitive substring); matches keep their ancestor chain
    visible and collapsed branches holding matches auto-expand; the count line
    shows "N matches · of M loaded"; Escape clears; clicking a filtered row
    navigates and closes the modal; reopening starts unfiltered; depth change
    and "Load 500 more" preserve the filter (re-applied after rebuild).
20. STL 3D viewer: an STL category (e.g. Category:STL files, All Media filter)
    shows posters + "3D" badges; zero .stl bytes fetched until a tile is
    hovered ≥150ms; hovering swaps the poster for a WebGL canvas with slow
    auto-rotate; horizontal drag = yaw, vertical drag = pitch, wheel = zoom;
    spin-drag never opens the Commons link; leaving the tile disposes the
    canvas and restores the poster; re-hover is instant (bytes cached);
    files over 40MB keep their poster (graceful fallback). Regression: run
    `tests/run.sh` — 22 assertions, then records the video artifact.
21. Sparse-type filter (v1.13.1): alpha + `type=3d` on a category with very
    few matches (e.g. Category:Featured pictures on Wikimedia Commons — 1 STL
    in 22,321 files) paints the match within a few seconds (preflight →
    starved-crawl fallback draws) then End of Collection; on a category with
    none (e.g. Category:Videos of animals + `type=3d`) End of Collection
    appears immediately (no crawl marathon).
22. Scroll-aware collapsing header (v1.14, issue #17): on a touch device the
    header is visible at the top; scrolling <100px keeps it; scrolling past
    ~100px slides it fully out (transform-only — grid/URL/history unchanged);
    scrolling up restores it; tapping the top ~48px while collapsed restores
    it without activating the tile underneath (no Commons page opens); a tap
    outside that zone does nothing; opening the tree modal and scrolling
    behind it never collapses the header; after closing, collapse resumes.
    Desktop (mouse) is unchanged — the band never hides. Automated:
    `tests/header-collapse.spec.js` (25 assertions).
23. Case-exact category guard (v1.14.1): a shuffle or deep feed for a category
    that has a different-cased doppelgänger (e.g. `Category:Chop Suey` the
    Hopper painting vs `Category:Chop suey` the food) shows ONLY files really
    in the selected category — no wrong-case twin members — and reaches End of
    Collection instead of looping the twin's files. Automated:
    `tests/wrongcase-cat.spec.js` (8 assertions).
24. Broken-thumbnail recovery (v1.16): in DevTools block `*.wikimedia.org` image
    requests and load a feed — the tiles that fail recover on their own within a
    second or two, with NO page reload (`sort=shuffle` order and the URL must be
    untouched; a tile that did recover carries `thumbretry=` in its `currentSrc`).
    Keep them blocked → after ~5s the tiles get an amber outline + "⟳ retry" chip
    and the header shows a `Fix images <count>` button; unblock, then either click
    a dead tile or the button → every tile comes back and the button hides itself.
    Also: a bare `?cat=Chop Suey` (no `Category:` prefix) renders the painting
    instead of an empty feed, and no tile's `srcset` ever contains a non-/thumb/
    URL or a bucket wider than 1280px. Automated:
    `tests/thumb-recovery.spec.js` (19 assertions).
25. Cross-engine + gate (v1.17). Verify `tests/run.sh` can actually FAIL: break one
    assertion on purpose (or `run_spec /tmp/zz-fail.spec.js "x"` with a throwing
    spec) and confirm it exits non-zero with the `FAIL` line printed. Then run
    `tests/engine-matrix.sh` (needs the `:8123` server) — every spec is expected
    green on Chromium, Firefox and WebKit. Automated: `tests/engine-matrix.sh`,
    `tests/engine-quirks.spec.js` (6 assertions).
26. Clips / personal collection (v1.18): clip a tile (bookmark button in the
    card footer, or "✂ Clip this" in the viewer footer) → the header chip shows
    a count and `vibe_clips` gains the `File:` title; clipping again unclips.
    Clicking the chip opens the clips feed (`clips=1` in URL, "My Clips (N)" in
    the dropdown, sort pill hidden) showing exactly the clipped files in
    clip order; unclipping there drops the tile in place and emptying the feed
    shows End of Collection; reloading keeps the collection (localStorage);
    `?clips=1` boots straight into the feed. Automated: `tests/clips.spec.js`
    (17 assertions).
27. Lite mode (v1.20/v1.21): the ⚡ Lite chip (next to S/M/L) loads 1×
    thumbnails — base thumbs drop to the smallest ladder bucket ≥ slot width
    (330px at M density, 250px at S) and srcset carries no retina (2×)
    candidates; the viewer still loads full-res. URL `lite=1`/`lite=0`
    overrides the stored `vibe_lite` pref; the chip toggles + persists per
    device. Toggling (either direction) PRESERVES the on-screen tiles and
    their visual order — same set, same masonry positions, no reshuffle, no
    scroll jump — in alpha, shuffle, deep and list modes.
    Automated: `tests/lite.spec.js` (22 assertions, incl. shuffle
    visual-order preservation).
28. Export (v1.22, issue #30 phase 1): the header **Export** button opens a
    dialog — scope *this feed* (tiles drawn this session) or *my clips*,
    limit 12/24/50/100/500/all, format JSON / CSV / plain text / wiki gallery,
    with a live preview, Copy and Download (`.json`/`.csv`/`.txt`/`.wiki`).
    **PDF/Print** runs `window.print()` and the `@media print` sheet renders the
    feed as a light 3-column contact sheet (chrome hidden, cards kept whole,
    `#print-header` label). Quick metadata only (whatever the tiles carry) —
    artist/license enrichment is issue #30 phase 2; the JSON `files[]` shape is
    the seed for the phase-4 shareable-session re-import.
    Automated: `tests/export.spec.js` (21 assertions). Sample render artifact:
    `cache/export-sample/commonsvibe-print-sample.pdf` (gitignored).
29. Title treatment (v1.23): DET tile titles are **case-faithful** (the CSS
    `uppercase`/`tracking-widest` are gone) and **wrap to the full filename**
    (`leading-snug break-words`; the h3's `title` tooltip keeps the full name
    too). Worst case measured at design time: a real 138-char Louvre title →
    3 lines, +14px on a 485px card (+2.9%); masonry absorbs it (placement uses
    measured `offsetHeight`). The print/PDF sheet inherits it — full names
    instead of CAPS truncation. Automated: `tests/title-wrap.spec.js`
    (10 assertions — computed-style contract + real-title wrap/no-overflow).

## Cross-engine notes (Chromium / Firefox / WebKit)

Measured 2026-10-01 with `playwright-cli` (`@playwright/cli` 0.1.13) on macOS.
`tests/engine-quirks.spec.js` asserts these as executable facts. **A failure there
means an engine or Playwright changed — NOT that the app regressed.** Re-measure,
then simplify whatever workaround the stale fact was justifying.

| Fact | Chromium | Firefox | WebKit |
|---|---|---|---|
| `mouse.click()` delivers `pointerdown` (desktop ctx) | yes | yes | yes |
| …the same in a `hasTouch: true` context | yes | **NO** | yes |
| `hasTouch: true` ⇒ `maxTouchPoints > 0` | yes | **NO** | **NO** |
| Synthetic (untrusted) ctrl-click opens a tab | yes† | NO | yes† |
| Real ctrl+click opens a tab (macOS) | NO | NO | NO |
| Real **Cmd**+click opens a tab (macOS) | yes | yes | yes |
| Scroll per `mouse.wheel(0, 4500)` | ~1276px | **~575px** | ~1276px |

† Timing-sensitive AND engine-dependent — measured over three 1.5s trials, but an
earlier WebKit sample with a 1.0s window saw no tab. Deliberately **not** asserted;
`engine-quirks.spec.js` records it as an `INFO` line instead.

Consequences, and where each is handled:

* **`run-code` always exits 0**, even when the spec throws (verified: a body of
  `async page => { throw new Error("x") }` exits 0). The only failure signal is the
  `### Error` line on stdout — and a "browser is not open" reply carries no marker at
  all, so it would otherwise score as a pass. All gating lives in `spec-lib.sh`.
* **Firefox's mouse API emits no `pointerdown` — but ONLY in a `hasTouch: true`
  context.** In a desktop context it delivers it normally. This is a Playwright/Firefox
  artifact, not a Firefox defect: `page.touchscreen.tap()` in the same engine DOES emit
  `pointerdown`, and so does real user input. The conditionality is what made it
  slippery — it reproduced only in `header-collapse.spec.js`, whose touch-emulated
  context is the app's actual mobile configuration. It still caught a genuine
  fragility — a restore that depended on that single event — fixed in `app.js`.
* **`maxTouchPoints` is 0 on Firefox/WebKit** even with `hasTouch: true`. The
  `header-collapse` env probe asserts the coarse-pointer media query, which is what
  `app.js` actually gates on (`COARSE_POINTER`), and reports `maxTouchPoints` for
  diagnostics only.
* **A wheel tick is not a batch.** Firefox scrolls less than half as far per tick for
  the same `deltaY`, so `stl`'s one-tick-per-batch loop could wait 25s for a request
  that was never made. It now ticks until a batch lands and asserts that batch's
  latency — the real "stays responsive" contract.
* **macOS: ctrl+click is a secondary click.** No engine opens a tab for a real
  ctrl+click; Cmd does. The viewer spec derives the modifier instead of hardcoding
  Control and uses a REAL click — a synthetic dispatch only ever passed on Chromium.
* **Untrusted synthetic events are not portable.** The old viewer assertion claimed a
  synthetic ctrl-click "really opened a tab" — measured Chromium yes and WebKit yes but
  Firefox no over three 1.5s trials, while an earlier WebKit sample with a 1.0s window
  saw none, making it timing-sensitive as well as engine-dependent. Never assert a
  browser-level outcome (navigation, popup) off a `dispatchEvent`; assert the app's own
  contract (`defaultPrevented`, internal state) instead, and prove real new-tab
  passthrough with a REAL click. `engine-quirks.spec.js` records this one as an `INFO`
  line rather than asserting it.
* **`--browser=chromium` is rejected** by `playwright-cli open` — the default *is*
  bundled Chromium, so open it with no flag.
* **Long session names break the launch.** `playwright-cli` derives a UNIX socket path
  from the session name; `iso-firefox-header-collapse` was long enough to die with
  `listen EINVAL`. Matrix sessions are `mx1`, `mx2`, `mx3`.

## Deploy to Toolforge

Tool: `commons-vibe`, webservice `php8.4` (Kubernetes), files in
`/data/project/commons-vibe/public_html/`. Static changes need no restart.

```bash
# per file — pipe-through-sudo keeps ownership tools.commons-vibe
cat index.html | ssh alih@dev.toolforge.org \
  'sudo -niu tools.commons-vibe sh -c "cat > /data/project/commons-vibe/public_html/index.html"'
# ...repeat for app.js style.css categories.txt .htaccess
# vendor/ ships with the app (three.js r170 — the STL viewer imports it, and the
# Toolforge CSP blocks CDN module imports). It is required on a fresh deploy and
# after any vendor bump, not just on file edits. Same cat-pipe pattern:
cat vendor/three.module.min.js | ssh alih@dev.toolforge.org \
  'sudo -niu tools.commons-vibe sh -c "mkdir -p /data/project/commons-vibe/public_html/vendor && cat > /data/project/commons-vibe/public_html/vendor/three.module.min.js"'
# v1.19 also ships the vendored Tailwind build (index.html loads it):
cat vendor/tailwindcdn-3.4.16.js | ssh alih@dev.toolforge.org \
  'sudo -niu tools.commons-vibe sh -c "cat > /data/project/commons-vibe/public_html/vendor/tailwindcdn-3.4.16.js"'
# ...same for vendor/OrbitControls.js and vendor/LICENSE
```

**Never copy `*.md` into `public_html`** — lighttpd ignores `.htaccess`, so they would
be world-readable. The served directory must contain exactly `index.html`, `app.js`,
`style.css`, `categories.txt`, `.htaccess` and `vendor/` (stale doc copies were
removed 2026-09-11 — see open item 9).

Verify after deploy:
```bash
# local ↔ server
ssh alih@dev.toolforge.org "sha256sum /data/project/commons-vibe/public_html/app.js"
shasum -a 256 app.js
# server ↔ live web
curl -s -A "$WIKIMEDIA_USER_AGENT" https://commons-vibe.toolforge.org/app.js | shasum -a 256
# browser smoke test on the live URL (see checklist above)
```

### Merging the viewer + combobox (2026-09-15) — the conflict pattern

Both features insert sections/rows at the **same anchors**, so a plain merge conflicts in
four files (`app.js`, `style.css`, `HANDOFF.md`, `tests/run.sh`); `index.html`
auto-merges. The subtlety that costs time: in `app.js`, `style.css` and `tests/run.sh`
**each side inserts a block whose closing braces were the shared context**, so git emits
one huge hunk and the resolution must **duplicate the closer once per side** —
`  });` + `}` for `app.js`, `}` for `style.css`, and `  exit 1` + `}` for `tests/run.sh`.
Miss it and the app fails to parse or `bash -n tests/run.sh` errors (the STL/viewer
specs would then fail confusingly). In `HANDOFF.md`: keep both current-state bullets,
**merge** the two `tests/` table rows into one, and drop the duplicated
`### 3D STL viewer (feature branch)` heading when stashing both code-map subsections.

Verified recipe (used for the #25 rebase): build and test the composition on a throwaway
branch first, then resolve the real rebase by taking those files; the rebased tree must be
**byte-identical** to it (`git diff --quiet <temp> HEAD`) and its
`git diff --stat origin/main` must show **only the second feature** — no viewer leftovers,
no duplicated blocks.

## API integration rules (hard-won gotchas)

All in `api(params, {ttl})` in `app.js` — always route queries through it.

- **Tracking params:** the Action API appends `?utm_source=...&utm_content=original` to
  `url`/`thumburl`/derivative `src` values. Strip with `cleanUrl()` before extension
  checks or media use.
- **Media detection:** use `mediatype`/`mime` fields, NOT URL suffixes (this broke video
  rendering in the old PyScript build). Derivative `type` may be
  `video/webm; codecs="vp9, opus"` — split on `;` before comparing.
- **Case/underscore — TWO normalizations, on purpose.** `normCat()` (spaces +
  lowercase) is for URL/state and cache keys, where both spellings *should* collapse.
  Feed **membership** must use `exactCatTitle()` / `inCategory()` /
  `filterShufflePages()`: CirrusSearch `incategory:`/`deepcategory:` match titles
  case-insensitively while Commons does not, so normalizing feed results with
  `normCat()` is exactly the v1.14.1 Chop Suey leak. (Commons does treat `_` and
  spaces as equivalent; the old editor's rejection of underscore categories is fixed.)
- **Format:** `formatversion=2` everywhere (pages are arrays). `origin=*` for CORS.
- **Batching:** max 50 titles per query; editor validation chunks at 50.
- **Caching:** `api()`'s default is `ttl: 0` = uncached — *omitting* `ttl` is what
  keeps shuffle/deep/roulette draws un-cached, so never add one there (serendipity
  dies). `{ttl: N}` enables the localStorage cache: alpha batches 24h,
  categoryinfo/validation 7d.
- **Retry/abort:** 429/5xx retried with exponential backoff (max 4 attempts — api()
  then throws "API retries exhausted" rather than returning undefined); every reset
  aborts in-flight fetches (`state.abort`) and bumps `state.requestId`. apiThrottle()
  adds a global 150ms gap between request starts (tree walks once tripped 429s).
- **Generator + prop = pageid order:** `generator=categorymembers` (or any generator)
  combined with `prop=...` returns pages sorted by PAGEID, not member order. Alpha
  mode must sort by title client-side, and list mode must restore its own order —
  never trust response order.
- **iiprop overrides defaults:** specifying `iiprop=url|extmetadata|derivatives`
  silently DROPS `mediatype`/`mime` (they're default props). Request them
  explicitly when classifying pages.
- **extmetadata is trimmed on purpose:** the three batch calls send
  `iiextmetadatafilter=ImageDescription|ObjectName` (only what buildCard's
  description reads). If a feature needs more metadata (Artist,
  LicenseShortName, …), widen the filter — don't remove it, or every batch
  carries multi-KB unused metadata again.
- **Empty generator results:** a generator query with zero matches returns
  `{batchcomplete:true}` with no `query` node — guard `(data.query && data.query.pages)`.
- **CirrusSearch keyword instability:** `incategory:`/`deepcategory:` intermittently
  return zero results server-side (T246568 degradation — observed live). The deep
  sampler's retry loop exists partly for this; check the search API directly before
  debugging the app.
- **Quote-escape category names in search keywords (fixed 2026-09-04):** category
  titles may contain `"` (Albert-Kahn autochrome missions use quoted date ranges).
  A raw `incategory:"…mission "1923…""` terminates the CirrusSearch string early
  and silently returns zero results FOREVER — while `categoryinfo` still reports
  the files, so the count badge shows 198 over an empty feed. All three keyword
  construction sites (`flatSampleTitles`, the deep-fallback `deepcategory:`, the
  deep per-pick `incategory:`) now route names through `escQ()` (`"` → `\"`),
  which CirrusSearch honors. Alpha mode was never affected (it uses
  `generator=categorymembers`, not Cirrus).
- **Thumbnail infra migration IN FLIGHT (T427465, FY26-27):** thumbs now served
  from `thumb.wikimedia.org`, quantized upward to the standard size ladder
  (250/330/500/960/1280/…) while `thumbwidth` reports the requested width; the old
  `upload.wikimedia.org` host returns 400 for non-standard sizes. Behaviors may
  keep shifting while T427465 rolls out per-wiki — if thumbs get "weird", check
  `benchmark/thumb-metrics.md` (bucket ladder, timeline, official Phab refs)
  before debugging the app.
- **CORS-friendly helpers:** PagePile (`pagepile.toolforge.org` — host moved off
  wikimedia.cloud) and PetScan (`petscan.wmcloud.org`) both send
  `access-control-allow-origin: *`; the browser fetches them directly.
- **Browser fetches stay header-free (do not "fix" this):** `api()` sends NO
  custom headers — a header-free GET is a CORS *simple request* (no preflight,
  works in every engine). Browsers cannot set `User-Agent`; `Api-User-Agent`
  would force an OPTIONS preflight before every api.php call (double requests,
  extra latency under congestion). Per the wikimedia-api-access skill's
  preflight-trap guidance (verified 2026-09-03), that is the correct trade for
  browser apps. Only `loadList()` sets `Api-User-Agent` — PetScan/PagePile are
  preflight-verified to allow it. If traffic identification at WMF ever
  becomes a requirement, the answer is a server-side proxy, not fetch headers.

## Code map (`app.js`)

- `api()` / `cacheGet` / `cachePut` — API layer with cache + retry.
- `state` — all mutable state; `requestId` guards stale renders.
- `fetchBatch()` — alpha (generator+continue token, cacheable) vs shuffle in one place.
  Shuffle draws via `flatSampleTitles()` (single category) or `deepSampleTitles()`
  (deep mode) — both `srsort=random&srlimit=50` → `pickNewTitles()` dedupe → 12.
- `collectSubtree()` / `deepSampleTitles()` — deep-mode sampler (see below).
- `getBatch()` / `prefetchNext()` — one-batch lookahead queue.
- `fetchImages()` — orchestration + sentinel fill-up loop (`lastBatchOk`).
- `buildCard()` — tile DOM; `pickBestVideo()`, `srcsetFor()`, drawer/pill wiring.
- `installThumbRecovery()` / `recoverThumbImage()` / `fixBrokenThumbs()` — broken-tile
  recovery (v1.16): capture-phase error listener → drop srcset + cache-busted 1x
  retry → 1s/3s backoff → `.thumb-dead` → "Fix images" button → `reResolveThumbUrls()`.
  `cleanThumbCandidate()` filters srcset candidates to /thumb/ buckets ≤1280px.
- `asCategoryTitle()` — `Category:` prefix for bare `?cat=` values (prefix only, no case).
- `resetAndFetch()` — clears grid, bumps requestId, aborts, refetches.
- `init()` — URL param bootstrap, event binding, IntersectionObserver.

### Lite mode (v1.20)

- `liteThumbWidth()` / `feedThumbWidth()` / `litePref()` / `loadLite()` /
  `syncLiteUI()` / `toggleLite()` / `redrawFeedInPlace()` — quality/speed mode
  used by the three feed call sites (`iiurlwidth: feedThumbWidth()`) and
  `srcsetFor` (breaks before adding responsiveUrls candidates when
  `state.lite`). The viewer call site keeps its own 1600 request deliberately.
  Toggling redraws the on-screen tiles IN PLACE (same set, same order —
  v1.21); `resetAndFetch` only as fallback when nothing is on screen.
- Cache safety: a different requested width produces different API URLs, so
  full and lite have disjoint localStorage cache entries — no mode can serve
  the other stale buckets.

### Clips / personal collection (v1.18)

- `loadClips()` / `isClipped()` / `toggleClip()` / `syncClipChip()` /
  `updateClipButtons()` / `syncViewerClipBtn()` / `removeClipCard()` / `openClips()`
  — localStorage-backed single collection (`vibe_clips`, `File:` titles newest
  first). Tile buttons carry `data-clip-file` so `updateClipButtons` can keep
  every rendered instance of a file in step (grid + viewer feed steps).
- The feed is list mode with `source: 'clips'` — `loadList()` short-circuits
  (titles = the collection), `listBatch()` renders in clip order, and
  `writeURL` writes `clips=1` instead of a remote list id. Unclipping inside
  the feed removes the card + reflows instead of reloading (same philosophy as
  thumb recovery: a shuffle-like session is never thrown away).
- `window.__cvState = state` (spec/debug hook, set with the other hooks) —
  the app never reads it back.

### Category tree (v1.6)

- `getCatInfo(titles)` — batched `categoryinfo` (files + subcats), 50/call, keyed
  by `normCat` (underscore/space safe).
- `fetchParents(cat)` — `prop=categories&clnamespace=14&clprop=hidden`.
- `buildTreeLevel(cat)` — `cmtype=subcat` members + counts; the one tree primitive.
- `fetchTreebar()` — fills the ↑ parents / ↳ subcats chip rows on every reset.
- `openTreeModal()` / `loadTree()` / `renderTreeChildren()` / `treeRowEl()` — the
  depth-N auto-expanding modal tree; `treeCap` (500, resumable via the "Load 500
  more" button — cached categories replay instantly) bounds each render pass,
  with a visited-set deduping cyclic DAG references; `treeReqId` (bumped by
  `resetAndFetch`) kills stale renders. `?treecap=N` overrides for testing.
  **Type-to-filter (2026-09-04):** `#tree-filter` input in the modal header;
  `applyTreeFilter()` walks the loaded `.tree-node` DOM (120ms debounce,
  normCat-normalized substring match), keeps matches plus their ancestor chain,
  force-expands collapsed branches that hold matches, and reports
  "N matches · of M loaded" in `#tree-filter-count` — client-side only, no API
  calls, so it filters loaded rows (≤ treeCap) only. Escape clears; reopening
  the modal starts unfiltered; `loadTree()` re-applies the filter after depth
  changes and "Load 500 more". Note: `.tree-node`s are NOT direct children of
  `#tree-content` — they nest inside wrapper divs; the walker recurses through
  any non-node child.
- `handleTreeDeep()` / `handleDeepOff()` / `syncSortUI()` — deep mode plumbing.

### Roulette, type filter, list mode (v1.11)

- **Roulette:** 🎲 chip at the end of the treebar's subcategory row;
  `categoryRoulette()` picks a random subcategory **weighted by direct file
  count** (never lands on an empty branch; uniform fallback), via `navigateTo`
  so the trail/history integrate. **Anti-repeat (2026-09-04):** the last 3
  landings (`state.lastRoulettePicks`, normCat-keyed) are excluded while ≥4
  pool options remain — file-count weighting lets one dominant subcat (e.g.
  Yale Center for British Art at ~20% of "GAP works by collection") land
  every ~5 spins, which reads as non-random. The memory survives
  `resetAndFetch` on purpose (the roulette's own navigateTo resets state).
  Reported as a bug once (3 repeats in 6 spins on that category) — weighting
  math made it a ~9% event, but the exclusion window now makes it impossible.
  **Visibility gate (2026-09-04):** the dice renders only when
  `roulettePool(rows).length >= ROULETTE_MIN_POOL` (4) — with ≤3 subcats the
  chips already show every option, and the anti-repeat window (3) cannot
  engage, so the dice would just replay the same few landings. The pool
  helper is shared with `categoryRoulette`, so the gate and the spin always
  agree on what a spin would pick from.
- **Type filter:** header `type-select` (All/Images/Video/Audio/**3D** — 3D
  added 2026-09-07, v1.13). `pageKind()` classifies from `mediatype`/`mime`
  (now requested explicitly —
  `iiprop=url|extmetadata|derivatives` OVERRIDES API defaults and omits them;
  classic gotcha). Client-side in renderPages (alpha/list; v1.13.1: alpha
  preflights the match count and falls back to type draws when the crawl
  starves — see the v1.13.1 bullet) + server-side
  `filetype:` terms in shuffle/deep searches (`TYPE_TERM`; multi-value
  `filetype:"bitmap|drawing"` needs quotes; `3d` is a plain single value).
- **List mode:** `state.list = {source:'pile'|'psid'|'pet', id, depth?, titles,
  cursor}`. `loadList()` fetches (CORS is open on both services — verified):
  PagePile `pagepile.toolforge.org/api.php?id=N&action=get_data` (note: host
  moved off wikimedia.cloud), PetScan `petscan.wmcloud.org/?psid=N&format=json`,
  or a live PetScan query (`pet=` + `petdepth=`). Rows: PetScan returns OBJECTS
  ({title}), PagePile strings — both normalized to `File:`-prefixed titles.
  `listBatch()` renders in list order (12/batch via imageinfo, missing titles
  skipped). `fetchImages` guard relaxed: list mode has no current category.
  Exiting: click any category pill (navigateTo clears state.list), or navigate
  via search/dropdown.

### Category type-ahead (prototype)

- `installCategoryAutocomplete()` — wires `#search-input` as an ARIA combobox
  (`role=combobox`, `aria-expanded`, `aria-activedescendant`) with a 250 ms debounce
  and `CAT_SUGGEST_MIN=2`. It owns `input`/`mousedown`/outside-click only; the
  keyboard cases live in `handleSearch()` so ordering against the Enter-to-navigate
  path stays deterministic (one keydown listener, not two).
- `catPrefixSearch()` (`list=prefixsearch`) / `catFuzzySearch()` (`list=search`,
  `srnamespace=14`) / `runCatSuggestions()` — the two tiers run under
  `Promise.allSettled` and each repaints as it lands, then `getCatInfo()` supplies
  file/subcat counts and it repaints once more. Per-query results are memoised in
  `catSuggestCache`; a module-level `catSuggestReqId` makes stale responses no-ops.
- `navigateToCategory(title)` — **canonical-title insertion**; this is what stops the
  user's spelling (and its casing) from ever becoming the category title.
- `renderCatSuggestions()` — flags container categories (0 files, N subcats) as
  `— try Deep`, and pluralises counts correctly.
- Measured costs (live, single-shot): prefixsearch ~319 ms / 0.9 KB,
  CirrusSearch ~1034 ms / 1.0 KB, a 20-row prefix page *with counts* ~1.9 KB. Keep
  `CAT_SUGGEST_MAX` small — a 500-row `allcategories` page is 42–48 KB.
- **Category redirects are NOT detectable via `redirects=1`:** Commons uses
  `{{Category redirect}}` templates, and `list=allpages&apnamespace=14&apfilterredir=redirects`
  returns **zero** rows (verified 2026-09-11), so a redirect-style category looks like
  an existing-but-empty category. Detecting them needs an explicit `insource:` check —
  unresolved, and this is the one silent dead end the combobox does not fix.

### In-app media viewer (issue #23, Phase 1 prototype)

- `installViewerInterception()` — the single delegated click interceptor. It fires
  only for `button === 0` with no modifier keys, only on `a.media-link` /
  `a.card-info-link`, and never when the target is an active `.stl-canvas` (spinning a
  model isn't a navigation gesture). Modifier/middle-clicks fall through to the
  anchor's native new-tab behaviour; `View Source ↗` is deliberately NOT intercepted.
- `openViewer(title)` / `closeViewer()` / `viewerStep(±1)` / `syncViewerFromURL()` —
  modal lifecycle, feed-order prev/next (`card.dataset.file`), and the URL ⇄ viewer
  sync the popstate handler calls.
- `fetchViewerMeta(title)` — its own single-title `imageinfo|videoinfo|categories`
  call with the 11-key `VIEWER_META_KEYS` filter + `iiurlwidth=1600`, `ttl` 7d, plus a
  session Map. The three feed call sites keep their 2-key filter (deliberate ~3× win).
  `feedQSFromQS()` — the query string without `file=` — is what lets popstate skip a
  feed refetch when only the viewer changed.
- `viewerMediaHtml()` / `viewerDetailsHtml()` / `renderViewer()` — per-type stage
  (image / video+controls / audio / STL poster + explicit "Load 3D model" gesture)
  and the details rail incl. the auto-built attribution line.
- STL reuse: the viewer calls `activateStl($("viewer-media"), box, url)` and
  `closeViewer()` calls `deactivateStl` so `window.__cvStl.registry` stays clean.
- **Anchor invariant (do not "simplify"):** the tiles must stay real `<a href=…
  target="_blank">` anchors. Replacing them with buttons silently kills middle-click,
  Ctrl/Cmd-click, right-click → Copy link address, and the status-bar URL preview —
  and it is the whole reason no viewer/tab toggle is needed.

### 3D STL viewer (feature branch)
- `activateStl(card, mediaBox, url)` / `deactivateStl` / `disposeStlEntry` / `parseBinaryStl` / `ensureStlLib` — hover-to-spin 3D for `application/sla` (mediatype `3D`) tiles. Server thumbs stay as posters; a **150ms dwell gate** on pointerenter (scroll fly-overs never activate), then lazy `import("three")` + fetch of the raw STL (bytes cached per URL — re-hover instant), binary parse (ASCII/unparseable → poster kept), flat-shaded MeshStandardMaterial + hemisphere/directional lights, OrbitControls with auto-rotate until first grab.
- **Constraints that shaped it:** upload.wikimedia.org sends `access-control-allow-origin: *` on raw file bytes (verified 2026-09-04 — the skills-table "no CORS" row is outdated for file media), so no proxy is needed; Toolforge CSP blocks CDN scripts → vendor same-origin; `forceContextLoss()` is deliberately NOT used — rapid create/loss cycles wedge later context creation in Chromium.
- **Size tiers (2026-09-07):** streamed downloads with live progress in the
  loading overlay ("loading… 43% (17.1/40.2 MB)", "large model — " prefix over
  50MB); 150MB hard ceiling (memory safety), 30s no-byte stall detector
  (fixed 20s timeouts cannot fetch 104MB); buffers >25MB skip the bytes cache
  (HTTP cache re-serves on re-hover). Category:STL files has 40-104MB entries
  — they all render now. Parser accepts trailing exporter padding (facets must
  FIT, not byte-exact). Failures show "3D unavailable — <reason>" for 2.6s,
  never a silent revert-to-poster.
- **Link interplay:** the tile sits inside the Commons `a.media-link` — `draggable=false` + dragstart preventDefault (native link-drag hijacks the pointer), and clicks are swallowed while the rig is active (spin gestures must not navigate). Touch taps before activation keep the Commons navigation, matching video tiles.
- **Test hook:** `window.__cvStl = { registry, bytesCache }` — spec-only; the app never reads it.
- **Open:** mobile touch orbit (tap = Commons nav for now), ASCII STL parsing, canvas size stale after window resize between hover cycles. ~~`pageKind()` returns null for mediatype 3D so STL shows only under All Media~~ — fixed v1.13: type filter now has a 3D option (`type=3d`).

### Tile layout (v1.8)

- `SIZE_COLS` — column counts per density (s/m/l) × breakpoint tier (<640/<1024/<1280/≥1280).
  `m` reproduces the pre-v1.8 layout exactly.
- `state.items[]` — placed cards in fetch order; the reflow source of truth.
- `ensureColumns()` / `placeCard()` / `reflow()` — shortest-column placement using
  tracked heights (one `offsetHeight` read per card; media boxes carry CSS
  aspect-ratio so heights are stable before lazy images load). Reflow moves DOM
  nodes (listeners + loaded images survive; no re-fetch). Runs on size toggle and
  debounced window resize — this also fixed the old bug where shrinking the
  viewport made cards vanish (hidden `col-2`/`col-3` divs).
- Columns are created dynamically; the old hardcoded `#col-0..3` divs are gone.

### Breadcrumb trail (v1.9)

Categories are a DAG (many parents), so "the path you came through" is user
history, not graph structure — it's stored as explicit shareable state:

- `state.path` — trail of category titles, current category last. Every
  navigation funnels through `navigateTo()`, whose rule is: **target already on
  the trail → truncate to it; otherwise append** (capped at 12 segments).
- `encodePath()` / `decodePath()` — per-segment URI-encoding keeps names
  containing `/` unambiguous.
- `writeURL("push"|"replace")` — single URL writer; navigation pushes, everything
  else replaces.
- `renderCrumbs()` — the `#crumbs` row above the grid (`A › B › current`); crumbs
  navigate (truncating), the current category is non-interactive text.
- Chip delegation covers `#treebar, #tree-content, #crumbs`.
- **Trail semantics by entry point** (navigateTo's `fresh` flag):
  - **Descend, trail extends:** tile pills, treebar/tree/crumb chips, roulette.
  - **Fresh session, trail resets to `[cat]`:** search box and dropdown — picking
    a new subject shouldn't be anchored to whatever you were browsing.
  - Browser Back after a fresh pick returns to the previous session (pushState).

**Bug fixed while testing:** categories with zero direct files return
`{batchcomplete:true}` with no `query` node from `generator=categorymembers` —
`data.query.pages` crashed (pre-existing, exposed by back-to-root tests). Both
generator paths now guard `(data.query && data.query.pages)`. Also `api()` now
throws "API retries exhausted" instead of returning undefined after four
429/5xx retries (the final-attempt `continue` skipped the throw).

### Deep shuffle algorithm (v1.7)

`deepcategory:"X"` (CirrusSearch) is silently truncated: depth capped at 5
(`$wgCirrusSearchCategoryDepth`), category-count capped (`$wgCirrusSearchCategoryMax`),
and the expansion just stops at the cap (Phab T246568/T260152) — so random draws over it
are biased toward whatever survived the clip. Instead:

1. `collectSubtree()` walks the subtree client-side (BFS, depth 5 / 500-node cap,
   cycle-safe via `normCat` set), gathering each category's **direct** file count
   from `categoryinfo` — all through the 24h/7d cache, so the walk cost is paid once.
2. Pick **k=4 distinct categories** uniformly weighted by direct file count
   (without replacement; the previous batch's picks are excluded for cross-batch
   variety — `state.lastDeepPicks`). v1.7 drew all 12 from ONE category, which
   filled whole screens with a single event ("TIFF carpet" clustering).
3. Draw `incategory:"chosen"&srsort=random&srlimit=6` from each (4 parallel
   searches), interleave, dedupe to 12 — at most ~3 tiles per subject per screen.

While the walk is still running (cold cache, ~1–4 min for big trees), batches fall
back to a `deepcategory:` draw so tiles appear immediately; once it lands, batches
switch to the exact weighted sampler automatically. `state.deepWalk` is reset per
category by `resetAndFetch()`.

Trade-off: files in many categories get multiple tickets (uniform over categories,
not perfectly over files — measured below). If the walk finds no direct files
anywhere, it falls back to the old `deepcategory:` draw.

`apiThrottle()` (150ms global gap between request starts) keeps the walk under the
429 threshold; sustained heavy testing can still earn sporadic 429s, which the
existing exponential-backoff retry absorbs.

### Benchmark results (benchmark/deep-shuffle.js)

Ground truth: full enumeration of Category:Featured pictures of birds (401
categories to natural exhaustion at depth 4, 1,792 distinct files, every file's
membership listed) — a 2026-09 run. **Note (2026-10-02):** Commons housekeeping
has since reorganised that category (now 3 direct files + 34 subcategories), so
use a different root for a fresh walk — e.g. `Category:Quality images of China`
(180 direct files + 10 subcategories). Run: `node benchmark/deep-shuffle.js [Category:...] [--live]`
(cache in `cache/bench/`, ~5 min cold at 300ms pacing).

- **Coverage:** the sampler envelope sees **100%** of the tree's files at the
  500-node cap (a 200-node cap saw only 67.8% — the node cap, not depth, was the
  binding constraint; this tree never exceeds depth 4). Trees deeper than 5 levels
  would penalize the old `deepcategory:` envelope instead.
- **Uniformity:** per-file selection probability is 0.73x–2.18x of ideal (bounded
  by category-membership multiplicity: 65% of files in 1 category, 32% in 2, 3%
  in 3). Mean absolute deviation from a fair coin is ~0.02%.
- **Weighted pick:** chi-square over 100k simulated picks: p = 0.54 / 0.52 / 0.02
  across reps — consistent with weighted-uniform (the single 0.02 is a 2σ tail;
  synthetic-shape controls also scatter 0.11–0.76).
- **Server random:** 40 live `srsort=random` draws over a 36-file category returned
  every file exactly 40 times — no measurable server-side bias in `incategory` draws.
- Verdict: fair within the documented multiplicity trade-off — worst case a file is
  ~2.2x likelier than a single-category file, best case ~0.73x. The k=4 batch
  spread (above) preserves these per-file marginals while killing within-screen
  clustering; re-run the benchmark if you change pool weighting.

### Future: exact full-tree sampling (option 3)

For perfectly uniform-over-files sampling at arbitrary depth, enumerate the whole
subtree once (client-side walker without the node cap, or a PetScan query with its
category-depth parameter — PSID cacheable) and store the flat file list; then deep
shuffle = random slices of that list. Natural fit with the planned List/Snapshot
mode (file IDs via URL). Cost: minutes for huge trees, stale after mass uploads —
fine for a snapshot feature, wrong for a live shuffle.

## Known issues / open items

0. **CirrusSearch keyword instability (transient, server-side):** during
   testing, `incategory:`/`deepcategory:` intermittently returned zero results
   (T246568 degradation). Client code is correct; if shuffle suddenly returns
   nothing, check the search API directly before debugging the app.
   Observed 2026-09-04: `incategory:"Featured pictures of birds"` drew only
   3 results per `srlimit=50` request — with AND without `srsort=random` —
   while other categories (Quality images from WikiPortraits, PotY 2024)
   returned full 50s at the same moment. So the per-category index can be
   truncated, not just emptied; shuffle degrades to tiny batches from that
   category until the index heals. Diagnose with a direct search-API probe
   (±`srsort=random`, several categories) before touching app code.
   **Follow-up (2026-10-02):** that category now holds exactly 3 direct files
   (`prop=categoryinfo`: 3 files, 34 subcategories) and a live
   `generator=categorymembers` call returns 3 with no continue — so the
   "3 results" was most likely the true member count mid-reorganisation, not
   index truncation. Index truncation may still occur; check a category's
   direct-file count before blaming the index.

1. ~~**Server git checkout is stale**~~ — **Resolved 2026-10-01:** the orphaned
   `public_html/.git` checkout (web-readable `/.git/config`, `/HEAD`, `/index`) and
   the stray `/articletopic-dashboard/` + `/stats-dashboard/` dirs were deleted from
   the server after being archived to the gitignored `cache/server-hygiene-2026-10-01/`
   (verified live: all former paths 404, app files still 200). Deploys remain direct
   file copies; the public dir now holds exactly the app files + `vendor/`.
3. **Mobile video:** tapping a tile navigates to Commons (no touch preview). The old
   README claimed click-to-preview on mobile; copy now says navigation. Implementing
   touch preview (tap-to-play, tap-again-to-open) is a nice future enhancement.
4. **Tailwind is self-hosted Play-CDN build** (`vendor/tailwindcdn-3.4.16.js`,
   vendored v1.19 — no third-party requests, CSP violation gone) — but it still
   prints its "should not be used in production" console warning (baked in) and
   recompiles CSS at runtime. A future cleanup could precompile the utilities
   into `style.css` to kill both.
5. **Old build:** the PyScript version is recoverable from git history (commit `7f27078`
   and earlier) if ever needed for reference.
6. **Cache TTLs** are hardcoded in the `api()` call sites — reasonable defaults, tune if
   category data ever feels stale (e.g. after mass uploads).
7. **`categories.txt`** seeds are unchanged since March — could add new "Best of" seeds.
8. **Remaining mobile gaps (issue #17's umbrella, still open):** no touch
   video preview (taps navigate to Commons), no STL touch orbit, and tap
   targets below 44px in the treebar/crumbs rows. The collapsing header is
   shipped; a real-device pass + these touches belong in a follow-up mobile
   UX issue.

9. ~~**All `*.md` docs are publicly served.**~~ **Resolved 2026-09-11:** the public
   copies (`HANDOFF.md`, `README.md`, `PRD.md`, `DEPLOY.md`, `GEMINI.md`,
   `.idx/airules.md`) were deleted from `public_html`; all six now return 404 and
   the app files still return 200 (verified live). Every deleted file was
   hash-matched to a git revision *before* deletion (HANDOFF/README → `65e2cc8`,
   PRD/DEPLOY/GEMINI → `77a3e93`), so nothing unique was lost; a local backup also
   sits in the gitignored `cache/public-html-md-backup/`. **Rule going forward:
   never copy `*.md` into `public_html`** (see the deploy section and `AGENTS.md`).
   Root cause: Toolforge serves `public_html` via lighttpd, which ignores the
   repo's `.htaccess` — the old "blocked from web" note was never true.

## Next features (staged plan, all API-verified)

Category-tree exploration — **Stage A + B core shipped in v1.6** (treebar, tree
modal to depth 5, deep mode). Remaining:

- ~~**Stage B leftover:** visited-set dedupe~~ — **shipped** (the tree modal
  dedupes cyclic DAG references and its node budget is resumable via "Load 500
  more"). Still open from Stage B: leaf-category highlighting.
- **Stage C:** multi-select union feeds, "category roulette" (~~random
  subcategory~~ — **shipped** as the 🎲 chip), ~~tree-aware URL state
  (`path=Root/A/B`) so back/forward walks the tree~~ — **shipped** in v1.9
  (breadcrumb trail + pushState/popstate). Remaining: multi-select union feeds.
- **Banked (2026-09-04): treebar/roulette count laziness.** The treebar and
  roulette both draw on `buildTreeLevel()`, which fetches categoryinfo for ALL
  subcategories (9 batched calls for a 407-subcat category) before the 14
  chips can render. Fine when api.php is healthy, but during the 2026-09-04
  congestion event (TTFB 2–21s) this dominated cold visits to big categories.
  Idea: render chips immediately from `list=categorymembers`, stream counts in
  the background, and let the roulette fetch full counts on demand (it already
  awaits `buildTreeLevel` directly, so it is unaffected by chip-level changes).

Older roadmap (README): List/Snapshot mode via file IDs in URL, personal collections,
accounts, natural-language search, filetype filtering.

## Conventions for future sessions

- Keep the URL contract, localStorage keys, and UI behavior stable — shareable links
  are the product.
- All Action API calls through `api()`; `normCat()` for URL/state and cache keys,
  `exactCatTitle()`/`inCategory()` for feed membership (see API rules above).
- Test locally first (checklist above), then deploy + verify with SHA256.
- `AGENTS.md` (renamed from `GEMINI.md`, 2026-09-10) holds the agent-workflow rules:
  concise responses, no big refactors unless asked, JS not Python, plus the
  two-normalization rule. This file stays the single source of truth for project
  facts — don't duplicate them into `AGENTS.md`.
