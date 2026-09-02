/* CommonsVibe — vanilla JS engine (v1.11)
 * Category tree (v1.6): tree modal (depth 1–5, lazy expand), inline treebar
 * (parent + subcategory chips with file counts), deep mode (shuffle the whole
 * subtree via CirrusSearch deepcategory, URL param deep=1).
 * Tile size control (v1.8): S/M/L density, shortest-column placement, full
 * reflow on size change and window resize. URL param size=s|m|l.
 * Breadcrumb trail (v1.9): path= URL param, pushState/popstate history walk.
 * List mode + type filter (v1.11): feed from PagePile (?pile=), PetScan query
 * (?psid= or ?pet=&petdepth=), and ?type= media-type filter; category roulette.
 * Replaces the PyScript/Pyodide runtime (2026.1.1).
 * Same public URL contract: ?cat=<Category>&sort=alpha|shuffle&view=det|min
 * Same localStorage key: vibe_config
 *
 * Performance layer added on top of the original behavior:
 *   - API response cache (in-memory + localStorage, TTL per endpoint kind)
 *   - One-batch prefetch lookahead so infinite scroll never stalls
 *   - 429/5xx retry with exponential backoff
 *   - Stale-request abort (AbortController + request-id guard)
 *   - preload="none" media; hover-only video load
 *   - Retina srcset derived from the 600px thumb (no extra API calls)
 *   - Proper HTML escaping in tile attributes (was missing in the PyScript build)
 */
"use strict";

const API_BASE = "https://commons.wikimedia.org/w/api.php";
const LS_KEY = "vibe_config";
const DISK_CACHE_KEY = "cv_api_cache_v1";
const MAX_DISK_CACHE = 2_000_000; // bytes, rough
const MEM_CACHE_MAX = 300; // entries
const UA_NOTE = "CommonsVibeExplorer/1.10 (https://commons-vibe.toolforge.org/; contact: User:Fuzheado)";

const state = {
  config: "",                    // categories.txt content + session additions
  currentCategory: "",
  sortShuffle: false,
  minimalView: false,
  continueToken: null,           // alpha-mode paging token
  isLoading: false,
  hasReachedEnd: false,
  seenTitles: new Set(),         // shuffle-mode dedupe within a session
  deepMode: false,               // shuffle across the whole subcategory tree
  treeOpen: false,               // tree modal visibility (URL param tree=1)
  treeDepth: 2,                  // tree modal depth 1–5 (URL param depth=N)
  size: "m",                     // tile density s|m|l (URL param size=)
  type: "all",                   // media filter all|image|video|audio (URL param type=)
  lastDeepPicks: new Set(),      // categories used by the previous deep batch
  list: null,                    // list mode: {source:'pile'|'psid'|'pet', id, depth?, titles, cursor}
  path: [],                      // breadcrumb trail, current category last (URL param path=)
  items: [],                     // placed cards in fetch order (reflow source)
  colCount: 0,                   // live column count
  colHeights: [],                // tracked column heights for shortest-col place
  deepWalk: null,                // in-flight/resolved subtree walk (deep mode)
  requestId: 0,                  // stale-response guard
  abort: new AbortController(),
};

/* ---------------- tiny helpers ---------------- */

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function esc(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanHtml(text) {
  if (!text) return "";
  return String(text).replace(/<[^>]+>/g, "").trim();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Like Python's urllib.parse.quote(safe="/")
function quotePath(s) {
  return encodeURIComponent(s).replace(/%2F/gi, "/");
}

// Commons treats underscores and spaces as equivalent in titles; the API
// returns spaces while config files often use underscores. Normalize for
// comparisons, keep the original string for display/API use.
const normCat = (c) => String(c).replace(/_/g, " ").toLowerCase();

function configCats() {
  return state.config
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.includes("|") ? l.split("|")[0].trim() : l.trim()));
}

function addCategoryToConfig(cat) {
  if (configCats().some((c) => normCat(c) === normCat(cat))) return;
  state.config = state.config.trim() + "\n" + cat;
  saveConfig();
}

/* ---------------- API layer with cache + retry ---------------- */

const memCache = new Map(); // url -> {ts, body}
let diskCache = {};
try {
  diskCache = JSON.parse(localStorage.getItem(DISK_CACHE_KEY)) || {};
} catch {
  diskCache = {};
}

function cacheGet(url, ttl) {
  const hit = memCache.get(url);
  if (hit && Date.now() - hit.ts < ttl) return hit.body;
  const d = diskCache[url];
  if (d && Date.now() - d.ts < ttl) {
    memCache.set(url, d);
    return d.body;
  }
  return null;
}

function cachePut(url, body) {
  const entry = { ts: Date.now(), body };
  memCache.set(url, entry);
  if (memCache.size > MEM_CACHE_MAX) {
    const oldest = memCache.keys().next().value;
    memCache.delete(oldest);
  }
  diskCache[url] = entry;
  let size = 0;
  try {
    size = JSON.stringify(diskCache).length;
  } catch { /* ignore */ }
  if (size > MAX_DISK_CACHE) {
    const keys = Object.keys(diskCache).sort((a, b) => diskCache[a].ts - diskCache[b].ts);
    for (const k of keys) {
      delete diskCache[k];
      if (JSON.stringify(diskCache).length < MAX_DISK_CACHE * 0.75) break;
    }
  }
  try {
    localStorage.setItem(DISK_CACHE_KEY, JSON.stringify(diskCache));
  } catch { /* quota exceeded — skip persistence */ }
}

/**
 * Call the Commons Action API. `ttl` (ms) > 0 enables caching for this call.
 * Retries 429/5xx/network errors with exponential backoff.
 * All fetches pass through a global throttle (>= API_GAP_MS between request
 * starts) — bursts of parallel tree/cache calls otherwise trip HTTP 429.
 */
const API_GAP_MS = 150;
let lastApiStart = 0;
let apiChain = Promise.resolve();
function apiThrottle() {
  const slot = apiChain.then(async () => {
    const now = Date.now();
    const wait = lastApiStart + API_GAP_MS - now;
    if (wait > 0) await sleep(wait);
    lastApiStart = Date.now();
  });
  apiChain = slot.catch(() => {});
  return slot;
}

async function api(params, { ttl = 0 } = {}) {
  params = { ...params, format: "json", formatversion: "2", origin: "*" };
  const url = API_BASE + "?" + new URLSearchParams(params).toString();
  if (ttl > 0) {
    const hit = cacheGet(url, ttl);
    if (hit) return hit;
  }
  const signal = state.abort.signal;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      await apiThrottle();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const resp = await fetch(url, { signal });
      if (resp.status === 429 || resp.status >= 500) {
        const retryAfter = parseInt(resp.headers.get("retry-after") || "0", 10);
        await sleep(retryAfter ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 8000));
        continue;
      }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data.error) throw new Error(`API error ${data.error.code}: ${data.error.info || ""}`);
      if (ttl > 0) cachePut(url, data);
      return data;
    } catch (e) {
      if (e.name === "AbortError" || signal.aborted) throw e;
      if (attempt === 3) throw e;
      console.warn("api retry", attempt + 1, e.message);
      await sleep(1000 * 2 ** attempt);
    }
  }
  // Exhausted all attempts on retryable errors (429/5xx) — throw instead of
  // falling through with undefined (fetchBatch would crash on data.query).
  throw new Error("API retries exhausted");
}

/* ---------------- config persistence ---------------- */

async function loadConfig() {
  const saved = localStorage.getItem(LS_KEY);
  if (saved) {
    state.config = saved;
    return;
  }
  try {
    const resp = await fetch("categories.txt");
    if (resp.ok) {
      state.config = (await resp.text()).trim();
      localStorage.setItem(LS_KEY, state.config);
      return;
    }
  } catch (e) {
    console.warn("categories.txt fetch failed:", e);
  }
  state.config = "Category:Featured_pictures_on_Wikimedia_Commons | Featured";
}

function saveConfig() {
  localStorage.setItem(LS_KEY, state.config.trim());
}

/* ---------------- header / URL state ---------------- */

