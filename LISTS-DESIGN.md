# CommonsVibe — Lists: design direction

**Status:** living design doc (2026-10-03). This is *direction*, not project state —
for state, tests, URL contract and deploy, see [`HANDOFF.md`](HANDOFF.md). When a
phase here ships, HANDOFF gets the factual entry and this doc gets a status note
on that phase.

**Scope:** how CommonsVibe handles *arbitrary collections of Commons files* — PagePile
and PetScan lists, imported exports, and the personal clip collection — as opposed
to the category trees the app was built around.

Related issues: #32 (export → PagePile), #33 (ingestion, phase 2), #30 (export, shipped
v1.22), #31 (deep subtree, shipped v1.26/v1.27).

---

## 1. Decisions taken (2026-10-03)

### 1.1 List references are prefix-only — bare numbers are rejected

The Jump box and the config accept `pile:<id>`, `psid:<id>`, `pet:<Category>&depth=<n>`,
and pasted **URLs**. A bare number (e.g. `116948`) is deliberately *not* a list
reference. Rationale: numeric identifiers are not self-describing, and Commons will
keep producing new ones (QIDs, file ids, log ids). Prefixes keep the namespace open.

Refinements that make this livable:

- **Pasted URLs count as typed** — they carry their type in the host/param, so the
  dominant copy-paste flow (`pagepile.toolforge.org/api.php?id=…`,
  `petscan.wmcloud.org/?psid=…`) needs no prefix.
- **Teach, don't ignore**: an all-digits query shows one hint row — *"Numeric IDs need
  a prefix — try `pile:116948` or `psid:12345`"*.
- **Table-driven**: one regex + a source map, so a future `qid:` is a one-line addition.
- Unknown prefixes are ignored silently (no error state).

### 1.2 `pet:` is accepted

`pet:Category:Name&depth=2 | My label` — `depth` optional (default 1, clamped 1–5).
`|` remains the label separator (legal: `|` cannot occur in a MediaWiki title).
`pet:` lists are live queries (1h cache), so their count is whatever PetScan returns.

### 1.3 Storage: `vibe_config` holds *references*, not payloads

`vibe_config` is the same human-editable blob the category list lives in, so list
references go there as `pile:116948 | Label` lines. **Bulk titles must not.** The key
shares a browser's localStorage budget with `cv_api_cache_v1`, which the app caps at
**2 MB**; a 5,000-title inline list is ~225 KB. Therefore:

| What | Where |
|---|---|
| List references (`pile:`/`psid:`/`pet:` + label) | `vibe_config` (small, editable, exported with the category list) |
| Personal clip collection | `vibe_clips` (unchanged) |
| Imported / generated inline title sets | a payload key (`vibe_lists`, phase 2), capped; **large sets are published to a PagePile instead** and stored as a reference |

Consequence to note in HANDOFF when this ships: older app versions reading a
`pile:` line report it as an invalid category (harmless, but new syntax in a
previously category-only field).

---

## 2. Current-state audit (verified 2026-10-03, v1.27.2)

### 2.1 Already in good shape

`state.list` is a source-agnostic cursor (`clips` / `pile` / `psid` / `pet`) sharing one
rendering path, so list feeds inherit: infinite scroll + end-of-collection, the
media-type filter, the viewer (incl. prev/next over the rendered order), the export
dialog, clip buttons, and the `?pile=`/`?psid=`/`?pet=`/`?clips=1` URL contract.
`fetchCategoryInfo()` already prints the *list* length in the count badge;
`fetchTreebar()` already hides itself for lists; the sort pill hides; the roulette
lives inside the treebar and therefore disappears naturally. The clip collection
proves the model end to end.

### 2.2 The four leaks (all reproduced, all category assumptions)

| Leak | Reproduction | Effect | Status |
|---|---|---|---|
| `path=` + list not mutually exclusive | `?pile=116948&path=Foo/Bar` | `currentCategory` set from the trail, **crumbs render** — a bogus category trail over a list feed | fixed in v1.28 |
| `deep=1` + list unguarded | `?pile=116948&deep=1` | Deep chip + banner reading *"sampling **and all its subcategories**"* with an empty name; sampler targets nothing | fixed in v1.28 |
| Tree browser visible in list mode | `?pile=116948` | Opens a tree for a nonexistent category | fixed in v1.28 |
| Failure path used `alert()` | any bad pile id | Modal "Couldn't load the PagePile list" instead of the inline error banner | fixed in v1.28 |

