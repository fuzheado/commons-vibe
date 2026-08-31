# CommonsVibe — Project Handoff

_Last updated: 2026-08-27. Read this first if you're continuing work on this project._

## What this is

A stateless, URL-driven visual discovery tool for Wikimedia Commons categories — a
"Pinterest-style" masonry feed (detailed/minimal views, alphabetical or random-shuffle
ordering, per-tile category drawer for jumping around the category graph).
Live at **https://commons-vibe.toolforge.org/**.

## Current state (as of this handoff)

- **Engine:** Vanilla JS ES module (`app.js`). The PyScript/Pyodide 2026.1.1 build was
  fully replaced (commit `77a3e93`) — the app is DOM/API glue, and the ~10 MB WASM
  runtime was pure overhead. **Do not reintroduce PyScript.**
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

## URL contract & persistence (do not break)

- **URL params:** `?cat=<Category>&sort=alpha|shuffle&view=det|min`. Written with
  `history.replaceState` on every state change; the logo (`href="/"`) is the reset.
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
- **Retry/abort:** 429/5xx retried with exponential backoff (max 4 attempts); every
  reset aborts in-flight fetches (`state.abort`) and bumps `state.requestId`.

## Code map (`app.js`)

- `api()` / `cacheGet` / `cachePut` — API layer with cache + retry.
- `state` — all mutable state; `requestId` guards stale renders.
- `fetchBatch()` — alpha (generator+continue token, cacheable) vs shuffle
  (CirrusSearch random, 24 results → dedupe → 12) in one place.
- `getBatch()` / `prefetchNext()` — one-batch lookahead queue.
- `fetchImages()` — orchestration + sentinel fill-up loop (`lastBatchOk`).
- `buildCard()` — tile DOM; `pickBestVideo()`, `srcsetFor()`, drawer/pill wiring.
- `resetAndFetch()` — clears grid, bumps requestId, aborts, refetches.
- `init()` — URL param bootstrap, event binding, IntersectionObserver.

## Known issues / open items

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

Category-tree exploration — the agreed direction:

- **Stage A (cheap):** breadcrumb trail of parent categories (`prop=categories`,
  filter ns=14) + subcategory chip row with file-count badges (one `cmtype=subcat` call
  + one batched `categoryinfo` call), both clickable to navigate.
- **Stage B:** "Include subcategories" (deep mode) toggle — swap `incategory:` for
  `deepcategory:"X"` in the shuffle engine (verified live: returns the whole subtree;
  note CirrusSearch caps depth at ~5). Plus expand-on-demand tree sidebar with
  leaf-category highlighting (dedupe against a visited set — the Commons category graph
  is a DAG with cycles).
- **Stage C:** multi-select union feeds, "category roulette" (random subcategory),
  tree-aware URL state (`path=Root/A/B`) so back/forward walks the tree.

Older roadmap (README): List/Snapshot mode via file IDs in URL, personal collections,
accounts, natural-language search, filetype filtering.

## Conventions for future sessions

- Keep the URL contract, localStorage keys, and UI behavior stable — shareable links
  are the product.
- All API calls through `api()`; all category comparisons through `normCat()`.
- Test locally first (checklist above), then deploy + verify with SHA256.
- GEMINI.md contains the agent-workflow rules (concise responses, no big refactors
  unless asked, JS not Python).