async function fetchCategoryInfo() {
  if (state.list) {
    $("cat-count").textContent = state.list.titles.length.toLocaleString("en-US");
    return;
  }
  try {
    const data = await api(
      { action: "query", titles: state.currentCategory, prop: "categoryinfo" },
      { ttl: 7 * 24 * 3600e3 },
    );
    const page = (data.query.pages || [])[0];
    const files = (page && page.categoryinfo ? page.categoryinfo.files : 0) || 0;
    $("cat-count").textContent = files.toLocaleString("en-US");
  } catch (e) {
    console.warn("categoryinfo failed:", e);
    $("cat-count").textContent = "0";
  }
}

// Breadcrumb trail segments are stored WITHOUT the Category: prefix and each
// segment is URI-encoded before joining with "/" — category names may legally
// contain "/", which becomes %2F and stays unambiguous.
function encodePath(pathArr) {
  return pathArr.map((c) => encodeURIComponent(c.replace(/^Category:/, ""))).join("/");
}

function decodePath(str) {
  return str.split("/")
    .filter(Boolean)
    .map((s) => "Category:" + decodeURIComponent(s));
}

function writeURL(mode) {
  const params = new URLSearchParams({
    sort: state.sortShuffle ? "shuffle" : "alpha",
    view: state.minimalView ? "min" : "det",
  });
  if (!state.list) params.set("cat", state.currentCategory);
  if (state.deepMode) params.set("deep", "1");
  params.set("size", state.size);
  params.set("type", state.type);
  if (state.path.length > 1) params.set("path", encodePath(state.path));
  if (state.list) {
    params.set(state.list.source, state.list.id);
    if (state.list.source === "pet") params.set("petdepth", String(state.list.depth));
  }
  if (state.treeOpen) {
    params.set("tree", "1");
    params.set("depth", String(state.treeDepth));
  }
  const qs = "?" + params.toString();
  // Toggles replace (view state); category navigation pushes (Back walks the
  // descent path — see popstate in init).
  if (mode === "push") history.pushState(null, "", qs);
  else history.replaceState(null, "", qs);
}

function updateURL() {
  writeURL("replace");
}

function rebuildDropdown() {
  const select = $("vibe-select");
  select.innerHTML = "";
  if (state.list) {
    const opt = document.createElement("option");
    const L = state.list;
    opt.text = L.source === "pile" ? `PagePile ${L.id}` : L.source === "psid" ? `PetScan ${L.id}` : `PetScan: ${L.id}`;
    opt.selected = true;
    select.add(opt);
    return;
  }
  const lines = state.config
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const cats = lines.map((l) => (l.includes("|") ? l.split("|")[0].trim() : l.trim()));
  if (!state.currentCategory && cats.length) state.currentCategory = cats[0];
  const display = [...lines];
  if (state.currentCategory && !cats.some((c) => normCat(c) === normCat(state.currentCategory))) {
    display.push(state.currentCategory);
  }
  for (const line of display) {
    let cat, label;
    if (line.includes("|")) {
      const parts = line.split("|").map((p) => p.trim());
      cat = parts[0];
      label = parts[1] || cat.replace("Category:", "").replaceAll("_", " ");
    } else {
      cat = line.trim();
      label = cat.replace("Category:", "").replaceAll("_", " ");
    }
    const opt = document.createElement("option");
    opt.value = cat;
    opt.text = label;
    opt.selected = cat === state.currentCategory;
    select.add(opt);
  }
}

/* ---------------- category tree helpers ---------------- */

// Batched categoryinfo (files + subcats counts) — max 50 titles per call.
async function getCatInfo(titles) {
  const map = new Map();
  const chunks = [];
  for (let i = 0; i < titles.length; i += 50) chunks.push(titles.slice(i, i + 50));
  await Promise.all(chunks.map(async (chunk) => {
    const data = await api(
      { action: "query", titles: chunk.join("|"), prop: "categoryinfo" },
      { ttl: 7 * 24 * 3600e3 },
    );
    for (const p of data.query.pages || []) {
      const v = p.categoryinfo
        ? { files: p.categoryinfo.files || 0, subcats: p.categoryinfo.subcats || 0 }
        : { files: 0, subcats: 0 };
      // Key by normalized title — callers may pass underscore variants.
      map.set(normCat(p.title), v);
      map.set(p.title, v);
    }
  }));
  return map;
}

// Parent categories of one category (ns=14 only; hidden parents flagged).
async function fetchParents(catTitle) {
  const data = await api(
    { action: "query", titles: catTitle, prop: "categories", clnamespace: "14", cllimit: "max", clprop: "hidden" },
    { ttl: 24 * 3600e3 },
  );
  const page = (data.query.pages || [])[0];
  return (page && page.categories) || [];
}

// Immediate subcategories of one category, with file/subcat counts.
async function buildTreeLevel(catTitle) {
  const data = await api(
    { action: "query", list: "categorymembers", cmtitle: catTitle, cmtype: "subcat", cmlimit: "max" },
    { ttl: 24 * 3600e3 },
  );
  const titles = ((data.query && data.query.categorymembers) || []).map((m) => m.title);
  if (!titles.length) return [];
  const info = await getCatInfo(titles);
  return titles.map((t) => ({ title: t, ...(info.get(normCat(t)) || { files: 0, subcats: 0 }) }));
}

const catDisplayName = (t) => t.replace("Category:", "").replaceAll("_", " ");

/* ---------------- media type filter ---------------- */

// CirrusSearch filetype terms (validated live; multi-value needs quotes).
const TYPE_TERM = {
  image: 'filetype:"bitmap|drawing"',
  video: "filetype:video",
  audio: "filetype:audio",
};

function typeSearchTerm() {
  return state.type !== "all" ? " " + TYPE_TERM[state.type] : "";
}

// Classify a page for client-side filtering (alpha mode / list mode).
function pageKind(page) {
  const info = {};
  if (page.imageinfo && page.imageinfo[0]) Object.assign(info, page.imageinfo[0]);
  if (page.videoinfo && page.videoinfo[0]) Object.assign(info, page.videoinfo[0]);
  const mt = (info.mediatype || "").toUpperCase();
  const mime = (info.mime || "").toLowerCase();
  if (mt === "VIDEO" || mime.startsWith("video/")) return "video";
  if (mt === "AUDIO" || mime.startsWith("audio/")) return "audio";
  if (mt === "BITMAP" || mt === "DRAWING" || mime.startsWith("image/")) return "image";
  return null; // office docs, unknown — only shown with the All filter
}

function setType(t) {
  if (!TYPE_TERM[t] && t !== "all") return;
  if (state.type === t) return;
  state.type = t;
  updateURL();
  resetAndFetch();
}

/* ---------------- category roulette ---------------- */

// Jump to a random subcategory, weighted by direct file count so the dice
// never land on an empty branch (falls back to uniform when all are empty).
async function categoryRoulette() {
  if (state.list || !state.currentCategory) return;
  try {
    const rows = await buildTreeLevel(state.currentCategory);
    const withFiles = rows.filter((r) => r.files > 0);
    const pool = withFiles.length ? withFiles : rows;
    if (!pool.length) {
      window.alert("No subcategories to spin through here.");
      return;
    }
    const total = pool.reduce((s, r) => s + Math.max(r.files, 1), 0);
    let r = Math.random() * total;
    let pick = pool[pool.length - 1];
    for (const row of pool) {
      r -= Math.max(row.files, 1);
      if (r <= 0) { pick = row; break; }
    }
    navigateTo(pick.title);
  } catch (e) {
    console.error("roulette failed:", e);
  }
}

/* ---------------- list mode (PagePile / PetScan) ---------------- */

// PetScan and PagePile both send access-control-allow-origin: *, so the
// browser fetches them directly. PetScan response shape:
//   {"*":[{"a":{"*":[{title,...},...]}}]} — bare titles (no File: prefix).
function listApiUrl(L) {
  if (L.source === "pile") return `https://pagepile.toolforge.org/api.php?id=${L.id}&action=get_data&format=json`;
  if (L.source === "psid") return `https://petscan.wmcloud.org/?psid=${L.id}&format=json&ns%5B6%5D=1`;
  return `https://petscan.wmcloud.org/?language=commons&project=wikimedia&categories=${encodeURIComponent(L.id)}&ns%5B6%5D=1&depth=${L.depth}&format=json`;
}

