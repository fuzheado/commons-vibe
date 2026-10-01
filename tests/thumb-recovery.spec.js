async page => {
  // TDD spec for broken-thumbnail recovery (v1.16).
  //   playwright-cli run-code --filename=tests/thumb-recovery.spec.js
  // against a local server on :8123.
  //
  // Live report: shuffle/alpha tiles occasionally rendered as empty boxes with a
  // broken-image glyph. Root cause (verified in Chromium 2026-10-01): when the
  // CHOSEN srcset candidate fails, the browser does NOT fall back to `src` —
  // aborting every 960px request broke 12/12 tiles whose 500px src was fine. The
  // app had no error handler on the plain-image tile, so a single bad request
  // meant an empty tile until a page reload — unacceptable in shuffle mode, where
  // a reload discards the drawn set.
  //
  // The fix, asserted here: (1) recover in place — drop srcset, refetch the 1x
  // thumb with a cache-buster, then back off; (2) never declare the API's
  // original-file `responsiveUrls["2"]` in a srcset; (3) a "Fix images" button
  // that appears only when tiles stay dead and re-resolves their titles; (4)
  // `?cat=` without its namespace gets the `Category:` prefix.
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const step = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      results.push(`FAIL  ${name} — ${(e.message || e).split("\n")[0]}`);
      failed++;
    }
  };
  const BASE = "http://127.0.0.1:8123";
  const SMALL = `${BASE}/?cat=Category%3AChop%20Suey&sort=alpha&view=det&size=m`;
  const THUMB_RE = /(thumb|upload)\.wikimedia\.org/;

  const snapshot = () => page.evaluate(() => {
    const imgs = [...document.querySelectorAll(".media-container img")];
    const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0);
    return {
      tiles: imgs.length,
      broken: broken.length,
      retried: imgs.filter((i) => /thumbretry=/.test(i.currentSrc || "")).length,
      dead: document.querySelectorAll(".media-container.thumb-dead").length,
      btnVisible: (() => {
        const b = document.getElementById("fix-thumbs-btn");
        if (!b) return null;
        return { shown: b.classList.contains("show"), count: (document.getElementById("fix-thumbs-count") || {}).textContent };
      })(),
      missingOneX: imgs.filter((i) => !i.dataset.srcOne).length,
      nonThumbCandidates: imgs.flatMap((i) => (i.getAttribute("srcset") || "").split(","))
        .map((s) => s.trim().split(/\s+/)[0]).filter((u) => u && (!u.includes("/thumb/") || Number((/\/\d+px-/.exec(u) || [0, 9999])[1]) > 1280)).length,
    };
  });

  // ---------- 1. static guards on the srcset filter (no network) ----------
  await step("unit: srcset filter", async () => {
    await page.goto(SMALL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => !!window.__cvThumb, null, { timeout: 30000 });
    const u = await page.evaluate(() => {
      const { srcsetFor, cleanThumbCandidate } = window.__cvThumb;
      const ORIG = "https://upload.wikimedia.org/wikipedia/commons/9/98/Example.jpg";
      const THUMB960 = "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/98/Example.jpg/960px-Example.jpg";
      const THUMB1280 = "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/98/Example.jpg/1280px-Example.jpg";
      const THUMB1920 = "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/98/Example.jpg/1920px-Example.jpg";
      return {
        dropsOriginal: cleanThumbCandidate(ORIG) === "",
        dropsOversize: cleanThumbCandidate(THUMB1920) === "",
        keepsBucket: cleanThumbCandidate(THUMB960) === THUMB960,
        withOriginal: srcsetFor(THUMB960, 300, { 2: ORIG }),
        withBucket: srcsetFor(THUMB960, 300, { 2: THUMB1280 }),
        singleBucketSrcset: srcsetFor(THUMB960, 300, { 2: THUMB960 }).srcset,
      };
    });
    t("unit: original-file responsiveUrls rejected", u.dropsOriginal);
    t("unit: >1280px bucket rejected", u.dropsOversize);
    t("unit: standard /thumb/ bucket kept", u.keepsBucket);
    t("unit: srcset never declares the original", u.withOriginal.srcset.split(",").length === 1 && !u.withOriginal.srcset.includes("upload.wikimedia.org"),
      u.withOriginal.srcset.slice(0, 90));
    t("unit: 1x thumbnail exposed for the fallback ladder", /\/960px-/.test(u.withOriginal.base || ""), u.withOriginal.base);
    t("unit: good bucket kept as 2x", u.withBucket.srcset.split(",").length === 2, u.withBucket.srcset.split(",").length + " candidate(s)");
    t("unit: duplicate bucket not repeated", u.singleBucketSrcset.split(",").length === 1);
  });

  // ---------- 2. transient failure heals in place, without a reload ----------
  await step("live: in-place recovery", async () => {
    const ctx = page.context();
    let aborted = 0;
    const seen = new Set();
    await ctx.route(THUMB_RE, (route) => {
      const url = route.request().url();
      // fail each tile's FIRST attempt only — the shape of a transient hiccup
      if (!/thumbretry=/.test(url) && !seen.has(url)) { seen.add(url); aborted++; return route.abort("failed"); }
      return route.continue();
    });
    try {
      await page.goto(SMALL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.evaluate(() => { window.__cvNoReload = true; });
      await page.waitForFunction(() => document.querySelectorAll(".media-container img").length > 0, null, { timeout: 60000 });
      await page.waitForFunction(() => {
        const imgs = [...document.querySelectorAll(".media-container img")];
        return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
      }, null, { timeout: 45000 });
      const s = await snapshot();
      const alive = await page.evaluate(() => window.__cvNoReload === true);
      t("live: a tile request was actually failed", aborted > 0, `${aborted} aborted`);
      t("live: every tile recovered", s.broken === 0, `${s.broken} still broken of ${s.tiles}`);
      t("live: recovery used a cache-busted retry URL", s.retried >= 1, `${s.retried} tile(s) on a retry URL`);
      t("live: no page reload (feed/session preserved)", alive);
    } finally {
      await ctx.unroute(THUMB_RE);
    }
  });

  // ---------- 3. persistent failure raises the button, which fixes it ----------
  await step("live: dead state + Fix images button", async () => {
    const ctx = page.context();
    await ctx.route(THUMB_RE, (route) => route.abort("failed"));
    try {
      await page.goto(SMALL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(() => document.querySelectorAll(".media-container.thumb-dead").length > 0, null, { timeout: 45000 });
      const dead = await snapshot();
      t("dead: tiles marked after the retry ladder", dead.dead > 0, `${dead.dead} tile(s) dead`);
      t("dead: Fix images button visible", dead.btnVisible && dead.btnVisible.shown === true, JSON.stringify(dead.btnVisible));
      t("dead: button shows the dead count", dead.btnVisible && dead.btnVisible.count === String(dead.dead), JSON.stringify(dead.btnVisible));
    } finally {
      await ctx.unroute(THUMB_RE);
    }
    // heal the network, then use the button — this is the "prod button" path
    await page.click("#fix-thumbs-btn");
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll(".media-container img")];
      return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    }, null, { timeout: 45000 });
    const after = await snapshot();
    t("button: all tiles restored after clicking Fix images", after.broken === 0 && after.dead === 0, `${after.broken} broken, ${after.dead} dead`);
    t("button: button hides when nothing is broken", after.btnVisible && after.btnVisible.shown === false);
  });

  // ---------- 4. ?cat= without a namespace still renders (prefix normalized) ----------
  await step("live: bare ?cat= gets the Category: prefix", async () => {
    await page.goto(`${BASE}/?cat=Chop%20Suey&sort=alpha&view=det&size=m`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll(".media-container img").length > 0, null, { timeout: 60000 });
    const s = await snapshot();
    t("live: bare cat= renders tiles", s.tiles > 0, `${s.tiles} tile(s)`);
    t("live: every tile carries data-src-1x", s.missingOneX === 0, `${s.missingOneX} missing`);
    t("live: no original/oversize srcset candidate rendered", s.nonThumbCandidates === 0, `${s.nonThumbCandidates} bad candidate(s)`);
  });

  // Throw on failure like every other spec. This one used to RETURN the failure
  // counts instead of throwing, so even with a correct gate there was no
  // "### Error" line to detect and a broken run scored as a pass.
  const passed = results.filter((r) => r.startsWith("PASS")).length;
  const summary = `Thumb-recovery spec: ${passed} passed, ${failed} failed\n${results.join("\n")}`;
  console.log(summary);
  if (failed > 0) throw new Error(summary);
  return { passed, failed, results };
}
