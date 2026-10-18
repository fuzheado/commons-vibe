async page => {
  // TDD spec for the deep-subtree count in the banner (v1.26, issue #31(a);
  // run via `playwright-cli run-code --filename=tests/deep-banner.spec.js`
  // against a local server on :8123).
  //
  // The number comes from CirrusSearch's deepcategory searchinfo.totalhits —
  // ONE call, deduplicated across the subtree (the client walker's per-node
  // counts double-count cross-listed files). Covers: hidden outside deep mode,
  // rendered in deep mode and equal to the live API's totalhits, per-media-type
  // qualification, the zero case, and clearing when deep turns off.
  // Category: Chop Suey (18 files in the subtree, deterministic).
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  const CAT = "Category%3AChop%20Suey";
  const countText = () => page.evaluate(() => document.getElementById("deep-banner-count").textContent);
  // Wait for the banner's probe to SETTLE (a zero now renders blank, so waiting
  // for specific text can never satisfy) — v1.28.2 exposes state.deepCountDone.
  const settled = () => page.waitForFunction(() => !!window.__cvState.deepCountDone, null, { timeout: 45000 }).catch(() => {});
  const totalhits = (type) => page.evaluate(async (type) => {
    const terms = { all: "", image: ' filetype:"bitmap|drawing"', video: " filetype:video" };
    const q = `deepcategory:"Chop Suey"${terms[type] || ""}`;
    const url = "https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srlimit=1&format=json&formatversion=2&origin=*&srsearch=" + encodeURIComponent(q);
    const d = await (await fetch(url)).json();
    return d.query.searchinfo.totalhits;
  }, type);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "/?cat=" + CAT, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 30000 });
  await page.waitForTimeout(800);
  const off = await page.evaluate(() => ({
    hidden: document.getElementById("deep-banner").classList.contains("hidden"),
    count: document.getElementById("deep-banner-count").textContent,
  }));
  t("not deep: banner hidden", off.hidden === true);
  t("not deep: no count text", off.count === "", JSON.stringify(off.count));

  await page.goto(BASE + "/?cat=" + CAT + "&deep=1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 30000 });
  await settled();
  const deepAll = await countText();
  const apiAll = await totalhits("all");
  t("deep: banner visible", !(await page.evaluate(() => document.getElementById("deep-banner").classList.contains("hidden"))));
  t("deep: count rendered as approx", / · ≈[\d,]+ files$/.test(deepAll), JSON.stringify(deepAll));
  t("deep: count equals the live API totalhits", deepAll.includes(apiAll.toLocaleString()), `banner="${deepAll}" api=${apiAll}`);

  await page.selectOption("#type-select", "image");
  await settled();
  const deepImage = await countText();
  t("deep + type=image: number qualifies as images", / · ≈[\d,]+ images$/.test(deepImage), JSON.stringify(deepImage));
  t("deep + type=image: matches the API's filtered totalhits", deepImage.includes((await totalhits("image")).toLocaleString()), deepImage);

  await page.selectOption("#type-select", "video");
  await settled();
  const deepVideo = await countText();
  const apiVideo = await totalhits("video");
  // v1.28.2: a zero is no longer printed at all — the search index lies about
  // container categories and getCatInfo's 7-day cache can hold a stale zero, so
  // the banner only ever prints a count it actually has.
  t("deep + type=video: no count is claimed for a zero", apiVideo === 0 ? deepVideo === "" : /videos$/.test(deepVideo), `banner="${deepVideo}" api=${apiVideo}`);

  await page.locator("#deep-banner-off").click();
  await page.waitForTimeout(600);
  const afterOff = await page.evaluate(() => ({
    hidden: document.getElementById("deep-banner").classList.contains("hidden"),
    count: document.getElementById("deep-banner-count").textContent,
  }));
  t("deep off: banner hidden again", afterOff.hidden === true);
  t("deep off: count cleared", afterOff.count === "", JSON.stringify(afterOff.count));

  // ── 5. Container category: deepcategory answers 0, the walk knows better ──
  // Category:WikiPortraits in New York City in 2026 is a hidden CONTAINER: 0
  // direct files, 5 subcategories. CirrusSearch's deepcategory returns 0 for it
  // (its non-hidden parent returns tens of thousands) while the subtree really
  // holds files — reported 2026-10-03 as the banner saying "· no files".
  await page.goto(BASE + "/?sort=shuffle&view=det&cat=Category%3AWikiPortraits+in+New+York+City+in+2026&deep=1&size=m&type=all", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 60000 }).catch(() => {});
  await settled();
  const container = await countText();
  t("container: deepcategory 0 falls back to the walk's subtree count", / · ≈[\d,]+ files$/.test(container), JSON.stringify(container));
  t("container: never claims 'no files' when the subtree has files", !/no files/.test(container), JSON.stringify(container));
  t("container: the feed still renders", (await page.evaluate(() => document.querySelectorAll(".group").length)) >= 12);

  // ── 6. A direct-count answer is not a subtree count (v1.30) ──────────────
  // Reported 2026-10-18 on Category:2026 high school student movement and
  // blockades in France: deepcategory answered EXACTLY the category's own
  // direct file count (7) because the server-side category graph had not
  // expanded a tree created hours earlier — the feed walked all 923 files
  // while the banner said "≈7". Same lie as the zero case, so it must take the
  // walk too. Stubbed here so the assertion doesn't depend on the index being
  // broken again: Category:Quality images of China really holds 180 direct
  // files and ~1,388 unique in its subtree.
  await page.evaluate(() => localStorage.clear());
  await page.route("**/api.php*", async (route) => {
    const u = route.request().url();
    if (u.includes("list=search") && u.includes("deepcategory")) {
      return route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
        body: JSON.stringify({ batchcomplete: true, query: { searchinfo: { totalhits: 180 }, search: [] } }),
      });
    }
    return route.continue();
  });
  await page.goto(BASE + "/?sort=alpha&view=det&cat=Category%3AQuality+images+of+China&deep=1&size=m&type=all", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 60000 }).catch(() => {});
  await settled();
  const collapsed = await countText();
  const collapsedN = parseInt((((collapsed.match(/≈([\d,]+)/) || [])[1]) || "0").replace(/,/g, ""), 10);
  t("collapsed: a direct-count answer is not printed as the subtree total", collapsedN !== 180, JSON.stringify(collapsed));
  t("collapsed: banner falls back to the walk's subtree count", collapsedN > 300, JSON.stringify(collapsed));
  t("collapsed: the feed still renders", (await page.evaluate(() => document.querySelectorAll(".group").length)) >= 12);
  await page.unroute("**/api.php*");
  await page.evaluate(() => localStorage.clear());

  // Live reproduction of the reported URL: 7 direct files, 923 unique in the
  // subtree (verified by full enumeration 2026-10-18). Assert only that the
  // banner is comfortably larger than the direct count, never the exact value.
  await page.goto(BASE + "/?sort=alpha&view=det&cat=Category%3A2026+high+school+student+movement+and+blockades+in+France&deep=1&size=m&type=all", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 60000 }).catch(() => {});
  await settled();
  const reported = await countText();
  const reportedN = parseInt((((reported.match(/≈([\d,]+)/) || [])[1]) || "0").replace(/,/g, ""), 10);
  t("reported category: banner is not the 7-file direct count", reportedN !== 7 && reportedN > 500, JSON.stringify(reported));
  await page.evaluate(() => localStorage.clear());

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `deep-banner spec: all ${results.length} assertions pass`;
}