async function loadList() {
  const L = state.list;
  const url = listApiUrl(L);
  const cached = cacheGet(url, 3600e3); // snapshots: 1h
  if (cached) { L.titles = cached; return; }
  const resp = await fetch(url, { signal: state.abort.signal, headers: { "Api-User-Agent": UA_NOTE } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  let rows;
  if (L.source === "pile") rows = data.pages || [];
  else rows = ((((data["*"] || [])[0] || {}).a || {})["*"]) || [];
  // PetScan rows are objects ({title, n}); PagePile returns plain strings.
  const titles = rows
    .map((t) => (typeof t === "string" ? t : t.title || ""))
    .filter(Boolean)
    .map((t) => (/^File:/i.test(t) ? t : "File:" + t));
  cachePut(url, titles);
  L.titles = titles;
}

// List feed: imageinfo per 12-title slice, in list order (deterministic —
// PetScan output order), skipping titles that resolve to nothing.
async function listBatch() {
  const L = state.list;
  const slice = L.titles.slice(L.cursor, L.cursor + 12);
  L.cursor += slice.length;
  if (!slice.length) return { pages: [], hasEnded: true };
  const info = await api({
    action: "query",
    titles: slice.join("|"),
    prop: "imageinfo|videoinfo|categories",
    clprop: "hidden",
    cllimit: "max",
    iiprop: "url|extmetadata|derivatives|mediatype|mime",
    viprop: "url|derivatives",
    iiurlwidth: "600",
  });
  const pages = ((info.query && info.query.pages) || []).filter((p) => !p.missing);
  return { pages, hasEnded: L.cursor >= L.titles.length };
}

function setList(source, id, depth) {
  state.list = { source, id, depth: depth || 1, cursor: 0, titles: [] };
  state.path = [];
  syncDeepUI();
  return loadList().catch((e) => {
    console.error("list load failed:", e);
    state.list = null;
    window.alert(`Couldn't load that ${source === "pile" ? "PagePile" : "PetScan"} list: ${e.message}`);
  });
}

/* ---------------- batch fetching (alpha + shuffle) ---------------- */

// Pull up to `limit` unseen titles from search results, marking them seen.
function pickNewTitles(results, limit = 12) {
  const titles = [];
  for (const r of results) {
    if (!state.seenTitles.has(r.title)) {
      state.seenTitles.add(r.title);
      titles.push(r.title);
    }
    if (titles.length >= limit) break;
  }
  return titles;
}

// Random draw from a single category — exact (no caps, no depth expansion).
async function flatSampleTitles() {
  const catName = state.currentCategory.replace(/^Category:/, "").replace(/_/g, " ");
  const search = await api({
    action: "query",
    list: "search",
    srsearch: `incategory:"${catName}"${typeSearchTerm()}`,
    srnamespace: "6",
    srlimit: "50",
    srsort: "random",
  });
  return pickNewTitles((search.query && search.query.search) || []);
}

// Bounded-concurrency map (the API etiquette: no stampedes of parallel calls).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Deep-shuffle walk bounds. deepcategory:'X' silently truncates at depth 5 and
// category caps (T246568), so we walk the subtree ourselves instead. Benchmark
// (benchmark/deep-shuffle.js): on a 401-category tree a 200-node cap hid 32% of
// files — with the 120ms throttle a 500-node walk is safe, just slow cold.
const DEEP_WALK_DEPTH = 5;
const DEEP_WALK_MAX_NODES = 500;

// Enumerate the subtree, returning [{title, files}] (files = direct file count).
async function collectSubtree(rootCat, { depth = DEEP_WALK_DEPTH, maxNodes = DEEP_WALK_MAX_NODES } = {}) {
  const pool = [{ title: rootCat, files: 0 }];
  try {
    const info = await getCatInfo([rootCat]);
    pool[0].files = (info.get(normCat(rootCat)) || {}).files || 0;
  } catch { /* weight 0 for root */ }
  const seen = new Set([normCat(rootCat)]); // the category graph is a DAG with cycles
  let frontier = [rootCat];
  for (let level = 0; level < depth && frontier.length && pool.length < maxNodes; level++) {
    const levels = await mapLimit(frontier, 4, (c) => buildTreeLevel(c).catch(() => []));
    const next = [];
    for (const rows of levels) {
      for (const row of rows) {
        if (seen.has(normCat(row.title))) continue;
        seen.add(normCat(row.title));
        pool.push({ title: row.title, files: row.files });
        next.push(row.title);
        if (pool.length >= maxNodes) break;
      }
      if (pool.length >= maxNodes) break;
    }
    frontier = next;
  }
  return pool;
}

// Deep shuffle: draw each batch from SEVERAL distinct subcategories so a
// single event/subject can't fill the whole screen (a v1.7 complaint: one
// weighted pick of 12 files turned every screen into one event's red carpet).
// Still weighted sampling — per-file fairness is unchanged — but each batch
// spans k distinct categories, and the previous batch's picks are avoided.
const DEEP_BATCH_SPREAD = 4; // categories per batch
const DEEP_DRAW_LIMIT = 6;   // random files fetched per chosen category

async function deepSampleTitles() {
  const fallbackDraw = async () => {
    const catName = state.currentCategory.replace(/^Category:/, "").replace(/_/g, " ");
    const search = await api({
      action: "query",
      list: "search",
      srsearch: `deepcategory:"${catName}"${typeSearchTerm()}`,
      srnamespace: "6",
      srlimit: "50",
      srsort: "random",
    });
    return pickNewTitles((search.query && search.query.search) || []);
  };

  // Walk once per category (cached API calls make re-walks cheap). While the
  // walk is still running, batches fall back to a deepcategory draw so the
  // grid never stalls; once it lands, batches switch to the exact sampler.
  if (!state.deepWalk) {
    state.deepWalk = collectSubtree(state.currentCategory).catch(() => null);
  }
  const pool = await Promise.race([state.deepWalk, sleep(800).then(() => null)]);
  if (!pool) return fallbackDraw();
  const weighted = pool.filter((n) => n.files > 0);
  if (!weighted.length) return fallbackDraw();

  // Retry until we have a full batch of NEW titles. A single spread draw can
  // come back nearly all-dupes when it lands on tiny categories whose few
  // files an earlier batch already showed — that must not end the feed.
  const exclude = new Set(state.lastDeepPicks);
  const fresh = [];
  for (let attempt = 0; attempt < 3 && fresh.length < 12; attempt++) {
    fresh.push(...pickNewTitles(await drawSpread(weighted, exclude)));
  }
  if (!fresh.length) return fallbackDraw(); // genuinely exhausted (or search degraded)
  state.lastDeepPicks = exclude;
  return fresh;
}

// One spread draw: k distinct weighted categories (excluding `exclude`, which
// is mutated so retries automatically avoid already-tried categories), a few
// random files each, interleaved. Returns raw search-result OBJECTS (pickNew
// dedupes by .title).
async function drawSpread(weighted, exclude) {
  let candidates = weighted.filter((n) => !exclude.has(normCat(n.title)));
  if (!candidates.length) candidates = weighted;
  // Weighted pick without replacement of k distinct categories.
  const picks = [];
  const cands = candidates.slice();
  let w = cands.reduce((s, n) => s + n.files, 0);
  const k = Math.min(DEEP_BATCH_SPREAD, cands.length);
  for (let i = 0; i < k && cands.length; i++) {
    let r = Math.random() * w;
    let idx = cands.length - 1;
    for (let j = 0; j < cands.length; j++) {
      r -= cands[j].files;
      if (r <= 0) { idx = j; break; }
    }
    picks.push(cands[idx]);
    w -= cands[idx].files;
    cands.splice(idx, 1);
  }
  for (const p of picks) exclude.add(normCat(p.title));
  const typeTerm = typeSearchTerm();
  const draws = await mapLimit(picks, 4, (p) =>
    api({
      action: "query",
      list: "search",
      srsearch: `incategory:"${p.title.replace(/^Category:/, "").replace(/_/g, " ")}"${typeTerm}`,
      srnamespace: "6",
      srlimit: String(DEEP_DRAW_LIMIT),
      srsort: "random",
    }).then((d) => (d.query && d.query.search) || []).catch(() => [])
  );
  // Interleave so categories mix within the batch. Result OBJECTS — pickNew
  // reads .title (passing pre-mapped strings here returned [undefined] and
  // ended the feed after one batch).
  return shuffle(draws.flat());
}

async function fetchBatch() {
  if (state.list) return listBatch();
  if (state.sortShuffle) {
    // Shuffle: random draw + one batched info call. Never cached (serendipity).
    const titles = state.deepMode ? await deepSampleTitles() : await flatSampleTitles();
    console.info("BATCH-DEBUG deep titles:", titles.length, "first:", (titles[0] || "NONE").slice(0, 50));
    let pages = [];
    if (titles.length) {
      const info = await api({
        action: "query",
        titles: titles.join("|"),
        prop: "imageinfo|videoinfo|categories",
        clprop: "hidden",
        cllimit: "max",
        iiprop: "url|extmetadata|derivatives|mediatype|mime",
        viprop: "url|derivatives",
        iiurlwidth: "600",
      });
      pages = (info.query && info.query.pages) || [];
      shuffle(pages);
    }
    return { pages, hasEnded: pages.length === 0 };
  }

  // Alpha: categorymembers generator, cacheable per (category, continue token).
  const params = {
    action: "query",
    generator: "categorymembers",
    gcmtitle: state.currentCategory,
    gcmtype: "file",
    gcmlimit: "12",
    prop: "imageinfo|videoinfo|categories",
    clprop: "hidden",
    cllimit: "max",
    iiprop: "url|extmetadata|derivatives|mediatype|mime",
    viprop: "url|derivatives",
    iiurlwidth: "600",
  };
  if (state.continueToken) Object.assign(params, state.continueToken);
  const data = await api(params, { ttl: 24 * 3600e3 });
  state.continueToken = data.continue || null;
  const pages = (data.query && data.query.pages) || [];
  return { pages, hasEnded: !state.continueToken };
}

/* One-batch prefetch lookahead: the next batch is fetched as soon as the
 * current one renders, so the sentinel almost always finds data waiting. */
let prefetchPromise = null;

async function getBatch() {
  if (prefetchPromise) {
    const p = prefetchPromise;
    prefetchPromise = null;
    return p;
  }
  return fetchBatch();
}

function prefetchNext() {
  if (prefetchPromise || state.hasReachedEnd) return;
  prefetchPromise = fetchBatch().catch((e) => {
    console.warn("prefetch failed:", e);
    return { pages: [], hasEnded: false };
  });
}

/* ---------------- rendering ---------------- */

function cleanUrl(u) {
  // The API now appends tracking params (?utm_source=...) to media URLs — strip them.
  return u ? u.split("?")[0] : "";
}

function pickBestVideo(fileUrl, derivatives) {
  if (!derivatives) return fileUrl;
  let best = null;
  for (const d of derivatives) {
    // type may carry codecs, e.g. 'video/webm; codecs="vp9, opus"'
    if ((d.type || "").split(";")[0].trim() !== "video/webm") continue;
    const src = cleanUrl(d.src || "");
    if (src.toLowerCase().includes(".vp9.webm")) {
      if (src.includes("360p") || src.includes("480p")) return src;
      if (!best) best = src;
    } else if (!best && (src.includes("360p") || src.includes("480p"))) {
      best = src;
    } else if (!best) {
      best = src;
    }
  }
  return best || fileUrl;
}

// Derive a 2x variant from the 600px thumb URL for retina screens — zero extra API calls.
function srcsetFor(thumbUrl) {
  const m = /\/\d+px-/.exec(thumbUrl);
  if (!m) return "";
  const w = parseInt(m[0].slice(1), 10);
  const retina = thumbUrl.replace(m[0], `/${w * 2}px-`);
  return `${thumbUrl} 1x, ${retina} 2x`;
}

/* ---------------- tile layout (size setting + reflow) ---------------- */

// Column counts per density setting, indexed by breakpoint tier
// (0: <640, 1: <1024, 2: <1280, 3: >=1280) — same tiers as the old
// hidden-column classes. "m" reproduces the pre-v1.8 layout exactly.
const SIZE_COLS = { s: [2, 3, 4, 6], m: [1, 2, 3, 4], l: [1, 2, 2, 3] };
const BREAKPOINTS = [640, 1024, 1280];

function breakpointTier() {
  let t = 0;
  for (const bp of BREAKPOINTS) if (window.innerWidth >= bp) t++;
  return t;
}

function currentCols() {
  return (SIZE_COLS[state.size] || SIZE_COLS.m)[breakpointTier()];
}

function ensureColumns(n) {
  const container = $("masonry-container");
  if (state.colCount === n && container.children.length === n) return;
  state.colCount = n;
  state.colHeights = new Array(n).fill(0);
  container.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const col = document.createElement("div");
    col.className = "masonry-col flex flex-col gap-6";
    container.appendChild(col);
  }
}

// Place a card in the shortest column using tracked heights. Cards carry their
// media aspect ratio (style="aspect-ratio"), so offsetHeight is stable even
// before lazy images load.
function placeCard(card) {
  let col = 0;
  for (let i = 1; i < state.colHeights.length; i++) {
    if (state.colHeights[i] < state.colHeights[col]) col = i;
  }
  const colEl = $("masonry-container").children[col];
  colEl.appendChild(card);
  state.colHeights[col] += card.offsetHeight || 0;
}

// Redistribute all placed cards for the current size/viewport. Moving DOM
// nodes keeps listeners and loaded images (no re-fetch).
function reflow() {
  ensureColumns(currentCols());
  state.colHeights = new Array(state.colCount).fill(0);
  const items = state.items;
  state.items = [];
  for (const card of items) {
    state.items.push(card);
    placeCard(card);
  }
}

let resizeTimer = null;
function handleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (currentCols() !== state.colCount) reflow();
  }, 150);
}

