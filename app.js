/* CommonsVibe — vanilla JS engine (v1.5)
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
const UA_NOTE = "CommonsVibeExplorer/1.5 (https://commons-vibe.toolforge.org/; contact: User:Fuzheado)";

const state = {
  config: "",                    // categories.txt content + session additions
  currentCategory: "",
  sortShuffle: false,
  minimalView: false,
  continueToken: null,           // alpha-mode paging token
  isLoading: false,
  hasReachedEnd: false,
  colIdx: 0,
  seenTitles: new Set(),         // shuffle-mode dedupe within a session
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
 */
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

function updateURL() {
  const params = new URLSearchParams({
    cat: state.currentCategory,
    sort: state.sortShuffle ? "shuffle" : "alpha",
    view: state.minimalView ? "min" : "det",
  });
  history.replaceState(null, "", "?" + params.toString());
}

function rebuildDropdown() {
  const select = $("vibe-select");
  select.innerHTML = "";
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

/* ---------------- batch fetching (alpha + shuffle) ---------------- */

async function fetchBatch() {
  if (state.sortShuffle) {
    // Shuffle: CirrusSearch random + one batched info call. Never cached (serendipity).
    const catName = state.currentCategory.replace(/^Category:/, "").replace(/_/g, " ");
    const search = await api({
      action: "query",
      list: "search",
      srsearch: `incategory:"${catName}"`,
      srnamespace: "6",
      srlimit: "24",
      srsort: "random",
    });
    const results = (search.query && search.query.search) || [];
    const titles = [];
    for (const r of results) {
      if (!state.seenTitles.has(r.title)) {
        state.seenTitles.add(r.title);
        titles.push(r.title);
      }
      if (titles.length >= 12) break;
    }
    let pages = [];
    if (titles.length) {
      const info = await api({
        action: "query",
        titles: titles.join("|"),
        prop: "imageinfo|videoinfo|categories",
        clprop: "hidden",
        cllimit: "max",
        iiprop: "url|extmetadata|derivatives",
        viprop: "url|derivatives",
        iiurlwidth: "600",
      });
      pages = info.query.pages || [];
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
    iiprop: "url|extmetadata|derivatives",
    viprop: "url|derivatives",
    iiurlwidth: "600",
  };
  if (state.continueToken) Object.assign(params, state.continueToken);
  const data = await api(params, { ttl: 24 * 3600e3 });
  state.continueToken = data.continue || null;
  const pages = data.query.pages || [];
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

function renderPages(pages) {
  const cols = [1, 2, 3, 4][
    (window.innerWidth >= 640) + (window.innerWidth >= 1024) + (window.innerWidth >= 1280)
  ];
  for (const page of pages) {
    if (!("imageinfo" in page) && !("videoinfo" in page)) continue;
    const card = buildCard(page);
    if (!card) continue;
    $("col-" + (state.colIdx % cols)).appendChild(card);
    state.colIdx++;
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
      const targetCat = pill.getAttribute("data-cat");
      state.currentCategory = targetCat;
      addCategoryToConfig(targetCat);
      rebuildDropdown();
      resetAndFetch();
    });
  }
  return card;
}

/* ---------------- load orchestration ---------------- */

// Sentinel fill-up: after a successful batch, if the sentinel is still within the
// viewport + rootMargin (short pages, minimal view, tall windows), keep loading
// until the page actually overflows — otherwise infinite scroll stalls forever.
let lastBatchOk = false;

async function fetchImages() {
  if (state.isLoading || state.hasReachedEnd || !state.currentCategory) return;
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
  state.abort.abort();
  state.abort = new AbortController();
  prefetchPromise = null; // drop any in-flight prefetch for the old category
  lastBatchOk = false;
  state.isLoading = false;
  state.colIdx = 0;
  state.hasReachedEnd = false;
  state.continueToken = null;
  state.seenTitles = new Set();
  $("end-message").classList.add("hidden");
  $("load-error").classList.add("hidden");
  $("loading-spinner").classList.remove("hidden");
  for (let i = 0; i < 4; i++) $("col-" + i).innerHTML = "";
  updateURL();
  fetchCategoryInfo();
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
      const official = page.title;
      addCategoryToConfig(official);
      state.currentCategory = official;
      input.value = "";
      rebuildDropdown();
      resetAndFetch();
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
  state.currentCategory = e.target.value;
  resetAndFetch();
}

function handleSortToggle() {
  state.sortShuffle = !state.sortShuffle;
  $("sort-knob").style.transform = state.sortShuffle ? "translateX(20px)" : "translateX(0px)";
  if (state.sortShuffle) {
    $("sort-toggle").classList.replace("bg-zinc-700", "bg-purple-600");
  } else {
    $("sort-toggle").classList.replace("bg-purple-600", "bg-zinc-700");
  }
  resetAndFetch();
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

  rebuildDropdown();
  $("search-input").addEventListener("keydown", handleSearch);
  $("refresh-btn").addEventListener("click", handleRefresh);
  $("edit-list-btn").addEventListener("click", handleEditList);
  $("modal-cancel").addEventListener("click", handleModalCancel);
  $("modal-save").addEventListener("click", handleModalSave);
  $("vibe-select").addEventListener("change", handleSelectChange);
  $("sort-toggle").addEventListener("click", handleSortToggle);
  $("view-toggle").addEventListener("click", handleViewToggle);

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((en) => en.isIntersecting)) fetchImages();
    },
    { rootMargin: "800px 0px" },
  );
  observer.observe($("sentinel"));

  resetAndFetch();
}

init();
