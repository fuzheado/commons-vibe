async page => {
  // TDD spec for the serial "browse entire subtree" walk (v1.27, issue #31b;
  // run via `playwright-cli run-code --filename=tests/deep-serial.spec.js`
  // against a local server on :8123).
  //
  // Covers: deep+alpha boots as an ordered subtree walk (deep no longer forces
  // shuffle), the tree modal's "Browse Entire Subtree" button starts it, the
  // banner is mode-aware, subcategory files come before the root's own bulk,
  // the walk dedupes cross-listed files, and the sort toggle switches between
  // walking and sampling while deep stays on.
  // Category: Quality images of China (10 subcategories, 180 direct files).
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  const CAT = "Category%3AQuality+images+of+China";
  const ROOT = "Category:Quality images of China";
  const banner = () => page.evaluate(() => document.getElementById("deep-banner").textContent.replace(/\s+/g, " ").trim());

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  // ── 1. The tree-modal entry point: Browse Entire Subtree ──────────────
  await page.goto(BASE + "/?cat=" + CAT + "&tree=1&depth=2", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#tree-browse-btn", { timeout: 30000 });
  await page.locator("#tree-browse-btn").click();
  await page.waitForFunction(() => document.querySelectorAll(".group").length >= 12, null, { timeout: 60000 });
  const entry = await page.evaluate(() => ({
    url: location.search,
    modalHidden: document.getElementById("tree-modal").classList.contains("hidden"),
  }));
  t("browse button: URL carries deep=1 AND sort=alpha", /deep=1/.test(entry.url) && /sort=alpha/.test(entry.url), entry.url);
  t("browse button: closes the tree modal", entry.modalHidden === true);
  t("browse button: banner says Deep browse", /Deep browse/.test(await banner()), (await banner()).slice(0, 60));
  t("browse button: tiles render in serial mode", (await page.evaluate(() => document.querySelectorAll(".group").length)) >= 12);

  // ── 2. Walker state + ordering (subcategories before the root's bulk) ──
  await page.waitForTimeout(1200);
  const walk = await page.evaluate((ROOT) => {
    const st = window.__cvState;
    const pages = st.feedPages.slice(0, 12);
    return {
      root: st.deepSerial && st.deepSerial.root,
      expanded: st.deepSerial ? st.deepSerial.catsSeen.size : 0,
      first12RootFiles: pages.filter((p) => (p.categories || []).some((c) => c.title === ROOT)).length,
    };
  }, ROOT);
  t("walk: state.deepSerial drives the feed", walk.root === ROOT, String(walk.root));
  t("walk: root expanded + subcategories entered", walk.expanded >= 2, `${walk.expanded} categories expanded`);
  t("walk: no root-category file in the first 12 tiles (own files last)", walk.first12RootFiles === 0, `${walk.first12RootFiles} root files`);

  // ── 3. Dedupe across the walk (cross-listed files appear once) ────────
  await page.mouse.move(640, 500);
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1800);
  }
  const dedupe = await page.evaluate(() => {
    const titles = window.__cvState.feedPages.map((p) => p.title);
    return { drawn: titles.length, unique: new Set(titles).size };
  });
  t("walk: drawn titles unique (dedupe across categories)", dedupe.drawn >= 24 && dedupe.unique === dedupe.drawn, `${dedupe.unique}/${dedupe.drawn} unique`);

  // ── 4. Sort toggle switches walking/sampling, deep stays on ───────────
  // Wait for a NEW feed (requestId bump) that has tiles — a bare tile count is
  // already satisfied by the pre-click feed, which both flaked and false-passed
  // in-suite on 2026-10-03. The sampler's first batch also races the subtree walk
  // (800ms), so allow real time.
  const reqShuffle = await page.evaluate(() => window.__cvState.requestId);
  await page.locator("#sort-toggle").click();
  await page.waitForFunction(
    (r) => window.__cvState.requestId > r && document.querySelectorAll(".group").length >= 12,
    reqShuffle,
    { timeout: 90000 },
  ).catch(() => {});
  const shuf = await page.evaluate(() => ({
    url: location.search,
    chip: !document.getElementById("deep-chip").classList.contains("hidden"),
    knob: document.getElementById("sort-knob").style.transform,
  }));
  t("toggle→shuffle: deep=1 stays in the URL", /deep=1/.test(shuf.url) && /sort=shuffle/.test(shuf.url), shuf.url);
  t("toggle→shuffle: Deep chip still shown", shuf.chip === true);
  t("toggle→shuffle: banner switches to Deep shuffle", /Deep shuffle/.test(await banner()), (await banner()).slice(0, 60));
  t("toggle→shuffle: tiles render (sampler)", (await page.evaluate(() => document.querySelectorAll(".group").length)) >= 12);

  const reqAlpha = await page.evaluate(() => window.__cvState.requestId);
  await page.locator("#sort-toggle").click();
  await page.waitForFunction(
    (r) => window.__cvState.requestId > r && document.querySelectorAll(".group").length >= 12,
    reqAlpha,
    { timeout: 90000 },
  ).catch(() => {});
  const back = await page.evaluate(() => ({
    url: location.search,
    serial: !!window.__cvState.deepSerial,
    tiles: document.querySelectorAll(".group").length,
  }));
  t("toggle→alpha: URL back to sort=alpha&deep=1", /sort=alpha/.test(back.url) && /deep=1/.test(back.url), back.url);
  t("toggle→alpha: banner back to Deep browse", /Deep browse/.test(await banner()), (await banner()).slice(0, 60));
  t("toggle→alpha: serial walker active again", back.serial === true);
  t("toggle→alpha: tiles render again", back.tiles >= 12, `${back.tiles} tiles`);

  // ── 5. Big-page category: no titles= overflow (v1.27.1 regression) ────
  // Files from Google Arts & Culture has 50-member categorymembers pages and
  // ~100-char filenames. Before the fix, the walker drained a whole page into
  // one batch and handed batchInfo 51+ titles → API toomanyvalues → the feed
  // died with "Couldn't load images". Reported 2026-10-02 from live.
  const gacErrors = [];
  const onGacErr = (m) => { if (m.type() === "error" && !/tailwind/i.test(m.text())) gacErrors.push(m.text().slice(0, 140)); };
  page.on("console", onGacErr);
  await page.goto(BASE + "/?sort=alpha&view=det&cat=Category%3AFiles+from+Google+Arts+%26+Culture&deep=1&size=m&type=all&lite=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".group").length >= 12, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const gac = await page.evaluate(() => {
    const titles = window.__cvState.feedPages.map((p) => p.title);
    return {
      tiles: document.querySelectorAll(".group").length,
      unique: new Set(titles).size,
      drawn: titles.length,
      errorShown: !document.getElementById("load-error").classList.contains("hidden"),
      buffered: !!(window.__cvState.deepSerial && Array.isArray(window.__cvState.deepSerial.buffer)),
    };
  });
  const overflow = gacErrors.some((e) => /toomanyvalues/.test(e));
  t("google-arts: walk renders tiles from a 50-member page category", gac.tiles >= 12, `${gac.tiles} tiles`);
  t("google-arts: no titles= overflow (toomanyvalues) in the console", overflow === false, gacErrors[0] || "clean");
  t("google-arts: feed did not die (no load-error banner)", gac.errorShown === false);
  t("google-arts: walker buffers whole pages", gac.buffered === true);
  t("google-arts: no duplicate tiles", gac.drawn > 0 && gac.unique === gac.drawn, `${gac.unique}/${gac.drawn}`);
  page.off("console", onGacErr);

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `deep-serial spec: all ${results.length} assertions pass`;
}
