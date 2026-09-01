# CommonsVibe: A Visual Category Explorer for Wikimedia Commons

Wikimedia Commons is one of the best free image collections in the world, but it was built as a "file warehouse," rather than as a compelling user experience. 

**CommonsVibe** aims to provide an easy-to-use, modern, visually rich, and serendipitous feed explorer and discovery tool for Wikimedia Commons categories.

Designed for the curious browser rather than a technical expert, it brings a "Pinterest-style" feel to Commons categories, making it easy to explore collections visually and quickly navigate the Commons category tree.

## Quick start 
* **Visually examine a specific category** by selecting a category from the pull-down menu, and "Minimal" mode to isolate just the images.
* **Use shuffle mode on a large category** with the "Detailed" setting to quickly explore the variety of a category.
* **Dial the tile density** with the S/M/L control — from a 6-column wall of thumbnails down to big single-column previews — and the grid reflows instantly.
* **Jump to different categories** by selecting the image's "tag" button to bring up Commons categories you can click on, visible or hidden.
* **Browse the category tree** via the tree button (👥): see subcategories to a chosen depth (1–5) with file counts, click any node to explore it. The chips row above the grid shows the current category's parents and subcategories.
* **Shuffle an entire subtree** with Deep mode: the feed samples from the category *and all its subcategories*. The sampler walks the tree client-side (cached), picks a subcategory weighted by file count, and draws exact random files from it — full-depth coverage without CirrusSearch's truncating `deepcategory` envelope.
* **Shareable tree views:** `&tree=1&depth=N` boots with the tree modal open at your chosen depth.
* **Quickly scrub and play video** by visiting a category of WebM videos and hovering your pointer over a tile to preview it without sound. (On mobile, tapping a tile opens the file page on Commons.)

## **A running version can be found at: https://commons-vibe.toolforge.org/**

![Screenshot](https://github.com/fuzheado/commons-vibe/blob/main/commons-vibe-screenshot-featured.png "Screenshot")

---

## The Experience

### Serendipitous Feed
CommonsVibe uses a **responsive masonry grid** to showcase images in a fluid, visual layout. 
* **Infinite Discovery:** As you scroll, the app automatically fetches more content, creating a seamless "infinite scroll" that keeps the inspiration flowing.
* **Lazy Loading:** High-quality media loads efficiently only as you need it — video bytes aren't even fetched until you hover — keeping the interface quick and modern.
* **Instant Revisits:** API responses are cached client-side, so categories you've already visited render instantly on return, no network round-trip.

### Explore by "Vibe"
Most users aren't familiar with the intricate category tree of Wikimedia Commons. To assist in this:
* **Curated Seeds:** Start your journey with "Best of" collections like *Pictures of the Year*, *Featured Pictures*, or *Quality Images*.
* **Custom Entry:** If you know a specific category name, simply enter it in to generate a custom feed instantly.
* **Deep Context:** Every image tile includes a description. Want to go deeper? A simple pop-up menu reveals every category the file belongs to, allowing you to "teleport" to related areas quickly, whether they are visible or hidden categories.

### Shareable States
The entire state of your browser is captured in the URL.
* **Instant Sharing:** Your current category, layout settings (detailed vs. minimal), and sort filters are all stored as URL parameters (`?cat=&sort=&view=`).
* **What You See is What They Get:** Send a link to a friend, and they will see the exact same view you are looking at.

---

## 🛠️ Browsing Modes

CommonsVibe supports distinct ways to interact with media:

1.  **Alphabetical Mode:** The classic organized approach. Browse through a category's contents in order, with 12 tiles loaded at a time as you scroll.
2.  **Shuffle Mode:** For true serendipity. Using Wikimedia's *CirrusSearch*, this mode pulls 12 random tiles from a category, then another 12, and another, creating a unique, never-ending discovery session.

Both modes work in **Detailed** (filename + 3-line description) and **Minimal** (edge-to-edge images, metadata on hover) views.

---

## 🚀 Future Roadmap

CommonsVibe is evolving from a browser into a personal curation tool. Planned features include:

* **~~Category Tree Exploration~~ — shipped in v1.6:** tree modal (depth 1–5, lazy expand, file-count badges), parent/subcategory chip row, and Deep mode (`deepcategory` shuffle across the whole subtree, `?deep=1` in the URL). Still open from the original plan: multi-select union feeds, "category roulette", tree-aware `path=` URL state.
* **List Mode:** A curated "Snapshot" mode. This allows the app to load a specific set of files via their unique IDs passed through the URL—perfect for sharing a specific "vibe" or a curated set of random finds that you want to preserve for someone else.
* **Personal Collections:** The ability to "clip" or save images into your own custom sets.
* **Stateful Storage:** User accounts to sync your favorite categories and collections across devices.
* **Enhanced Search:** Natural language tools to find "vibes" without needing to know exact category names.
* **Filtering:** Filter based on filetype (eg. no TIF files, only WEBM files), more advanced display of media files.

---

## Development

The app is dependency-free vanilla JS — no build step, no package manager.

```bash
# serve the repo locally (any static server works)
python3 -m http.server 8123
# then open http://127.0.0.1:8123/
```

See `HANDOFF.md` for the test checklist, API integration notes, and the exact deploy procedure.

---

## Deployment

Live at **https://commons-vibe.toolforge.org/** (Toolforge tool `commons-vibe`, php8.4 webservice, Kubernetes backend). Files are synced directly into `/data/project/commons-vibe/public_html/`:

```bash
cat index.html | ssh alih@dev.toolforge.org \
  'sudo -niu tools.commons-vibe sh -c "cat > /data/project/commons-vibe/public_html/index.html"'
```

Repeat for `app.js`, `style.css`, `categories.txt`, `.htaccess`. Static-file changes need no webservice restart. Full procedure (with verification steps) in `HANDOFF.md`.

---

## Technical Overview

CommonsVibe is built to be lightweight and URL-driven.
* **Engine:** Vanilla JavaScript (ES module) — no framework, no build step. The app ships as `index.html` + `app.js` + `style.css` and boots instantly (previously PyScript/Pyodide; replaced August 2026).
* **API:** Interacts directly with the Wikimedia Action API and CirrusSearch, with a client-side response cache (localStorage + in-memory, TTL per endpoint kind) so repeat visits and back-navigation are instant. Category-tree data (v1.6: parents, subcats, counts) flows through the same cache — tree re-opens are instant.
* **Infinite Scroll:** One-batch prefetch lookahead keeps the grid feeding smoothly; stale requests are aborted.
* **Media:** Hover-to-play video with `preload="none"` (no bytes until hover), retina-aware thumbnails derived from the 600px base thumb, robust video/audio detection via API `mediatype`/`mime` fields.
* **Routing:** Heavy emphasis on URL parameter persistence to ensure the "Shareable View" philosophy.
* **Frontend:** Designed for high-performance image rendering and "lazy loading" patterns.
