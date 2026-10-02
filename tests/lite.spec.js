async page => {
  // TDD spec for lite mode (v1.20; run via
  //   playwright-cli run-code --filename=tests/lite.spec.js
  // against a local server on :8123).
  //
  // Lite = speed over quality: feed tiles fetch ONE 1x thumb — no retina (2×)
  // candidates in srcset, and the base thumb is the smallest ladder bucket ≥
  // the slot width (330px at M density/1280 viewport). Full mode is untouched
  // (480 request → 500px bucket + 960w 2× candidate). The viewer always stays
  // high-res (skim in lite, inspect in full).
  //
  // Precedence asserted: URL param lite=1 / lite=0 > localStorage vibe_lite > off.
  // Category: Chop Suey (2 files, deterministic; the Hopper painting has a
  // verified 960px responsiveUrls["2"] candidate, so the 960w assertions bite).
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  const TILE_URL = BASE + "/?cat=Category%3AChop%20Suey";
  await page.setViewportSize({ width: 1280, height: 720 }); // M density → 4 cols → slot ~294px → lite bucket 330

  const waitTiles = () =>
    page.waitForFunction(() => document.querySelectorAll(".group img.thumb-img, .group .media-container img").length >= 1, null, { timeout: 30000 });

  const tileFacts = () => page.evaluate(() => {
    const img = document.querySelector(".group .media-container img");
    return {
      src: img ? img.src : "",
      srcset: img ? img.getAttribute("srcset") || "" : "",
      liteBtn: (() => { const b = document.getElementById("lite-btn"); return { emerald: b.classList.contains("bg-emerald-600"), title: b.title }; })(),
      url: location.search,
    };
  });

  // Fresh storage so runs are order-independent.
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  // ── 1. Full mode (default): 500px base + retina candidate ─────────────
  await page.goto(TILE_URL, { waitUntil: "domcontentloaded" });
  await waitTiles();
  let f = await tileFacts();
  t("full mode: base thumb is the 500px bucket", f.src.includes("/500px-"), f.src.slice(-70));
  t("full mode: srcset declares the 960w retina candidate", /960w/.test(f.srcset), f.srcset.slice(0, 120));
  t("full mode: lite chip off", !f.liteBtn.emerald);

  // ── 2. UI toggle: lite ON → 330px base, no retina candidates ──────────
  await page.locator("#lite-btn").click();
  await page.waitForFunction(
    () => [...document.querySelectorAll(".group .media-container img")].some((i) => i.src.includes("/330px-")),
    null,
    { timeout: 30000 },
  );
  f = await tileFacts();
  t("lite ON via chip: URL gains lite=1", f.url.includes("lite=1"), f.url);
  t("lite ON via chip: chip turns emerald", f.liteBtn.emerald);
  t("lite ON via chip: base thumb is the 330px bucket", f.src.includes("/330px-"), f.src.slice(-70));
  t("lite ON via chip: srcset has NO 960w candidate", !/960w/.test(f.srcset), f.srcset);
  const stored = await page.evaluate(() => localStorage.getItem("vibe_lite"));
  t("lite ON via chip: preference persisted", stored === "1", `vibe_lite=${stored}`);

  // Toggle back off restores full quality.
  await page.locator("#lite-btn").click();
  await page.waitForFunction(
    () => [...document.querySelectorAll(".group .media-container img")].some((i) => i.src.includes("/500px-")),
    null,
    { timeout: 30000 },
  );
  f = await tileFacts();
  t("lite OFF via chip: 500px bucket returns", f.src.includes("/500px-"), f.src.slice(-70));
  t("lite OFF via chip: URL drops lite=1", !f.url.includes("lite=1"), f.url);

  // ── 3. ?lite=1 boots directly into lite ───────────────────────────────
  await page.goto(TILE_URL + "&lite=1", { waitUntil: "domcontentloaded" });
  await waitTiles();
  f = await tileFacts();
  t("?lite=1 boot: chip on", f.liteBtn.emerald);
  t("?lite=1 boot: 330px thumbs, no 960w", f.src.includes("/330px-") && !/960w/.test(f.srcset), f.src.slice(-70));

  // ── 4. Per-device persistence: stored pref applies without the param ──
  await page.evaluate(() => localStorage.setItem("vibe_lite", "1"));
  await page.goto(TILE_URL, { waitUntil: "domcontentloaded" });
  await waitTiles();
  f = await tileFacts();
  t("stored pref: no param → still lite", f.src.includes("/330px-") && f.liteBtn.emerald, f.src.slice(-70));

  // ── 5. ?lite=0 explicitly overrides the stored pref ───────────────────
  await page.goto(TILE_URL + "&lite=0", { waitUntil: "domcontentloaded" });
  await waitTiles();
  f = await tileFacts();
  t("?lite=0 override: full quality back", f.src.includes("/500px-") && !f.liteBtn.emerald, f.src.slice(-70));

  // ── 6. Viewer stays high-res in lite ──────────────────────────────────
  await page.goto(TILE_URL + "&lite=1", { waitUntil: "domcontentloaded" });
  await waitTiles();
  await page.locator(".group a.media-link").first().click();
  await page.waitForSelector("#viewer-media img", { timeout: 30000 });
  const vsrc = await page.evaluate(() => document.querySelector("#viewer-media img").src);
  t("viewer in lite: NOT 330px (stays 1920px bucket)", vsrc.includes("/1920px-") && !vsrc.includes("/330px-"), vsrc.slice(-70));
  await page.keyboard.press("Escape");

  // ── 7. Toggle in shuffle mode preserves the drawn set + order ─────────
  // The v1.20 toggle ran resetAndFetch — every lite flip reshuffled the feed.
  // It must redraw the SAME tiles in the SAME order instead (in-place redraw).
  // Quiescence first: captures are only valid when no fill-up batch is in
  // flight or landing (a sentinel batch between samples is a false diff).
  // Poll until the tile count stops changing.
  const settleFeed = async () => {
    await page.waitForFunction(
      () => document.getElementById("loading-spinner").classList.contains("hidden"),
      null,
      { timeout: 30000 },
    ).catch(() => {});
    let prev = -1;
    for (let i = 0; i < 20; i++) {
      const n = await page.evaluate(() => document.querySelectorAll(".group").length);
      if (n === prev && n > 0) return n;
      prev = n;
      await page.waitForTimeout(700);
    }
    return prev;
  };
  await page.evaluate(() => localStorage.setItem("vibe_lite", "0")); // start full
  await page.goto(BASE + "/?cat=Category%3AImages%2520from%2520Wiki%2520Loves%2520Monuments%25202026%2520in%2520China&sort=shuffle".replaceAll("%2520", "%20"), { waitUntil: "domcontentloaded" });
  // Visual order is what the user perceives: masonry scatters fetch order
  // across columns, so DOM/document order is NOT the on-screen order. Sort by
  // (y, x) and compare THAT across the toggle.
  const visualOrder = () => page.evaluate(() =>
    [...document.querySelectorAll(".group")].map((c) => {
      const r = c.getBoundingClientRect();
      return { t: c.dataset.file, x: Math.round(r.left), y: Math.round(r.top + window.scrollY) };
    }).sort((a, b) => a.y - b.y || a.x - b.x).map((o) => o.t));
  await page.waitForFunction(() => document.querySelectorAll(".group .media-container img").length >= 12, null, { timeout: 60000 });
  const nBefore = await settleFeed();
  await page.waitForTimeout(1500); // let images paint so positions are final
  await page.evaluate(() => { window.__cvNoReload = true; });
  const orderBefore = await visualOrder();
  t("shuffle: 12+ tiles drawn", orderBefore.length >= 12 && orderBefore.length === nBefore, `${orderBefore.length} tiles (stable at ${nBefore})`);

  await page.locator("#lite-btn").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".group .media-container img").length > 0 && [...document.querySelectorAll(".group .media-container img")].every((i) => i.src.includes("/330px-")),
    null,
    { timeout: 30000 },
  );
  await settleFeed();
  await page.waitForTimeout(1500);
  const orderLite = await visualOrder();
  const diffLite = orderBefore.findIndex((t, i) => t !== orderLite[i]);
  t("shuffle→lite: SAME tiles, SAME visual order", diffLite === -1,
    `first diff at ${diffLite}: ${JSON.stringify((orderBefore[diffLite] || "").slice(5, 40))} → ${JSON.stringify((orderLite[diffLite] || "").slice(5, 40))} (${orderLite.length} vs ${orderBefore.length} tiles)`);
  t("shuffle→lite: thumbs are 330px", (await page.evaluate(() => document.querySelector(".group .media-container img").src)).includes("/330px-"));
  t("shuffle→lite: no page reload", await page.evaluate(() => window.__cvNoReload === true));
  t("shuffle→lite: URL carries lite=1", page.url().includes("lite=1"), page.url());

  await page.locator("#lite-btn").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".group .media-container img").length > 0 && [...document.querySelectorAll(".group .media-container img")].every((i) => i.src.includes("/500px-")),
    null,
    { timeout: 30000 },
  );
  await settleFeed();
  await page.waitForTimeout(1500);
  const orderFull = await visualOrder();
  const diffFull = orderBefore.findIndex((t, i) => t !== orderFull[i]);
  t("lite→shuffle: SAME tiles, SAME visual order again", diffFull === -1,
    `first diff at ${diffFull}: ${JSON.stringify((orderBefore[diffFull] || "").slice(5, 40))} → ${JSON.stringify((orderFull[diffFull] || "").slice(5, 40))} (${orderFull.length} vs ${orderBefore.length} tiles)`);
  t("lite→shuffle: retina candidate returns", await page.evaluate(() => /960w/.test(document.querySelector(".group .media-container img").getAttribute("srcset") || "")));

  // Cleanup so other specs start full-quality.
  await page.evaluate(() => localStorage.removeItem("vibe_lite"));

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `lite spec: all ${results.length} assertions pass`;
}