function setSize(s) {
  if (!SIZE_COLS[s] || state.size === s) return;
  state.size = s;
  syncSizeUI();
  updateURL();
  reflow();
}

function syncSizeUI() {
  for (const btn of document.querySelectorAll("#size-toggle [data-size]")) {
    const active = btn.getAttribute("data-size") === state.size;
    btn.classList.toggle("bg-blue-600", active);
    btn.classList.toggle("text-white", active);
    btn.classList.toggle("text-zinc-500", !active);
    btn.classList.toggle("hover:text-white", !active);
  }
}

function renderPages(pages) {
  ensureColumns(currentCols());
  for (const page of pages) {
    if (!("imageinfo" in page) && !("videoinfo" in page)) continue;
    // Type filter (client-side; shuffle/deep also filter server-side). Filtered
    // batches render nothing and the sentinel fill-up just fetches more.
    if (state.type !== "all" && pageKind(page) !== state.type) continue;
    const card = buildCard(page);
    if (!card) continue;
    state.items.push(card);
    placeCard(card);
  }
}

function buildCard(page) {
  // Consolidate metadata from imageinfo + videoinfo
  const info = {};
  if (page.imageinfo && page.imageinfo[0]) Object.assign(info, page.imageinfo[0]);
  if (page.videoinfo && page.videoinfo[0]) Object.assign(info, page.videoinfo[0]);

  const metadata = info.extmetadata || {};
  const cleanTitle = page.title.replace("File:", "");
  const fileUrl = cleanUrl(info.url || "");
  // Robust media-type detection: the API's mime/mediatype fields beat URL-suffix
  // heuristics, which the appended tracking params (?utm_...) would otherwise break.
  const mime = (info.mime || "").toLowerCase();
  const mediatype = (info.mediatype || "").toUpperCase();
  const isVideo =
    mediatype === "VIDEO" ||
    mime.startsWith("video/") ||
    /\.(webm|ogv|ogg)$/i.test(fileUrl);
  const isAudio =
    mediatype === "AUDIO" ||
    mime.startsWith("audio/") ||
    /\.(mp3|oga|ogg|wav|flac|opus)$/i.test(fileUrl);

  let mediaSrc = fileUrl;
  if ((isVideo || isAudio) && info.derivatives) {
    mediaSrc = pickBestVideo(fileUrl, info.derivatives);
  }

  const thumbUrl = cleanUrl(info.thumburl || "");
  const tw = info.thumbwidth || 16;
  const th = info.thumbheight || 9;

  let catHtml = "";
  if (page.categories) {
    for (const catObj of page.categories) {
      const catTitle = catObj.title;
      const displayName = catTitle.replace("Category:", "").replaceAll("_", " ");
      const isHidden = "hidden" in catObj;
      const pillClass = isHidden ? "border border-zinc-700 text-zinc-500" : "bg-blue-700 text-white";
      catHtml +=
        `<button class="cat-pill px-2 py-1 rounded-full text-[8px] font-bold whitespace-nowrap transition-colors hover:bg-blue-500 hover:text-white ${pillClass}" ` +
        `data-cat="${esc(catTitle)}">${esc(displayName)}</button>`;
    }
  }

  const descrData = metadata.ImageDescription || metadata.description || metadata.ObjectName;
  const description = descrData ? cleanHtml(descrData.value) : cleanTitle;

  let mediaHtml;
  if (isVideo) {
    mediaHtml = `
      <div class="relative w-full overflow-hidden bg-zinc-800 media-container" style="aspect-ratio: ${tw}/${th}">
        <div class="absolute inset-0 flex items-center justify-center opacity-20 media-placeholder"><svg class="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg></div>
        <img src="${esc(thumbUrl)}" srcset="${esc(srcsetFor(thumbUrl))}" class="w-full h-full object-cover transition-opacity duration-300 group-hover:opacity-0 thumb-img" loading="lazy" decoding="async" onerror="this.style.display='none'">
        <video src="${esc(mediaSrc)}" class="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100 media-element" muted loop playsinline preload="none"></video>
      </div>`;
  } else if (isAudio) {
    mediaHtml = `
      <div class="relative w-full overflow-hidden bg-zinc-800 media-container" style="aspect-ratio: 16/9">
        <div class="absolute inset-0 flex items-center justify-center bg-zinc-900 media-placeholder">
          <svg class="w-12 h-12 text-zinc-700" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        </div>
        <audio src="${esc(mediaSrc)}" loop preload="none" class="media-element" muted></audio>
      </div>`;
  } else {
    mediaHtml = `
      <div class="relative overflow-hidden bg-zinc-800 media-container" style="aspect-ratio: ${tw}/${th}">
        <img src="${esc(thumbUrl)}" srcset="${esc(srcsetFor(thumbUrl))}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" loading="lazy" decoding="async">
      </div>`;
  }

  const card = document.createElement("div");
  card.className =
    "group relative bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden hover:border-zinc-500 transition-all shadow-xl mb-6";
  card.innerHTML = `
    <div class="relative overflow-hidden media-wrapper">
      <a href="https://commons.wikimedia.org/wiki/${quotePath(page.title)}" target="_blank" class="block media-link">${mediaHtml}</a>
      ${isAudio
        ? `<button class="audio-play-indicator absolute top-3 right-3 z-50 opacity-0 group-hover:opacity-100 transition-opacity bg-blue-600 hover:bg-blue-500 rounded-full p-2 shadow-xl border border-blue-400 pointer-events-auto"><svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>`
        : ""}
      <div class="category-drawer absolute inset-x-0 bottom-0 z-40 p-4 translate-y-full max-h-[80%] overflow-y-auto">
        <div class="flex justify-between items-center mb-3 border-b border-zinc-800 pb-1">
          <p class="text-[9px] font-black text-blue-500 uppercase tracking-widest">Categories</p>
          <button class="close-drawer-btn p-1 text-zinc-500 hover:text-white transition-colors" title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div class="flex flex-wrap gap-2">${catHtml}</div>
      </div>
    </div>
    <div class="card-info-wrapper p-5 flex flex-col gap-y-2">
      <a href="https://commons.wikimedia.org/wiki/${quotePath(page.title)}" target="_blank" class="no-underline flex flex-col gap-y-2 pointer-events-auto">
        <h3 class="text-[9px] font-black text-blue-500 uppercase tracking-widest truncate" title="${esc(cleanTitle)}">${esc(cleanTitle)}</h3>
        <p class="text-[11px] text-zinc-400 leading-relaxed font-medium line-clamp-3">${esc(description)}</p>
      </a>
      <div class="card-footer pt-3 border-t border-zinc-800/50 flex justify-between items-center pointer-events-auto">
        <a href="https://commons.wikimedia.org/wiki/${quotePath(page.title)}" target="_blank" class="view-source-btn inline-block text-[9px] font-bold text-white bg-zinc-800 hover:bg-purple-600 px-3 py-2 rounded-lg transition-colors uppercase tracking-widest">View Source ↗</a>
        <button class="tag-btn p-2 bg-zinc-800 hover:bg-blue-600 rounded-lg text-zinc-400 hover:text-white transition-all shadow-lg" title="View Categories">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
        </button>
      </div>
    </div>`;

  // Hover-to-play video (loads lazily; paused/reset on leave)
  const mediaEl = card.querySelector(".media-element");
  if (mediaEl) {
    card.addEventListener("mouseenter", () => {
      try {
        mediaEl.muted = true;
        if (mediaEl.readyState < 1) mediaEl.load();
        mediaEl.play().catch(() => {});
      } catch { /* ignore */ }
    });
    card.addEventListener("mouseleave", () => {
      try {
        mediaEl.pause();
        mediaEl.currentTime = 0;
      } catch { /* ignore */ }
    });
    if (isAudio) {
      const audioBtn = card.querySelector(".audio-play-indicator");
      audioBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (mediaEl.paused) {
          mediaEl.muted = false;
          mediaEl.play().catch(() => {});
          audioBtn.classList.add("bg-green-600");
        } else {
          mediaEl.pause();
          audioBtn.classList.remove("bg-green-600");
        }
      });
    }
  }

  // Category drawer + tag jump
  const tagBtn = card.querySelector(".tag-btn");
  const drawer = card.querySelector(".category-drawer");
  const closeBtn = card.querySelector(".close-drawer-btn");
  const toggleDrawer = (e) => {
    e.preventDefault();
    e.stopPropagation();
    drawer.classList.toggle("drawer-open");
    tagBtn.classList.toggle("active");
  };
  tagBtn.addEventListener("click", toggleDrawer);
  closeBtn.addEventListener("click", toggleDrawer);
  for (const pill of card.querySelectorAll(".cat-pill")) {
    pill.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateTo(pill.getAttribute("data-cat"));
    });
  }
  return card;
}

