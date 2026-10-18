async page => {
  // TDD spec for tree-modal depth (v1.31): the ceiling moves from 5 to 8 with a
  // "Fully" option, the node budget becomes visible, and the dialog is honest
  // about what the shuffle can mirror.
  //
  // WHY THIS SHAPE (measured 2026-10-18 on Category:Wiki Loves Monuments 2026):
  // depth 5 and an *injected* depth 8 rendered exactly the same 200 nodes, in the
  // same 64 API calls and 13.5 s — the node budget bound first, because one
  // `categorymembers` call returns 500 titles for a whole level. So:
  //   · a numbered depth still bounds a walk (depth 2 → 67 nodes, not truncated),
  //   · "Fully" removes the depth bound and lets the budget stop the walk,
  //   · and the budget readout is what makes "Fully" meaningful.
  // `?treecap=N` is a supported debug override (app.js boot), which keeps this
  // spec fast: truncation is reached in a few seconds instead of ~35 s.
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  // Wiki Loves Monuments 2026: wide enough to burn a small budget, and 2,051-file
  // subtrees hang off it, so it exercises breadth and depth at once.
  const TREE = "?cat=Category%3AWiki%20Loves%20Monuments%202026&tree=1";

  const snap = () => page.evaluate(() => ({
    sel: document.getElementById("tree-depth").value,
    state: window.__cvState.treeDepth,
    status: document.getElementById("tree-status").textContent,
    budget: document.getElementById("tree-budget").textContent,
    loadMore: !!document.getElementById("tree-load-more"),
    note: (document.getElementById("tree-depth-note").textContent || "").trim(),
    nodes: document.querySelectorAll("#tree-content .tree-node").length,
    search: location.search,
  }));

  // The tree renders progressively — #tree-status updates after EVERY node — so
  // "status exists" means "one level arrived", not "the walk finished". Waiting on
  // a specific budget string can't work either (the final count isn't known ahead
  // of time), so settle on network quiet: the walker issues one request per node
  // with a 150 ms throttle, which leaves gaps of ~150 ms between calls. Require a
  // full second with zero in-flight api.php requests.
  let pending = 0;
  const isApi = (url) => /commons\.wikimedia\.org\/w\/api\.php/.test(url);
  page.on("request", (r) => { if (isApi(r.url())) pending++; });
  page.on("requestfinished", (r) => { if (isApi(r.url())) pending--; });
  page.on("requestfailed", (r) => { if (isApi(r.url())) pending--; });

  const quiet = async () => {
    let zeroSince = 0;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      if (pending <= 0) {
        if (!zeroSince) zeroSince = Date.now();
        else if (Date.now() - zeroSince > 1000) return;
      } else zeroSince = 0;
      await page.waitForTimeout(120);
    }
  };

  const open = async (qs) => {
    await page.goto(BASE + "/" + qs, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => /subcategor/.test((document.getElementById("tree-status") || {}).textContent || ""),
      null,
      { timeout: 180000 },
    ).catch(() => {});
    await quiet();
    return snap();
  };

  await page.setViewportSize({ width: 1280, height: 800 });

  // ── 1. The control itself ────────────────────────────────────────────────
  const d2 = await open(TREE + "&depth=2&treecap=200");
  const options = await page.evaluate(() => [...document.querySelectorAll("#tree-depth option")].map((o) => o.value));
  t("depth: the select offers 1–8 plus Fully", options.join(",") === "1,2,3,4,5,6,7,8,max", options.join(","));
  t("depth: a numbered depth boots and bounds the walk", d2.sel === "2" && d2.state === 2 && d2.loadMore === false, `sel=${d2.sel} nodes=${d2.nodes}`);
  t("depth: the budget is printed, not implied", /^· budget \d+\/200$/.test(d2.budget), d2.budget);
  t("depth: a shallow depth shows no shuffle caveat", d2.note === "", `"${d2.note}"`);

  // ── 2. Ceiling and URL contract ──────────────────────────────────────────
  const d8 = await open(TREE + "&depth=8&treecap=200");
  t("depth: 8 is selectable and survives the boot clamp", d8.sel === "8" && d8.state === 8, `sel=${d8.sel} state=${d8.state}`);
  t("depth: a deeper-than-ceiling URL clamps to 8 (not silently to the default)", d8.search.includes("depth=8"), d8.search.slice(0, 80));

  const d12 = await open(TREE + "&depth=12&treecap=40");
  t("depth: depth=12 clamps to 8 rather than being ignored", d12.sel === "8" && d12.state === 8, `sel=${d12.sel} state=${d12.state}`);
  t("depth: a deep choice explains what the shuffle cannot reach", /~5 levels/.test(d8.note), d8.note);

  // ── 3. "Fully" = no depth bound, the budget decides ──────────────────────
  const full = await open(TREE + "&depth=max&treecap=200");
  t("fully: boots as the Fully option", full.sel === "max" && full.state === 99, `sel=${full.sel} state=${full.state}`);
  t("fully: the URL carries depth=max (additive on the existing param)", full.search.includes("depth=max"), full.search.slice(0, 80));
  t("fully: the walk stops at the budget, not at a depth number", full.loadMore === true && /budget 200 reached/.test(full.budget), full.budget);
  t("fully: truncation says how many subcategories were shown", /^200 subcategor/.test(full.status), full.status);

  // Load More must keep "Fully" (the depth lives in the select, not in a closure)
  // and raise the ceiling by 500 — the v1.21 chained-walk pattern.
  await page.locator("#tree-load-more").click();
  await quiet();
  const afterMore = await snap();
  t("fully: Load more raises the ceiling and stays on Fully", afterMore.sel === "max" && /\/700$/.test(afterMore.budget), `${afterMore.sel} ${afterMore.budget}`);
  t("fully: the widened walk reports its own progress", /budget \d+\/700$/.test(afterMore.budget) && afterMore.nodes > 200, afterMore.budget);

  // ── 4. Selecting in the UI drives state and URL ──────────────────────────
  await page.selectOption("#tree-depth", "7");
  await page.waitForTimeout(1200);
  const sel7 = await snap();
  t("depth: choosing 7 updates state and the URL", sel7.state === 7 && sel7.search.includes("depth=7"), `${sel7.state} ${sel7.search.slice(-20)}`);
  t("depth: choosing 7 re-shows the caveat", /~5 levels/.test(sel7.note), sel7.note);

  await page.selectOption("#tree-depth", "5");
  await page.waitForTimeout(1200);
  const sel5 = await snap();
  t("depth: going back to 5 hides the caveat again", sel5.state === 5 && sel5.note === "", `state=${sel5.state} note="${sel5.note}"`);

  // ── 5. Interactive expansion is still unbounded (the 5 was never a hard cap) ──
  await page.goto(BASE + "/" + TREE + "&depth=1&treecap=200", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => /subcategor/.test((document.getElementById("tree-status") || {}).textContent || ""),
    null,
    { timeout: 120000 },
  ).catch(() => {});
  await page.waitForTimeout(400);
  const beforeClick = (await snap()).nodes;
  const toggle = page.locator('#tree-content .tree-row button.tree-toggle:not(.pointer-events-none)').first();
  const hasToggle = await toggle.count();
  let afterClick = beforeClick;
  if (hasToggle) {
    await toggle.click();
    await quiet();
    afterClick = (await snap()).nodes;
  }
  t("depth: chevrons expand past the selected depth", hasToggle === 1 && afterClick > beforeClick, `${beforeClick} → ${afterClick}`);

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `tree-depth spec: all ${results.length} assertions pass`;
}
