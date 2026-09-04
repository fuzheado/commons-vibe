# CommonsVibe — Project Handoff

_Last updated: 2026-08-27. Read this first if you're continuing work on this project._

## What this is

A stateless, URL-driven visual discovery tool for Wikimedia Commons categories — a
"Pinterest-style" masonry feed (detailed/minimal views, alphabetical or random-shuffle
ordering, per-tile category drawer for jumping around the category graph).
Live at **https://commons-vibe.toolforge.org/**.

## Current state (updated 2026-09-04, v1.11 deployed)

- **Deployed:** live site matches `main` (verified via SHA256).
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
- **Docs:** README, PRD, GEMINI.md, DEPLOY.md all reflect the JS engine.

## Repo layout

| File | Role |
|---|---|
| `index.html` | Thin shell: header controls, masonry columns, category-editor modal. No logic. |
| `app.js` | The whole app (ES module, ~700 lines). |
| `style.css` | Custom CSS (drawer, minimal-mode overlay, toggles). Unchanged from PyScript era. |
| `categories.txt` | Seed category list. Format per line: `Category:Name | Label` (label optional). |
| `README.md` / `PRD.md` / `DEPLOY.md` / `GEMINI.md` | Project docs. GEMINI.md = agent rules (JS-era). |
| `LICENSE` | MIT (Toolforge rule: OSI license required). |
| `.htaccess` | Blocks `*.md` from web; 404s `.idx`. NOTE: `*.txt` must stay servable (app fetches `categories.txt`). |
| `.idx/` | Firebase Studio (IDX) dev-env config — not app code, leave alone. |
| `cache/`, `.playwright-cli/` | Local test artifacts, gitignored. |
| `benchmark/deep-shuffle.js` | Sampler benchmark: enumerates a subtree as ground truth, measures envelope coverage + per-file uniformity, chi-square on the weighted pick, optional live `srsort=random` validation (`--live`). |

## URL contract & persistence (do not break)

- **URL params:** `?cat=<Category>&sort=alpha|shuffle&view=det|min&size=s|m|l&type=all|image|video|audio&path=<trail>[&deep=1][&tree=1&depth=N][&pile=|&psid=|&pet=&petdepth=]`.
  `type=` filters the feed client-side (alpha/list) and server-side (shuffle/deep
  append CirrusSearch `filetype:` terms). `pile=`/`psid=`/`pet=` activate **list
  mode**: the feed renders an external file list instead of a category
  (`pet=` runs a live PetScan query on a category with `petdepth=`; 1h client
  cache). List mode hides the sort pill and treebar; the dropdown shows the
  list label; clicking any category pill exits list mode. All previous params
  behave exactly as before.
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
- **localStorage keys:** `vibe_config` (category list, `Category:Name | Label` lines)
  and `cv_api_cache_v1` (API response cache).
- Categories visited via search/pills/URL are auto-added to `vibe_config`.

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
    subcategory that has files; trail + Back/Forward integrate.
17. Type filter: header select — Images/Video/Audio filter the feed (shuffle
    filters server-side; alpha client-side); `type=` round-trips; "All Media"
    restores.
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

## Deploy to Toolforge

Tool: `commons-vibe`, webservice `php8.4` (Kubernetes), files in
`/data/project/commons-vibe/public_html/`. Static changes need no restart.

```bash
# per file — pipe-through-sudo keeps ownership tools.commons-vibe
cat index.html | ssh alih@dev.toolforge.org \
  'sudo -niu tools.commons-vibe sh -c "cat > /data/project/commons-vibe/public_html/index.html"'
# ...repeat for app.js style.css categories.txt .htaccess (docs: README PRD GEMINI DEPLOY)
```

Verify after deploy:
```bash
# local ↔ server
ssh alih@dev.toolforge.org "sha256sum /data/project/commons-vibe/public_html/app.js"
shasum -a 256 app.js
# server ↔ live web
curl -s -A "$WIKIMEDIA_USER_AGENT" https://commons-vibe.toolforge.org/app.js | shasum -a 256
# browser smoke test on the live URL (see checklist above)
```

## API integration rules (hard-won gotchas)

All in `api(params, {ttl})` in `app.js` — always route queries through it.

- **Tracking params:** the Action API appends `?utm_source=...&utm_content=original` to
  `url`/`thumburl`/derivative `src` values. Strip with `cleanUrl()` before extension
  checks or media use.
- **Media detection:** use `mediatype`/`mime` fields, NOT URL suffixes (this broke video
  rendering in the old PyScript build). Derivative `type` may be
  `video/webm; codecs="vp9, opus"` — split on `;` before comparing.
- **Case/underscore:** Commons treats `_` and spaces as equivalent. Compare with
  `normCat()` (spaces + lowercase). The old editor rejected underscore categories as
  invalid — that bug is fixed.
- **Format:** `formatversion=2` everywhere (pages are arrays). `origin=*` for CORS.
- **Batching:** max 50 titles per query; editor validation chunks at 50.
- **Caching:** `{ttl: N}` enables the localStorage cache. NEVER cache shuffle searches
  (`{ttl: 0}`) — serendipity dies. Alpha batches: 24h; categoryinfo/validation: 7d.
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
- `resetAndFetch()` — clears grid, bumps requestId, aborts, refetches.
- `init()` — URL param bootstrap, event binding, IntersectionObserver.

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
- **Type filter:** header `type-select` (All/Images/Video/Audio). `pageKind()`
  classifies from `mediatype`/`mime` (now requested explicitly —
  `iiprop=url|extmetadata|derivatives` OVERRIDES API defaults and omits them;
  classic gotcha). Client-side in renderPages (alpha/list) + server-side
  `filetype:` terms in shuffle/deep searches (`TYPE_TERM`; multi-value
  `filetype:"bitmap|drawing"` needs quotes).
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
membership listed). Run: `node benchmark/deep-shuffle.js [Category:...] [--live]`
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

1. **Server git checkout is stale** — `/data/project/commons-vibe/public_html/.git` is an
   orphaned March checkout (FETCH_HEAD `f3e0b71`; HEAD on a dead `master` ref).
   Deploys are direct file copies. Either re-init it for git deploys or delete it.
2. **Stray public dirs:** `/articletopic-dashboard/` and `/stats-dashboard/` in
   `public_html` are served publicly but not in the repo — delete, archive, or fold in.
3. **Mobile video:** tapping a tile navigates to Commons (no touch preview). The old
   README claimed click-to-preview on mobile; copy now says navigation. Implementing
   touch preview (tap-to-play, tap-again-to-open) is a nice future enhancement.
4. **Tailwind CDN warning** ("should not be used in production") — pre-existing; a
   future cleanup could precompile the ~20 utility classes into `style.css`.
5. **Old build:** the PyScript version is recoverable from git history (commit `7f27078`
   and earlier) if ever needed for reference.
6. **Cache TTLs** are hardcoded in the `api()` call sites — reasonable defaults, tune if
   category data ever feels stale (e.g. after mass uploads).
7. **`categories.txt`** seeds are unchanged since March — could add new "Best of" seeds.

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
- All API calls through `api()`; all category comparisons through `normCat()`.
- Test locally first (checklist above), then deploy + verify with SHA256.
- GEMINI.md contains the agent-workflow rules (concise responses, no big refactors
  unless asked, JS not Python).