/* ---------------- tree UI (treebar + tree modal) ---------------- */

const TREE_MAX_NODES = 300;
let treeReqId = 0; // bumped by resetAndFetch so stale tree renders bail out

function treeChipHTML(catTitle, { hidden = false, count = null } = {}) {
  const cls = hidden
    ? "border border-zinc-700 text-zinc-500 hover:text-zinc-300"
    : "bg-zinc-800 text-zinc-300 hover:bg-blue-600 hover:text-white";
  const badge = count === null ? "" : ` <span class="text-zinc-500">${count.toLocaleString("en-US")}</span>`;
  return `<button class="cat-pill px-2 py-1 rounded-full text-[9px] font-bold whitespace-nowrap transition-colors ${cls}" data-cat="${esc(catTitle)}" title="${esc(catTitle)}">${esc(catDisplayName(catTitle))}${badge}</button>`;
}

// Breadcrumb trail chips: clickable crumbs truncate the path (navigateTo rule);
// the current category renders as non-interactive text.
function renderCrumbs() {
  const el = $("crumbs");
  el.innerHTML = "";
  if (state.path.length < 2) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  state.path.forEach((cat, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "text-zinc-600 font-bold";
      sep.textContent = "›";
      el.appendChild(sep);
    }
    if (i === state.path.length - 1) {
      const cur = document.createElement("span");
      cur.className = "text-[10px] font-black text-white uppercase tracking-widest truncate max-w-[280px]";
      cur.textContent = catDisplayName(cat);
      cur.title = cat;
      el.appendChild(cur);
    } else {
      const b = document.createElement("button");
      b.className = "cat-pill px-2 py-1 rounded-full text-[9px] font-bold bg-zinc-800 text-zinc-300 hover:bg-blue-600 hover:text-white transition-colors max-w-[220px] truncate";
      b.setAttribute("data-cat", cat);
      b.textContent = catDisplayName(cat);
      b.title = cat;
      el.appendChild(b);
    }
  });
}

