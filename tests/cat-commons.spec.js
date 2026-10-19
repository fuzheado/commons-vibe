async page => {
  // v1.32 — there was no route from "I'm browsing this category" to the category
  // page on Commons: every outbound link in the app pointed at a FILE. This spec
  // pins the two touchpoints (header ↗ beside the category name + file count, and
  // "↗ Commons" at the end of the breadcrumb trail) and the cases where they must
  // not appear (list feeds, which have no category).
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  const COMMONS = "https://commons.wikimedia.org/wiki/";
  const CAT = "Category:Assessment tagged pages marked as POTY candidates";
  const TRAIL = "&path=Featured_pictures_on_Wikimedia_Commons/Assessment%20tagged%20pages%20marked%20as%20POTY%20candidates";
  const headerLink = () => page.evaluate(() => {
    const a = document.getElementById("cat-commons");
    return {
      shown: getComputedStyle(a).display !== "none",
      href: a.getAttribute("href"),
      title: a.getAttribute("title"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
    };
  });

  // ── 1. The reported case: a deep trail (the header link and the trail link) ──
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "/?sort=shuffle&view=det&cat=Category%3AAssessment+tagged+pages+marked+as+POTY+candidates&size=m&type=all&lite=1" + TRAIL,
    { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);

  const h1 = await headerLink();
  t("header ↗ is visible when browsing a category", h1.shown === true, JSON.stringify(h1));
  t("header ↗ points at the category page on Commons",
    h1.href === COMMONS + "Category%3AAssessment_tagged_pages_marked_as_POTY_candidates", h1.href);
  t("header ↗ opens in a new tab (the feed is never lost)", h1.target === "_blank" && /noopener/.test(h1.rel || ""), `${h1.target} / ${h1.rel}`);
  t("header ↗ names the category in its tooltip", /Assessment tagged pages marked as POTY candidates/.test(h1.title || ""), h1.title);

  const trail = await page.evaluate(() => {
    const a = [...document.querySelectorAll("#crumbs a")].find((x) => /Commons/.test(x.textContent));
    return a ? { text: a.textContent.trim(), href: a.getAttribute("href"), target: a.getAttribute("target"),
                 crumbHidden: document.getElementById("crumbs").classList.contains("hidden") } : null;
  });
  t("breadcrumb trail ends with a Commons link", !!trail, JSON.stringify(trail));
  t("trail link points at the same category page", trail && trail.href === h1.href, trail && trail.href);
  t("trail link is not swallowed by the chip delegation (no data-cat)", await page.evaluate(() =>
    ![...document.querySelectorAll("#crumbs a")].some((a) => /Commons/.test(a.textContent) && a.hasAttribute("data-cat"))));

  // ── 2. It follows navigation, not just the first boot ──────────────────────
  // Chop suey (16 files, 3 subcategories) → click a subcategory chip → the link
  // must describe the NEW category without a reload.
  await page.goto(BASE + "/?cat=Category%3AChop+suey", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#treebar-subs .cat-pill", { timeout: 45000 }).catch(() => {});
  const before = (await headerLink()).href;
  const moved = await page.evaluate(() => {
    const chip = document.querySelector("#treebar-subs .cat-pill[data-cat]");
    if (!chip) return null;
    const target = chip.getAttribute("data-cat");
    chip.click();
    return target;
  });
  await page.waitForTimeout(1500);
  const after = await headerLink();
  // quotePath() keeps "/" literal, so normalize the expectation the same way.
  const expected = moved ? COMMONS + encodeURIComponent(moved.replace(/ /g, "_")).replace(/%2F/gi, "/") : null;
  t("navigating to a subcategory re-points the header ↗", !!moved && after.href === expected && after.href !== before,
    `${moved} -> ${after.href}`);
  const trailAfter = await page.evaluate(() => {
    const a = [...document.querySelectorAll("#crumbs a")].find((x) => /Commons/.test(x.textContent));
    return a ? a.getAttribute("href") : null;
  });
  t("…and the trail link agrees with it", trailAfter === after.href, `${trailAfter} vs ${after.href}`);

  // ── 3. List feeds have no category: no link, no dead href ──────────────────
  await page.goto(BASE + "/?clips=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const listState = await headerLink();
  t("clips list feed: header ↗ hidden", listState.shown === false, JSON.stringify(listState));
  t("clips list feed: no stale href left behind", !listState.href, String(listState.href));

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `cat-commons spec: all ${results.length} assertions pass`;
}
