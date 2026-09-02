#!/usr/bin/env node
/* Benchmark CommonsVibe's deep-shuffle sampler against ground truth.
 *
 * Usage: node benchmark/deep-shuffle.js [rootCategory] [--live]
 *   Ground-truth phase: fully enumerate the subtree (deeper than the sampler's
 *   own caps) — categories, direct file counts, and actual file members.
 *   Analysis phase: coverage of the sampler envelope, per-file selection
 *   probability vs uniform, chi-square on simulated picks.
 *   --live: additionally validate srsort=random uniformity with real API draws.
 *
 * Politeness: descriptive UA, global 300ms pacing, 429/5xx backoff,
 * disk cache in cache/bench/ so re-runs are free.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const API = "https://commons.wikimedia.org/w/api.php";
const UA = process.env.WIKIMEDIA_USER_AGENT ||
  "CommonsVibeBenchmark/1.0 (https://commons-vibe.toolforge.org/; contact: User:Fuzheado)";
const GAP_MS = 300;
const CACHE_DIR = path.join(__dirname, "..", "cache", "bench");

// Sampler's operational bounds (mirror app.js).
const WALK_DEPTH = 5;
const WALK_MAX_NODES = 500;
// Ground-truth walk bounds (deeper/wider than the sampler on purpose).
const TRUTH_DEPTH = 8;
const TRUTH_MAX_NODES = 600;

const rootArg = (process.argv[2] && !process.argv[2].startsWith("--"))
  ? process.argv[2] : "Category:Featured pictures of birds";
const LIVE = process.argv.includes("--live");

const norm = (s) => String(s).replace(/_/g, " ").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- cached, paced, retrying API layer ---------------- */

fs.mkdirSync(CACHE_DIR, { recursive: true });
const crypto = require("crypto");
const cachePath = (url) => path.join(CACHE_DIR, crypto.createHash("sha1").update(url).digest("hex") + ".json");

let lastStart = 0;
async function fetchJson(params) {
  const url = API + "?" + new URLSearchParams({ ...params, format: "json", formatversion: "2" }).toString();
  const cached = cachePath(url);
  if (fs.existsSync(cached)) return JSON.parse(fs.readFileSync(cached, "utf8"));
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastStart + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    const resp = await fetch(url, { headers: { "user-agent": UA } });
    if (resp.status === 429 || resp.status >= 500) {
      const ra = parseInt(resp.headers.get("retry-after") || "0", 10);
      console.warn(`  HTTP ${resp.status}, backoff ${ra || 2 ** attempt}s...`);
      await sleep(ra ? ra * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(`API error ${data.error.code}`);
    fs.writeFileSync(cached, JSON.stringify(data));
    return data;
  }
  throw new Error("retries exhausted");
}

async function batched(titles, params, prop) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const data = await fetchJson({ ...params, titles: chunk.join("|") });
    for (const p of data.query.pages || []) out.set(norm(p.title), p);
  }
  return out;
}

/* ---------------- phase 1: ground-truth enumeration ---------------- */

// {normTitle: {title, depth, files (info), subcats (info), fileMembers [titles]}}
const tree = new Map();

async function walk(rootCat) {
  const root = { title: rootCat, depth: 0 };
  tree.set(norm(rootCat), root);
  let frontier = [root];
  for (let d = 1; d <= TRUTH_DEPTH && frontier.length; d++) {
    const next = [];
    for (const node of frontier) {
      if (tree.size >= TRUTH_MAX_NODES) break;
      const data = await fetchJson({
        action: "query", list: "categorymembers",
        cmtitle: node.title, cmtype: "subcat", cmlimit: "max",
      });
      for (const m of data.query.categorymembers || []) {
        if (tree.has(norm(m.title))) continue; // DAG
        const child = { title: m.title, depth: d };
        tree.set(norm(m.title), child);
        next.push(child);
        if (tree.size >= TRUTH_MAX_NODES) break;
      }
    }
    process.stdout.write(`\r  walk depth ${d}: ${tree.size} categories   `);
    frontier = next;
  }
  console.log();
}

async function collectInfo() {
  const titles = [...tree.values()].map((n) => n.title);
  console.log(`  categoryinfo for ${titles.length} categories...`);
  const info = await batched(titles, { action: "query", prop: "categoryinfo" });
  for (const n of tree.values()) {
    const p = info.get(norm(n.title));
    n.files = p && p.categoryinfo ? p.categoryinfo.files || 0 : 0;
    n.subcats = p && p.categoryinfo ? p.categoryinfo.subcats || 0 : 0;
  }
}