async function fetchTreebar() {
  const bar = $("treebar");
  const pEl = $("treebar-parents");
  const sEl = $("treebar-subs");
  pEl.innerHTML = "";
  sEl.innerHTML = "";
  const cat = state.currentCategory;
  if (!cat || state.list) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");

  // Parents (breadcrumb up) — independent of subcat fetch.
  fetchParents(cat).then((parents) => {
    if (cat !== state.currentCategory) return;
    if (!parents.length) return;
    const label = document.createElement("span");
    label.className = "text-[9px] font-black uppercase tracking-widest text-zinc-600";
    label.textContent = "↑";
    pEl.appendChild(label);
    for (const p of parents) {
      pEl.insertAdjacentHTML("beforeend", treeChipHTML(p.title, { hidden: "hidden" in p }));
    }
  }).catch((e) => console.warn("treebar parents failed:", e));

  // Subcategory chips (first 14 + "more" opens the tree modal).
  buildTreeLevel(cat).then((rows) => {
    if (cat !== state.currentCategory) return;
    if (!rows.length) return;
    const label = document.createElement("span");
    label.className = "text-[9px] font-black uppercase tracking-widest text-zinc-600";
    label.textContent = "↳";
    sEl.appendChild(label);
    for (const row of rows.slice(0, 14)) {
      sEl.insertAdjacentHTML("beforeend", treeChipHTML(row.title, { count: row.files }));
    }
    if (rows.length > 14) {
      const more = document.createElement("button");
      more.className = "px-2 py-1 rounded-full text-[9px] font-bold bg-blue-700 text-white hover:bg-blue-500 transition-colors";
      more.textContent = `+${rows.length - 14} more`;
      more.addEventListener("click", openTreeModal);
      sEl.appendChild(more);
    }
    // Category roulette — random subcategory, weighted by file count.
    if (rows.length) {
      const dice = document.createElement("button");
      dice.className = "cat-pill px-2 py-1 rounded-full text-[9px] font-bold bg-purple-700 text-white hover:bg-purple-500 transition-colors";
      dice.textContent = "🎲 Roulette";
      dice.title = "Jump to a random subcategory (weighted by file count)";
      dice.addEventListener("click", categoryRoulette);
      sEl.appendChild(dice);
    }
  }).catch((e) => console.warn("treebar subcats failed:", e));
}

// The one chokepoint for category navigation (tile pills, treebar chips, tree
// modal, dropdown, search). Maintains the breadcrumb trail: descend, or
// truncate back when the target is already on the path. Choosing a category
// explicitly also exits list mode.
// The one chokepoint for category navigation. Maintains the breadcrumb trail:
// descend (truncate-or-append), or start a fresh session when fresh=true —
// used by the search box and dropdown, where the user picks a new subject
// rather than descending into what they're looking at.
function navigateTo(catTitle, { fresh = false } = {}) {
  if (normCat(catTitle) === normCat(state.currentCategory) && !state.list) return;
  state.list = null;
  if (fresh) {
    state.path = [catTitle];
  } else {
    const idx = state.path.findIndex((c) => normCat(c) === normCat(catTitle));
    if (idx >= 0) {
      state.path = state.path.slice(0, idx + 1);
    } else {
      if (!state.path.length) state.path = [state.currentCategory];
      state.path.push(catTitle);
      if (state.path.length > 12) state.path.shift(); // URL-length guard
    }
  }
  state.currentCategory = catTitle;
  addCategoryToConfig(catTitle);
  state.treeOpen = false;
  $("tree-modal").classList.add("hidden");
  rebuildDropdown();
  writeURL("push");
  resetAndFetch();
}

// --- tree modal ---

function closeTreeModal() {
  state.treeOpen = false;
  $("tree-modal").classList.add("hidden");
  updateURL();
}

async function openTreeModal() {
  state.treeOpen = true;
  $("tree-depth").value = String(state.treeDepth);
  $("tree-modal").classList.remove("hidden");
  updateURL();
  loadTree();
}

function handleDepthChange() {
  state.treeDepth = parseInt($("tree-depth").value, 10) || 2;
  loadTree();
  updateURL();
}

async function loadTree() {
  const reqId = ++treeReqId;
  const depth = parseInt($("tree-depth").value, 10) || 2;
  const rootCat = state.currentCategory;
  const content = $("tree-content");
  content.innerHTML = "";
  $("tree-status").textContent = "Loading…";
  if (!rootCat) { $("tree-status").textContent = ""; return; }

  const ctx = { reqId, nodes: 0, truncated: false };

  // Root header row (clickable to navigate; counts from categoryinfo).
  const rootEl = document.createElement("div");
  rootEl.className = "mb-2 pb-2 border-b border-zinc-800";
  try {
    const info = await getCatInfo([rootCat]);
    if (reqId !== treeReqId) return;
    const c = info.get(normCat(rootCat)) || { files: 0, subcats: 0 };
    rootEl.innerHTML =
      `<button class="tree-name font-bold text-white text-xs uppercase tracking-widest hover:text-blue-400 transition-colors" data-cat="${esc(rootCat)}">${esc(catDisplayName(rootCat))}</button>` +
      `<span class="text-[10px] font-mono text-blue-500 font-black ml-2">${c.files.toLocaleString("en-US")} files · ${c.subcats} subcategories</span>`;
  } catch {
    rootEl.innerHTML =
      `<button class="tree-name font-bold text-white text-xs uppercase tracking-widest hover:text-blue-400 transition-colors" data-cat="${esc(rootCat)}">${esc(catDisplayName(rootCat))}</button>`;
  }
  content.appendChild(rootEl);

  const kidsEl = document.createElement("div");
  kidsEl.className = "flex flex-col";
  content.appendChild(kidsEl);
  await renderTreeChildren(kidsEl, rootCat, depth, ctx, 1);
  if (reqId !== treeReqId) return;
  updateTreeStatus(ctx);
}

function updateTreeStatus(ctx) {
  $("tree-status").textContent = ctx.truncated
    ? `${ctx.nodes}+ categories (truncated)`
    : `${ctx.nodes} subcategories`;
}

// Render `levels` levels of children of catTitle into container, auto-expanding
// to the requested depth. `depth` is the tree depth of the children (root's = 1).
async function renderTreeChildren(container, catTitle, levels, ctx, depth) {
  if (levels <= 0) return;
  if (ctx.nodes >= TREE_MAX_NODES) { ctx.truncated = true; return; }
  let rows;
  try {
    rows = await buildTreeLevel(catTitle);
  } catch (e) {
    console.warn("tree level failed:", e);
    return;
  }
  if (ctx.reqId !== treeReqId) return;
  for (const row of rows) {
    if (ctx.nodes >= TREE_MAX_NODES) { ctx.truncated = true; break; }
    ctx.nodes++;
    const { node, kidsEl, toggleBtn, expand } = treeRowEl(row, depth, ctx, levels - 1);
    container.appendChild(node);
    if (levels - 1 > 0 && row.subcats > 0) {
      await expand(levels - 1); // auto-expand to the requested depth
      if (ctx.reqId !== treeReqId) return;
    }
  }
}

function treeRowEl(row, depth, ctx, autoLevels = 0) {
  const node = document.createElement("div");
  node.className = "tree-node";

  const rowEl = document.createElement("div");
  rowEl.className = "tree-row flex items-center gap-1.5 py-1 pr-2 rounded";
  rowEl.style.marginLeft = (depth * 14) + "px";
  rowEl.style.width = `calc(100% - ${depth * 14}px)`;

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "w-4 h-4 flex items-center justify-center text-zinc-500 hover:text-white text-[10px] shrink-0";
  const hasKids = row.subcats > 0;
  toggleBtn.textContent = hasKids ? "▸" : "·";
  if (!hasKids) toggleBtn.classList.add("opacity-30", "pointer-events-none");
  rowEl.appendChild(toggleBtn);

  const nameBtn = document.createElement("button");
  nameBtn.className = "tree-name text-[11px] text-zinc-300 hover:text-blue-400 transition-colors text-left truncate";
  nameBtn.textContent = catDisplayName(row.title);
  nameBtn.title = row.title;
  nameBtn.setAttribute("data-cat", row.title);
  rowEl.appendChild(nameBtn);

  const counts = document.createElement("span");
  counts.className = "text-[9px] font-mono text-zinc-600 ml-auto shrink-0";
  counts.textContent = `${row.files.toLocaleString("en-US")}f · ${row.subcats}s`;
  rowEl.appendChild(counts);

  node.appendChild(rowEl);

  const kidsEl = document.createElement("div");
  kidsEl.className = "tree-children flex flex-col hidden";
  node.appendChild(kidsEl);

  let loaded = false;
  const expand = async (levels = 1) => {
    if (!loaded) {
      loaded = true;
      toggleBtn.textContent = "▾";
      kidsEl.classList.remove("hidden");
      await renderTreeChildren(kidsEl, row.title, levels, ctx, depth + 1);
      if (ctx.reqId !== treeReqId) return;
      updateTreeStatus(ctx);
    } else {
      const hidden = kidsEl.classList.toggle("hidden");
      toggleBtn.textContent = hidden ? "▸" : "▾";
    }
  };
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    expand();
  });
  return { node, kidsEl, toggleBtn, expand };
}

