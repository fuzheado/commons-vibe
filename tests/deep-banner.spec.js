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

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `deep-banner spec: all ${results.length} assertions pass`;
}