async function collectFileMembers() {
  console.log("  listing direct file members per category...");
  let i = 0;
  for (const n of tree.values()) {
    n.fileMembers = [];
    let cont = null;
    do {
      const params = {
        action: "query", list: "categorymembers",
        cmtitle: n.title, cmtype: "file", cmlimit: "max",
      };
      if (cont) Object.assign(params, cont);
      const data = await fetchJson(params);
      for (const m of data.query.categorymembers || []) n.fileMembers.push(m.title);
      cont = data.continue || null;
    } while (cont && n.fileMembers.length < 5000);
    if (++i % 25 === 0) process.stdout.write(`\r  members: ${i}/${tree.size}   `);
  }
  console.log(`\r  members: ${tree.size}/${tree.size}   `);
}

/* ---------------- phase 2: analysis ---------------- */

function chiSquareP(observed, expected) {
  // Pool sparse cells (<5 expected) into one, then Wilson–Hilferty p approx.
  const obs = [], exp = [];
  let tailO = 0, tailE = 0;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] < 5) { tailO += observed[i]; tailE += expected[i]; }
    else { obs.push(observed[i]); exp.push(expected[i]); }
  }
  if (tailE > 0) { obs.push(tailO); exp.push(tailE); }
  let x2 = 0;
  for (let i = 0; i < obs.length; i++) x2 += (obs[i] - exp[i]) ** 2 / exp[i];
  const df = obs.length - 1;
  if (df <= 0) return { x2, df, p: NaN };
  const z = (Math.cbrt(x2 / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  const p = 1 - 0.5 * (1 + erf(z / Math.SQRT2));
  return { x2, df, p };
}
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function analyze() {
  const nodes = [...tree.values()];
  console.log(`\n=== Tree shape (root: ${rootArg}) ===`);
  console.log(`  categories discovered: ${nodes.length} (truth walk: depth ${TRUTH_DEPTH}, cap ${TRUTH_MAX_NODES})`);
  for (let d = 0; d <= TRUTH_DEPTH; d++) {
    const at = nodes.filter((n) => n.depth === d);
    if (at.length) console.log(`    depth ${d}: ${String(at.length).padStart(4)} cats, ${String(at.reduce((s, n) => s + n.files, 0)).padStart(6)} direct files`);
  }

  // Ground-truth population: distinct files anywhere in the truth tree.
  const memberOf = new Map(); // fileTitle -> [catNormTitles]
  for (const n of nodes) for (const f of n.fileMembers || []) {
    if (!memberOf.has(f)) memberOf.set(f, []);
    memberOf.get(f).push(norm(n.title));
  }
  const population = memberOf.size;

  // Sampler envelope: depth<=5, first WALK_MAX_NODES in BFS order (approximate
  // the app's walk; exact tie-order differs but coverage stats are representative).
  const envelope = nodes.filter((n) => n.depth <= WALK_DEPTH).slice(0, WALK_MAX_NODES);
  const envSet = new Set(envelope.map((n) => norm(n.title)));
  const visibleFiles = new Set();
  for (const n of envelope) for (const f of n.fileMembers || []) visibleFiles.add(f);

  console.log(`\n=== Coverage (can the sampler even see the file?) ===`);
  console.log(`  full-tree distinct files:   ${population}`);
  console.log(`  within sampler envelope:    ${visibleFiles.size} (${(100 * visibleFiles.size / population).toFixed(1)}%)`);
  const beyondDepth = nodes.filter((n) => n.depth > WALK_DEPTH);
  const beyondFiles = new Set();
  for (const n of beyondDepth) for (const f of n.fileMembers || []) if (!visibleFiles.has(f)) beyondFiles.add(f);
  console.log(`  only beyond depth ${WALK_DEPTH}:     ${beyondFiles.size} (${(100 * beyondFiles.size / population).toFixed(1)}%) — invisible to old deepcategory at d=5`);
  const nodeCapped = nodes.filter((n) => n.depth <= WALK_DEPTH).length - envelope.length;
  if (nodeCapped > 0) console.log(`  dropped by ${WALK_MAX_NODES}-node cap: ${nodeCapped} categories (depth<=5)`);

  // Sampler per-file probability: P(pick cat c) = files_c / W, uniform inside c
  // => P(file f) = (number of envelope cats containing f) / W.
  const W = envelope.reduce((s, n) => s + n.files, 0);
  const weights = envelope.map((n) => n.files); // aligned with envSet
  const probs = new Map(); // file -> sampler probability
  envelope.forEach((n, i) => {
    if (!weights[i]) return;
    for (const f of n.fileMembers || []) probs.set(f, (probs.get(f) || 0) + weights[i] / W);
  });

  console.log(`\n=== Uniformity within envelope (${visibleFiles.size} files, total weight W=${W}) ===`);
  const mult = new Map();
  for (const f of visibleFiles) {
    const m = (memberOf.get(f) || []).filter((c) => envSet.has(c)).length;
    mult.set(f, m);
  }
  const dist = {};
  for (const m of mult.values()) dist[m] = (dist[m] || 0) + 1;
  console.log("  category-membership multiplicity of files (tickets in the weighted draw):");
  for (const k of Object.keys(dist).sort((a, b) => a - b)) {
    console.log(`    in ${k} cat(s): ${String(dist[k]).padStart(5)} files (${(100 * dist[k] / visibleFiles.size).toFixed(1)}%)`);
  }
  let tvSum = 0;
  const ratios = [];
  for (const f of visibleFiles) {
    const ideal = 1 / visibleFiles.size;
    // P(f) = (number of envelope cats containing f) / W — each membership
    // contributes 1/W (weighted pick of cat c, then uniform within c).
    const actual = (mult.get(f) || 0) / W;
    tvSum += Math.abs(actual - ideal);
    ratios.push(actual / ideal);
  }
  const tv = tvSum / (2 * visibleFiles.size);
  ratios.sort((a, b) => a - b);
  console.log(`  total-variation distance from perfect uniform: ${(tv * 100).toFixed(1)}% (of max 100%)`);
  console.log(`  per-file probability / ideal: min=${ratios[0].toFixed(2)}x  median=${ratios[Math.floor(ratios.length / 2)].toFixed(2)}x  max=${ratios[ratios.length - 1].toFixed(2)}x`);
  const p99 = ratios[Math.floor(ratios.length * 0.99)];
  console.log(`  p1=${ratios[Math.floor(ratios.length * 0.01)].toFixed(2)}x  p99=${p99.toFixed(2)}x (1.0 = perfectly fair)`);

  // Chi-square: simulate the sampler's category pick 100k times.
  console.log(`\n=== Chi-square: weighted category pick (100k simulated batches) ===`);
  const N = 100000;
  const counts = new Array(envelope.length).fill(0);
  for (let i = 0; i < N; i++) {
    let r = Math.random() * W;
    for (let j = 0; j < envelope.length; j++) {
      r -= weights[j];
      if (r <= 0) { counts[j]++; break; }
    }
  }
  const expected = weights.map((w) => N * w / W);
  const { x2, df, p } = chiSquareP(counts, expected);
  console.log(`  chi2=${x2.toFixed(1)} df=${df} p=${p.toFixed(4)} ${p > 0.05 ? "→ consistent with weighted-uniform (good)" : "→ deviation beyond chance (investigate)"}`);

  return { population, visibleFiles: visibleFiles.size, envSet, probs, mult, W, envelope, weights };
}

/* ---------------- phase 3: live draw validation ---------------- */

async function liveDraws() {
  // Validate server-side srsort=random: repeatedly draw from one mid-size
  // category and check file frequencies are uniform.
  const nodes = [...tree.values()].filter((n) => (n.files || 0) >= 20 && (n.files || 0) <= 300);
  if (!nodes.length) { console.log("  no mid-size category for live test"); return; }
  nodes.sort((a, b) => a.files - b.files);
  const target = nodes[Math.floor(nodes.length / 2)];
  const catName = target.title.replace(/^Category:/, "");
  const DRAWS = 40;
  console.log(`\n=== Live draw test: srsort=random over "${target.title}" (${target.files} files, ${DRAWS} draws x 50) ===`);
  const tally = new Map();
  const universe = new Set();
  for (let i = 0; i < DRAWS; i++) {
    const data = await fetchJson({
      action: "query", list: "search",
      srsearch: `incategory:"${catName}"`, srnamespace: "6",
      srlimit: "50", srsort: "random",
    });
    for (const r of data.query.search || []) { tally.set(r.title, (tally.get(r.title) || 0) + 1); universe.add(r.title); }
    process.stdout.write(`\r  draw ${i + 1}/${DRAWS}, ${universe.size} distinct files seen   `);
  }
  console.log();
  const titles = [...universe];
  const obs = titles.map((t) => tally.get(t) || 0);
  // Batches return min(srlimit, categorySize) results — use the observed total.
  const totalResults = obs.reduce((a, b) => a + b, 0);
  const exp = titles.map(() => totalResults / titles.length);
  const { x2, df, p } = chiSquareP(obs, exp);
  obs.sort((a, b) => a - b);
  console.log(`  distinct files seen: ${universe.size}/${target.files} | min=${obs[0]} median=${obs[Math.floor(obs.length / 2)]} max=${obs[obs.length - 1]} (expected ~${exp[0].toFixed(1)} each)`);
  console.log(`  chi2=${x2.toFixed(1)} df=${df} p=${p.toFixed(4)} ${p > 0.05 ? "→ server random is consistent with uniform (good)" : "→ server random deviates (investigate)"}`);
}

/* ---------------- main ---------------- */

(async () => {
  console.log(`Benchmarking deep shuffle for: ${rootArg}`);
  console.log(`Ground truth walk: depth<=${TRUTH_DEPTH}, <=${TRUTH_MAX_NODES} nodes; pacing ${GAP_MS}ms`);
  console.log(`\n=== Phase 1: enumerate ground truth ===`);
  await walk(rootArg);
  await collectInfo();
  await collectFileMembers();
  analyze();
  if (LIVE) await liveDraws();
  console.log("\nDone.");
})().catch((e) => { console.error(e); process.exit(1); });