function handleTreeDeep() {
  state.deepMode = true;
  state.sortShuffle = true;
  syncSortUI();
  syncDeepUI();
  closeTreeModal();
  resetAndFetch();
}

// One place that reflects deep mode in the UI: the Deep chip in the sort pill
// and the explainer banner above the grid.
function syncDeepUI() {
  $("deep-chip").classList.toggle("hidden", !state.deepMode);
  const banner = $("deep-banner");
  if (state.deepMode) {
    $("deep-banner-cat").textContent = catDisplayName(state.currentCategory);
    banner.classList.remove("hidden");
  } else {
    banner.classList.add("hidden");
  }
}

function handleDeepOff() {
  state.deepMode = false;
  syncDeepUI();
  resetAndFetch();
}

/* ---------------- load orchestration ---------------- */

// Sentinel fill-up: after a successful batch, if the sentinel is still within the
// viewport + rootMargin (short pages, minimal view, tall windows), keep loading
// until the page actually overflows — otherwise infinite scroll stalls forever.
let lastBatchOk = false;

async function fetchImages() {
  // List mode has no current category; everything else requires one.
  if (state.isLoading || state.hasReachedEnd) return;
  if (!state.currentCategory && !state.list) return;
  state.isLoading = true;
  const reqId = state.requestId;
  try {
    const batch = await getBatch();
    if (reqId !== state.requestId) return; // stale — a newer request owns the grid
    lastBatchOk = true;
    if (batch.pages.length) {
      renderPages(batch.pages);
      if (!batch.hasEnded) prefetchNext();
    }
    if (batch.hasEnded) {
      state.hasReachedEnd = true;
      $("loading-spinner").classList.add("hidden");
      $("end-message").classList.remove("hidden");
    }
  } catch (e) {
    console.error("fetchImages error:", e);
    lastBatchOk = false;
    if (reqId === state.requestId) $("load-error").classList.remove("hidden");
  } finally {
    state.isLoading = false;
  }
  if (lastBatchOk && !state.hasReachedEnd) {
    const r = $("sentinel").getBoundingClientRect();
    if (r.top <= window.innerHeight + 800) fetchImages();
  }
}

function resetAndFetch() {
  state.requestId++;
  treeReqId++;               // any open tree render belongs to the old category
  state.deepWalk = null;     // deep sampler walks the new category's tree
  state.lastDeepPicks = new Set();
  state.abort.abort();
  state.abort = new AbortController();
  prefetchPromise = null; // drop any in-flight prefetch for the old category
  lastBatchOk = false;
  state.isLoading = false;
  state.hasReachedEnd = false;
  state.continueToken = null;
  state.seenTitles = new Set();
  $("end-message").classList.add("hidden");
  $("load-error").classList.add("hidden");
  $("loading-spinner").classList.remove("hidden");
  state.items = [];
  $("masonry-container").innerHTML = "";
  ensureColumns(currentCols());
  if (state.list) state.list.cursor = 0;
  $("sort-pill").classList.toggle("hidden", !!state.list); // Alpha/Shuffle N/A for lists
  updateURL();
  fetchCategoryInfo();
  fetchTreebar();
  renderCrumbs();
  fetchImages();
}

/* ---------------- event handlers ---------------- */

async function handleSearch(e) {
  if (e.key !== "Enter") return;
  const input = e.target;
  let val = input.value.trim();
  if (!val) return;
  if (!val.toLowerCase().startsWith("category:")) {
    val = "Category:" + val;
  } else {
    val = "Category:" + val.slice(9);
  }
  // Capitalize the first letter after the prefix (Commons categories are case-sensitive)
  if (val.length > 9) val = val.slice(0, 9) + val[9].toUpperCase() + val.slice(10);
  try {
    const data = await api({ action: "query", titles: val }, { ttl: 7 * 24 * 3600e3 });
    const page = (data.query.pages || [])[0];
    if (page && !page.missing) {
      input.value = "";
      navigateTo(page.title, { fresh: true });
    } else {
      window.alert(`Category not found: ${val}`);
    }
  } catch (err) {
    console.error("search failed:", err);
    window.alert(`Could not validate category: ${val}`);
  }
}

async function handleRefresh() {
  $("refresh-icon").classList.add("animate-refresh");
  resetAndFetch();
  setTimeout(() => $("refresh-icon").classList.remove("animate-refresh"), 500);
}

function handleEditList() {
  $("modal-error").classList.add("hidden");
  $("modal-textarea").value = state.config.trim();
  $("edit-modal").classList.remove("hidden");
}

function handleModalCancel() {
  $("edit-modal").classList.add("hidden");
}

async function handleModalSave() {
  const saveBtn = $("modal-save");
  saveBtn.disabled = true;
  $("save-btn-text").classList.add("hidden");
  $("save-btn-loading").classList.remove("hidden");
  $("modal-error").classList.add("hidden");

  const newConfig = $("modal-textarea").value.trim();
  const lines = newConfig
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const catsToCheck = lines.map((line) => {
    const cat = line.includes("|") ? line.split("|")[0].trim() : line.trim();
    return cat.toLowerCase().startsWith("category:") ? cat : "Category:" + cat;
  });

  try {
    // Validate in chunks of 50 (API limit for titles)
    const chunks = [];
    for (let i = 0; i < catsToCheck.length; i += 50) chunks.push(catsToCheck.slice(i, i + 50));
    const results = await Promise.all(
      chunks.map((chunk) => api({ action: "query", titles: chunk.join("|") }, { ttl: 7 * 24 * 3600e3 })),
    );

    const titleMap = new Map(); // normCat -> official title (or null if missing)
    for (const data of results) {
      for (const page of data.query.pages || []) {
        titleMap.set(normCat(page.title), page.missing ? null : page.title);
      }
    }

    const normalizedLines = [];
    const invalidCats = [];
    for (let i = 0; i < lines.length; i++) {
      const userCat = catsToCheck[i];
      const official = titleMap.get(normCat(userCat));
      if (official) {
        const label = lines[i].includes("|") ? lines[i].split("|")[1].trim() : null;
        normalizedLines.push(label ? `${official} | ${label}` : official);
      } else {
        invalidCats.push(userCat);
      }
    }

    if (invalidCats.length) {
      $("modal-error").classList.remove("hidden");
      $("error-list").textContent = "Invalid categories: " + invalidCats.join(", ");
    } else {
      state.config = normalizedLines.join("\n");
      saveConfig();
      $("edit-modal").classList.add("hidden");
      rebuildDropdown();
      resetAndFetch();
    }
  } catch (e) {
    console.error("validation error:", e);
    $("modal-error").classList.remove("hidden");
    $("error-list").textContent = "Could not validate categories: " + e.message;
  }
  saveBtn.disabled = false;
  $("save-btn-text").classList.remove("hidden");
  $("save-btn-loading").classList.add("hidden");
}

function handleSelectChange(e) {
  // Dropdown picks start a fresh session — no breadcrumb linkage to the
  // category you happened to be on.
  navigateTo(e.target.value, { fresh: true });
}

function handleSortToggle() {
  state.sortShuffle = !state.sortShuffle;
  syncSortUI();
  // Deep mode requires the shuffle engine (CirrusSearch deepcategory).
  if (!state.sortShuffle && state.deepMode) {
    state.deepMode = false;
    syncDeepUI();
  }
  resetAndFetch();
}

function syncSortUI() {
  $("sort-knob").style.transform = state.sortShuffle ? "translateX(20px)" : "translateX(0px)";
  if (state.sortShuffle) {
    $("sort-toggle").classList.replace("bg-zinc-700", "bg-purple-600");
  } else {
    $("sort-toggle").classList.replace("bg-purple-600", "bg-zinc-700");
  }
}

