# AGENTS.md — working rules for CommonsVibe

Agent instructions for this repo. **Read `HANDOFF.md` first** — it is the single
source of truth for project state, the URL contract, API gotchas, tests and
deploy. This file only covers how to work here, plus the constraints that must
not be broken. (Renamed from `GEMINI.md` on 2026-09-10; it was never Google-specific.)

## How to work here

- **Ship diffs, not essays.** On CSS/HTML/JS tweaks, edit and show the change —
  don't spend turns restating the plan.
- **Localized edits only.** No global refactors, renames, or "let me restructure
  this" passes unless explicitly asked for in the same request.
- **JS, not Python.** The app is a vanilla-JS ES module. Anything that assumes
  Python, Pyodide, or a build step is wrong.
- **Update `HANDOFF.md` in the same commit** when you change behavior, the URL
  contract, or a known issue. Do not create a second handoff doc.
- **Verify before claiming.** `tests/run.sh` for behavior; a live HTTP check for
  anything that changes requests. Deploy + SHA256 verification steps are in
  `HANDOFF.md`.

## Hard constraints (do not "improve" away)

- **No PyScript/Pyodide, React, TypeScript, Node server, or bundler.** Static
  site, no build step. three.js is vendored in `vendor/` because Toolforge CSP
  blocks CDN module imports (`index.html` carries the import map).
- **All Wikimedia Action API traffic goes through `api()`** in `app.js` — it
  centralises `origin=*`, `formatversion=2`, the 150 ms global throttle, the
  in-memory + localStorage cache, and 429/5xx retry with `Retry-After`.
  Never hand-roll a parallel `fetch` to `commons.wikimedia.org`. Three non-Action-API
  fetches legitimately sit outside it: `categories.txt`, the PagePile/PetScan list
  fetch, and STL model bytes.
- **Caching:** `api()`'s default is `ttl: 0` = uncached, and that default is what
  keeps serendipity alive — never add a TTL to a shuffle/deep/roulette draw. Pass
  a TTL only for stable endpoints (category info, lists, validation).
- **Do not add request headers to `api()`** (no `Api-User-Agent`, no custom UA):
  a header-free GET stays a CORS *simple request* with no preflight. See
  `HANDOFF.md` §"Browser fetches stay header-free".
- **Tailwind is Play-CDN only** (known open item in `HANDOFF.md`). Don't stand up
  build tooling to "fix" it without asking.

## Category names — the two-normalization rule

Two different normalizations exist on purpose. Using the wrong one is a bug.

- **`normCat()`** (underscores → spaces, lowercase) is for URL/state keys and
  cache keys, where the two spellings *should* collapse together.
- **`exactCatTitle()` / `inCategory()` / `filterShufflePages()`** are for feed
  membership. CirrusSearch `incategory:`/`deepcategory:` match category titles
  case-insensitively while Commons does not (`Category:Chop Suey` the Hopper
  painting vs `Category:Chop suey` the dish), so a drawn page's own `categories`
  must be checked against the *exact* target title before render. Comparing feed
  results with `normCat()` is exactly the v1.14.1 bug — don't reintroduce it.

## URL contract

`?cat=&sort=&view=&size=&type=&path=&deep=&tree=&depth=&pile=&psid=&pet=&petdepth=`
— the full list and each param's behaviour is in `HANDOFF.md` §"URL contract &
persistence (do not break)". Shareable links *are* the product: don't break the
`state → URL → state` round-trip, and don't change the `vibe_config`
localStorage keys.

## Repo map (quick)

- `index.html` — thin shell (header, masonry container, modals). No logic.
- `app.js` — the entire app.
- `style.css` — custom CSS the CDN utilities can't express (masonry columns,
  drawer, minimal-mode overlay, collapsing header).
- `tests/` — Playwright suite + `run.sh`; `benchmark/` — deep-shuffle sampler;
  `vendor/` — three.js r170 (MIT); `categories.txt` — seed list.
- `.idx/` — legacy Firebase Studio dev-env config, not app code. Note: Gemini
  *in Firebase Studio* reads `.idx/airules.md`, not this file.

## These docs are publicly readable

The Toolforge host serves `public_html` as plain static files and does **not**
honour `.htaccess` — the file is itself served (HTTP 200, verified 2026-09-10),
and every `*.md` here (including `HANDOFF.md`) is live at
`https://commons-vibe.toolforge.org/<file>.md`. Treat all of these files as
public: no credentials, tokens, or private contact details, and keep server
paths / deploy commands to what's already disclosed.