### 2.3 Structural gap

The header never states which mode you are in: categories and lists share one
dropdown and one count badge. "2" means *2 files in this pile*, "783" means *783 files
in this category*, and the tree/Deep/roulette affordances silently vanish. Once lists
are common the header must make the mode visible (badge on the dropdown; count
labelled accordingly).

---

## 3. Ingestion (phase 2, issue #33)

**Does it make sense?** Yes, as a convenience — not as the primary interchange. The
four real flows: (a) re-open a set you exported earlier (device/browser switch,
cleared storage); (b) import a colleague's JSON/CSV; (c) bring in lists from other
tools (pattypan, OpenRefine, WQS, spreadsheets); (d) export → annotate in a
spreadsheet → re-import → publish. For arbitrary sets, **PagePile remains the better
interchange** (server-side, deduped, resolvable, ecosystem-standard, shareable);
ingestion serves file-based workflows.

**Design sketch**

- **Surfaces:** the dropdown's *＋ Add a list…* and the ✏️ list editor; accept pasted
  text and a picked/dropped file.
- **Formats (liberal):** our JSON envelope (`tool: "CommonsVibe"`, `files[].title`);
  our CSV (locate the `title` column by header — needs a real RFC-4180 reader, our
  cells can contain quoted newlines); plain `File:`-per-line text; bare titles;
  `commons.wikimedia.org/wiki/…` URLs.
- **Validation:** batched `titles=` (50/call, existing `batchInfo` path) →
  **always report counts**: "58 imported · 2 not found · 3 duplicates". Never silently
  drop.
- **Result:** opens as a feed. Persist only if small/named; otherwise offer
  *Publish to PagePile to share* (a local set is not shareable, and the UI must say so).
- **URL:** `?list=local:<id>` for browser-local lists (honest about being local),
  distinct from `?pile=`/`?psid=`/`?pet=` which are remote and shareable.

---

## 4. What else breaks when arbitrary lists become common

1. **Sort semantics for a fixed set.** Today sort is hidden for lists. Users will want
   *"shuffle my 60 picks"* and *"sort my set alphabetically"* — a local draw over a
   title array (no CirrusSearch). Genuinely new capability; phase 3.
2. **Stale members.** Piles are snapshots; files get deleted or renamed, and today
   missing titles are skipped silently. Lists need **health**: "57 of 60 files still
   exist", plus a way to see and export the dead ones.
3. **Naming.** "PagePile 116948" is a fallback, not a name. Saved entries use the
   existing `| Label` convention; the manager must let users rename.
4. **Local sets aren't shareable.** Needs an explicit URL story (`?list=local:<id>`)
   and a *publish to share* nudge rather than pretending local == shareable.
5. **Management surface.** The ✏️ modal becomes the list manager too (title/copy and
   per-prefix validation must branch); a real Lists panel (rename, delete, publish,
   import, health) is the eventual home.
6. **Config size** (§1.3) — inline payloads must not accumulate in `vibe_config`.

---

## 5. Phasing

| Phase | Scope | State |
|---|---|---|
| **v1.28** | Prefix entry (`pile:`/`psid:`/`pet:` + URLs + numeric hint) in the Jump box; saved lists in `vibe_config` rendered as a **Lists** group; the four leaks fixed; **Create PagePile** in the export dialog with a result panel (`?pile=` link back) | shipped |
| **v1.29** | Ingestion (JSON/CSV/text/drop) with count feedback; list health (missing members); `?list=local:<id>`; publish-to-share nudge — issue #33 | open |
| **v1.30** | Lists as first-class: shuffle/sort *within* a fixed set, entry removal, Lists manager panel, visible mode badge in the header | open |

## 6. Open questions

- Should a list feed be able to *append* to the clips collection (and vice-versa)?
- PetScan `pet:` lists are live queries: cache TTL is 1h today — is that right for a
  list the user is actively working on?
- When a saved list's remote source disappears (pile deleted), does it self-heal
  (keep the last-known titles) or fail loudly?