function handleViewToggle() {
  state.minimalView = !state.minimalView;
  $("masonry-container").classList.toggle("minimal-mode", state.minimalView);
  $("view-knob").style.transform = state.minimalView ? "translateX(-20px)" : "translateX(0px)";
  if (state.minimalView) {
    $("view-toggle").classList.replace("bg-blue-600", "bg-zinc-800");
  } else {
    $("view-toggle").classList.replace("bg-zinc-800", "bg-blue-600");
  }
  updateURL();
}

/* ---------------- boot ---------------- */

async function init() {
  console.info(`${UA_NOTE} — JS engine active`);
  await loadConfig();

  const params = new URLSearchParams(location.search);
  const urlCat = params.get("cat");
  if (urlCat) {
    state.currentCategory = urlCat;
    addCategoryToConfig(urlCat);
  }
  if (params.get("sort") === "shuffle") {
    state.sortShuffle = true;
    $("sort-knob").style.transform = "translateX(20px)";
    $("sort-toggle").classList.replace("bg-zinc-700", "bg-purple-600");
  }
  if (params.get("view") === "min") {
    state.minimalView = true;
    $("masonry-container").classList.add("minimal-mode");
    $("view-knob").style.transform = "translateX(-20px)";
    $("view-toggle").classList.replace("bg-blue-600", "bg-zinc-800");
  }
  if (params.get("deep") === "1") {
    // Deep needs the shuffle engine; force it on.
    state.deepMode = true;
    state.sortShuffle = true;
    $("sort-knob").style.transform = "translateX(20px)";
    $("sort-toggle").classList.replace("bg-zinc-700", "bg-purple-600");
    syncDeepUI();
  }
  const urlDepth = parseInt(params.get("depth"), 10);
  if (urlDepth >= 1 && urlDepth <= 5) state.treeDepth = urlDepth;
  $("tree-depth").value = String(state.treeDepth);
  const urlSize = params.get("size");
  if (SIZE_COLS[urlSize]) state.size = urlSize;
  syncSizeUI();
  const urlType = params.get("type");
  if (urlType && (urlType === "all" || TYPE_TERM[urlType])) state.type = urlType;
  $("type-select").value = state.type;
  const urlPile = params.get("pile");
  const urlPsid = params.get("psid");
  const urlPet = params.get("pet");
  if (urlPile || urlPsid || urlPet) {
    if (urlPet) {
      state.list = { source: "pet", id: urlPet, depth: Math.min(parseInt(params.get("petdepth"), 10) || 1, 5), cursor: 0, titles: [] };
    } else if (urlPsid) {
      state.list = { source: "psid", id: urlPsid, cursor: 0, titles: [] };
    } else {
      state.list = { source: "pile", id: urlPile, cursor: 0, titles: [] };
    }
  }
  const urlPath = params.get("path");
  if (urlPath) {
    state.path = decodePath(urlPath);
    // The trail's last segment wins as the current category.
    if (state.path.length) state.currentCategory = state.path[state.path.length - 1];
  }

  rebuildDropdown();
  $("search-input").addEventListener("keydown", handleSearch);
  $("refresh-btn").addEventListener("click", handleRefresh);
  $("edit-list-btn").addEventListener("click", handleEditList);
  $("modal-cancel").addEventListener("click", handleModalCancel);
  $("modal-save").addEventListener("click", handleModalSave);
  $("vibe-select").addEventListener("change", handleSelectChange);
  $("sort-toggle").addEventListener("click", handleSortToggle);
  $("view-toggle").addEventListener("click", handleViewToggle);
  $("tree-btn").addEventListener("click", openTreeModal);
  $("tree-close").addEventListener("click", closeTreeModal);
  $("tree-depth").addEventListener("change", handleDepthChange);
  $("tree-deep-btn").addEventListener("click", handleTreeDeep);
  $("about-btn").addEventListener("click", () => {
    $("about-modal").classList.remove("hidden");
  });
  $("about-close").addEventListener("click", () => $("about-modal").classList.add("hidden"));
  $("about-modal").addEventListener("click", (e) => {
    if (e.target === $("about-modal")) $("about-modal").classList.add("hidden");
  });
  $("deep-chip").addEventListener("click", handleDeepOff);
  $("deep-banner-off").addEventListener("click", handleDeepOff);
  $("type-select").addEventListener("change", (e) => setType(e.target.value));
  for (const btn of document.querySelectorAll("#size-toggle [data-size]")) {
    btn.addEventListener("click", () => setSize(btn.getAttribute("data-size")));
  }
  window.addEventListener("resize", handleResize);
  // Chip navigation (treebar chips + tree rows + crumbs) via delegation.
  document.body.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-cat]");
    if (!chip) return;
    const inTreeModal = chip.closest("#tree-content, #treebar, #crumbs");
    if (!inTreeModal) return;
    e.preventDefault();
    navigateTo(chip.getAttribute("data-cat"));
  });

  // Browser Back/Forward walks the breadcrumb trail: re-sync all state from
  // the URL and refetch (no push — history already moved).
  window.addEventListener("popstate", async () => {
    const p2 = new URLSearchParams(location.search);
    const cat = p2.get("cat");
    const pileId = p2.get("pile");
    const psid = p2.get("psid");
    const pet = p2.get("pet");
    if (!cat && !pileId && !psid && !pet) return;
    if (pileId || psid || pet) {
      if (pet) {
        state.list = { source: "pet", id: pet, depth: Math.min(parseInt(p2.get("petdepth"), 10) || 1, 5), cursor: 0, titles: [] };
      } else if (psid) {
        state.list = { source: "psid", id: psid, cursor: 0, titles: [] };
      } else {
        state.list = { source: "pile", id: pileId, cursor: 0, titles: [] };
      }
      try {
        await loadList();
      } catch {
        state.list = null;
      }
    } else {
      state.list = null;
    }
    if (cat && !state.list) {
      state.path = p2.get("path") ? decodePath(p2.get("path")) : [];
      if (!state.path.some((c) => normCat(c) === normCat(cat))) state.path = [];
      state.currentCategory = cat;
      addCategoryToConfig(cat);
    }
    if (state.list) {
      state.path = [];
      state.currentCategory = state.currentCategory || "";
    }
    state.sortShuffle = p2.get("sort") === "shuffle";
    state.deepMode = p2.get("deep") === "1";
    if (state.deepMode) state.sortShuffle = true;
    syncSortUI();
    syncDeepUI();
    state.minimalView = p2.get("view") === "min";
    $("masonry-container").classList.toggle("minimal-mode", state.minimalView);
    if (state.minimalView) {
      $("view-knob").style.transform = "translateX(-20px)";
      $("view-toggle").classList.replace("bg-blue-600", "bg-zinc-800");
    } else {
      $("view-knob").style.transform = "translateX(0px)";
      $("view-toggle").classList.replace("bg-zinc-800", "bg-blue-600");
    }
    const s2 = p2.get("size");
    if (SIZE_COLS[s2]) state.size = s2;
    syncSizeUI();
    const t2 = p2.get("type");
    if (t2 === "all" || TYPE_TERM[t2]) {
      state.type = t2;
      $("type-select").value = t2;
    }
    const d2 = parseInt(p2.get("depth"), 10);
    if (d2 >= 1 && d2 <= 5) {
      state.treeDepth = d2;
      $("tree-depth").value = String(d2);
    }
    state.treeOpen = false;
    $("tree-modal").classList.add("hidden");
    rebuildDropdown();
    resetAndFetch();
  });

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((en) => en.isIntersecting)) fetchImages();
    },
    { rootMargin: "800px 0px" },
  );
  observer.observe($("sentinel"));

  if (state.list) {
    try {
      await loadList();
    } catch (e) {
      console.error("list load failed:", e);
      window.alert(`Couldn't load the ${state.list.source === "pile" ? "PagePile" : "PetScan"} list: ${e.message}`);
      state.list = null;
    }
  }

  resetAndFetch();

  // Shared links can boot with the tree modal open at a given depth (?tree=1&depth=N).
  // After resetAndFetch so the tree render isn't killed by the requestId bump.
  if (params.get("tree") === "1") openTreeModal();
}

init();
