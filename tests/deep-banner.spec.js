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
  await page.waitForFunction(
    () => /·/.test(document.getElementById("deep-banner-count").textContent),
    null,
    { timeout: 30000 },
  );
  const deepAll = await countText();
  const apiAll = await totalhits("all");
  t("deep: banner visible", !(await page.evaluate(() => document.getElementById("deep-banner").classList.contains("hidden"))));
  t("deep: count rendered as approx", / · ≈[\d,]+ files$/.test(deepAll), JSON.stringify(deepAll));
  t("deep: count equals the live API totalhits", deepAll.includes(apiAll.toLocaleString()), `banner="${deepAll}" api=${apiAll}`);

  await page.selectOption("#type-select", "image");
  await page.waitForFunction(
    () => /images/.test(document.getElementById("deep-banner-count").textContent),
    null,
    { timeout: 30000 },
  );
  const deepImage = await countText();
  t("deep + type=image: number qualifies as images", / · ≈[\d,]+ images$/.test(deepImage), JSON.stringify(deepImage));
  t("deep + type=image: matches the API's filtered totalhits", deepImage.includes((await totalhits("image")).toLocaleString()), deepImage);

  await page.selectOption("#type-select", "video");
  await page.waitForFunction(
    () => /no videos|videos/.test(document.getElementById("deep-banner-count").textContent),
    null,
    { timeout: 30000 },
  );
  const deepVideo = await countText();
  const apiVideo = await totalhits("video");
  t("deep + type=video: zero renders as 'no videos'", apiVideo === 0 ? deepVideo === " · no videos" : /videos$/.test(deepVideo), `banner="${deepVideo}" api=${apiVideo}`);

  await page.locator("#deep-banner-off").click();
  await page.waitForTimeout(600);
  const afterOff = await page.evaluate(() => ({
    hidden: document.getElementById("deep-banner").classList.contains("hidden"),
    count: document.getElementById("deep-banner-count").textContent,
  }));
  t("deep off: banner hidden again", afterOff.hidden === true);
  t("deep off: count cleared", afterOff.count === "", JSON.stringify(afterOff.count));

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `deep-banner spec: all ${results.length} assertions pass`;
}
