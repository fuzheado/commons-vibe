# CommonsVibe: Project Rules & Context

## 🛠️ Core Tech Stack
- **Engine:** Vanilla JavaScript (ES module, `app.js`) — no framework, no build step. Replaced the PyScript/Pyodide runtime (2026-08) for startup speed, payload size, and hot-loop performance.
- **Frontend Logic:** All logic lives in `app.js` as an ES module. `index.html` is a thin shell (header, masonry grid, category-editor modal).
- **API:** Wikimedia Action API + CirrusSearch for "Shuffle" mode. All calls go through the `api()` helper in `app.js`, which handles caching (in-memory + localStorage), 429/5xx retry with backoff, and stale-request aborts.
- **Layout:** Responsive Masonry Grid (Pinterest-style) — 1/2/3/4 columns via Tailwind breakpoint classes.

## 🚦 API Etiquette
- Every API request must include `origin=*` (CORS for browser calls).
- Use `formatversion=2` and batch titles with `|` (max 50 per call).
- The Action API appends `?utm_*` tracking params to `url`/`thumburl` values — strip them with `cleanUrl()` before extension checks or media use.
- Media-type detection must use the `mime`/`mediatype` fields, not URL suffixes alone.

## 💡 Quota Optimization Rules
- **Direct Execution:** Do not "think" or "plan" for more than one turn on CSS/HTML tweaks.
- **Flash-First:** If the task is purely descriptive (README, comments, documentation), use Gemini 3 Flash.
- **No Refactors:** Never suggest "Global Refactors" unless specifically requested. Stick to localized file edits to minimize token exchange.
- **Brief Responses:** Keep chat responses concise. Focus on the code diffs rather than explaining theory.

## ⚙️ JS Engine Specifics
- The app is an ES module: `index.html` → `<script type="module" src="app.js">`.
- **State:** the `state` object at the top of `app.js`; `requestId` + `AbortController` guard against stale fetches.
- **Infinite Scroll:** IntersectionObserver on `#sentinel` + a one-batch prefetch queue (`prefetchPromise`). After each batch, if the sentinel is still within viewport+800px, loading continues (fill-up) — do not remove this or short pages stall.
- **Caching:** `api(params, {ttl})` caches by URL; use `{ttl: 0}` for random/shuffle queries (serendipity must not be cached).

## 🔗 URL State Management
- All application states (category, sort, view) MUST be reflected in URL parameters: `?cat=<Category>&sort=alpha|shuffle&view=det|min`.
- Use `history.replaceState` so views remain shareable; the logo (`href="/"`) is the reset.
- Category names: Commons treats `_` and spaces as equivalent — normalize with `normCat()` (spaces + lowercase) before any comparison.

## 🚫 Exclusions
- Do not reintroduce PyScript, Node.js servers, React, or TypeScript. This is a dependency-free, static-site, vanilla-JS project.
