# Thumbnail Metrics & Benchmarks

Measured 2026-09-02/03. Sample image: `File:Dülmen, Umland, Sonnenaufgang -- 2012 -- 8084.jpg`
(3456×5184 portrait JPEG, featured picture). Live page: `?cat=Featured pictures of birds`, M density
(4 columns @1280px viewport ≈ **284px slots**), DPR 1 (headless).

## Discovery: the thumbnail infrastructure migrated + bucket-quantizes

The Action API now serves thumbs from **`thumb.wikimedia.org`** (was `upload.wikimedia.org`)
and quantizes requested widths **upward to a pre-rendered bucket ladder**, while
`thumbwidth` still *reports* the requested width:

| requested (`iiurlwidth`) | served (parsed from URL) | bytes | notes |
|---|---|---|---|
| 200 | 250px | 26,424 B | |
| 330 | 330px | 42,695 B | exact |
| 480 | 500px | 91,704 B | near-exact |
| **600** | **960px** | **284,010 B** | **v1.10-and-earlier default — jumps two buckets** |
| 800 | 960px | 284,010 B | same bucket |
| 960 | 960px | 284,010 B | exact |
| 1280 | 1280px | 458,784 B | |

Ladder observed: **250 / 330 / 500 / 960 / 1280** (ascending). Any request in
(500, 960] serves 960px. `responsiveUrls` (imageinfo) provides the sanctioned 2×
URL: for `iiurlwidth=480` it returns the 960px rendition.

Other facts:
- **No WebP/AVIF**: `Accept: image/webp` and `lossy-webp` URL variants still
  return `image/jpeg` (tested 2026-09-03).
- `srsort=random` is genuinely random per request (validated ×3, no seed stickiness).
- Old host `upload.wikimedia.org/wikipedia/commons/thumb/...` URLs still resolve.

## Baseline (v1.10/v1.11 — before fix, as reported by users)

- `iiurlwidth=600` → **960px served (284KB) into ~284px slots**: ~3.4× more pixels
  than needed on 1× screens.
- Density `srcset` (1x/2x, no `sizes`): 2× candidate requested the 1280px bucket
  (459KB) for retina users.
- Estimated batch weight: **12 tiles ≈ 1.5–3.4 MB**, dominated by oversize thumbs.
- Old density-srcset + string-surgery bug: multi-draw deep batches passed title
  strings into `pickNewTitles` (reads `.title`) → `[undefined]` → "End of
  collection" after one batch (fixed separately).

## After (v1.12)

- `iiurlwidth=480` → served 500px bucket.
- `srcset` is **width-descriptor** based: `thumburl 500w, responsiveUrls["2"] 960w`
  (API-sanctioned URLs — no string surgery), plus `sizes="<slot>px"` computed from
  the S/M/L column math at render time.
- Expected per-slot picks: 1× screens → **500w (~92KB)**, 2× screens → 960w
  (~284KB, correct retina fidelity for the pixels delivered).
- `<link rel="preconnect">` to `thumb.wikimedia.org` + `upload.wikimedia.org`,
  `dns-prefetch` to `commons.wikimedia.org`.

### Measured after deploy (live, 2026-09-03)

Sampled the first rendered tiles on the live feed (birds category, M density):

| tile | old (960px thumb) | new (500px thumb) | saved |
|---|---|---|---|
| 1 | 277 KB | 89 KB | 68% |
| 2 | 97 KB | 27 KB | 72% |
| 3 | 233 KB | 80 KB | 66% |
| **total** | **607 KB** | **197 KB** | **~68%** |

Browser srcset behavior verified: 284px slot, `sizes="294px"`, candidates
`500w + 960w` → **chose 500px** at DPR 1 (960w reserved for retina/L-density).

## Timeline: when did this happen?

| date | event | source |
|---|---|---|
| 2017 | Thumbor replaces MediaWiki-side thumbnailing — the architecture the old skill docs described | T121388, Diff blog series |
| 2026-06-08 | DNS commit `b9a19e3` "wikimedia.org: Introduce thumb.wikimedia.org" (ref T427465) | operations-dns git |
| FY26-27 (Jul '26–Jun '27) | Umbrella task **T431141 "Evolve thumbnail infrastructure"** (Ladsgroup); **T427465 "Move thumbnail caching from upload cluster to text"** subtask — **In Progress**, staged per-wiki rollout | Phabricator |
| ~Aug 2026 | Varnish VCL reconfigured for thumb serving on the text cluster (T435193) | SAL / gerrit |
| 2026-08-27 | **T435979** TemplateStyles allow-lists thumb.wikimedia.org, deployed to production (gerrit 1329317) | SAL |
| rolling | Per-wiki exposure of the new thumbnail endpoint (e.g. "Expose the new thumbnail endpoint on dewiki (T427465)"); **no public date for when commons.wikimedia.org flipped** — it landed somewhere between our 2026-09-02 session (old behavior observed) and the 2026-09-03 audit (new behavior) | production SAL |
| 2026-09-03 | Noticed during the CommonsVibe image audit; fixed in v1.12 | this repo |

**Status: migration in flight.** T427465 is still In Progress under the FY26-27
umbrella; expect thumb behavior (hosts, buckets, endpoints) to keep shifting.
Related open work: **T425181** (REST endpoint for thumbnail variants),
**T402792** (rate-limiting non-standard sizes).

## Official confirmation (not a fluke)

- **T427465** — thumbnail caching moved from the upload cluster to text;
  DNS commit `b9a19e3` introduced **thumb.wikimedia.org**
- **T360589** — MediaWiki enforces `$wgThumbnailSteps = [20, 40, 60, 120, 250,
  330, 500, 960, 1280, 1920, 3840]`
- **T412971 / T414805** — standard sizes proposal + rollout (resolved)
- **T388792** — official acknowledgment: the URL points at the nearest larger
  standard size while `thumbwidth` still reports the requested width
- **T402792** — rate-limiting non-standard thumbnail sizes under consideration
  (arbitrary widths are a liability, not just wasteful)
- **T66214** — "Existing thumb URLs are considered private, and are not
  designed for use as a public API"

Proof-of-behavior (curl, 2026-09-03): hand-constructed
`upload.wikimedia.org/.../600px-` → **HTTP 400**; `500px-` and `330px-` → 200.
`iiurlwidth=600` reports `thumbwidth: 600` but serves `/960px-`. The skills
repo fix (Wikipedia-AI-Skills PR #26) documents this for future sessions.

## Re-running the benchmark

```bash
# bucket ladder + bytes for any file at any requested width
curl -s -A "$WIKIMEDIA_USER_AGENT" --get 'https://commons.wikimedia.org/w/api.php' \
  --data-urlencode 'action=query' --data-urlencode 'titles=File:<name>' \
  --data-urlencode 'prop=imageinfo' --data-urlencode 'iiprop=url|size' \
  --data-urlencode 'iiurlwidth=<W>' --data-urlencode 'format=json' --data-urlencode 'formatversion=2' \
  | jq -r '.query.pages[0].imageinfo[0].thumburl'
# then curl -o /dev/null -w '%{size_download}' '<thumburl>'
```
