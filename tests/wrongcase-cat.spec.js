async page => {
  // TDD spec for the case-exact category guard (issue #17 follow-up; run via
  //   playwright-cli run-code --filename=tests/wrongcase-cat.spec.js
  // against a local server on :8123).
  //
  // Live report: a shuffle/deep feed for Category:Chop Suey (the Edward Hopper
  // 1929 painting) was ALSO showing food photos from the case-doppelgänger
  // Category:Chop suey (the dish). CirrusSearch incategory:/deepcategory:
  // match category titles case-insensitively, while Commons treats the two as
  // DISTINCT categories. The fix verifies each drawn file's OWN category list
  // (exact title) before rendering and drops members of the wrong-case twin.
  //
  // Assertion strategy (robust to Commons data churn): the app draws the whole
  // case-insensitive envelope, so any file it wrongly renders would carry a
  // "Category:Chop suey" pill WITHOUT a "Category:Chop Suey" pill. The painting
  // files carry "Category:Chop Suey". So: every rendered drawer that mentions
  // "Category:Chop suey" must also mention "Category:Chop Suey"; at least one
  // tile must carry the painting pill; and the feed must EXHAUST ("End of
  // Collection") rather than loop the twin's ~16 food files forever.
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

  // Read every rendered tile's drawer pills (pills are always in the DOM, just
  // translated off-screen, so no clicks needed) + its Commons file title.
  const snapshot = () => page.evaluate(() => {
    const cards = [...document.querySelectorAll(".group")].map((card) => ({
      pills: [...card.querySelectorAll(".category-drawer .cat-pill")].map((p) => p.getAttribute("data-cat")),
      title: decodeURIComponent(((card.querySelector("a.media-link") || {}).href || "").split("/wiki/")[1] || ""),
    }));
    return {
      cards,
      paintingPill: cards.filter((c) => c.pills.includes("Category:Chop Suey")).length,
      foodWithoutPainting: cards.filter((c) => c.pills.includes("Category:Chop suey") && !c.pills.includes("Category:Chop Suey")).length,
    };
  });
  const waitEnd = () =>
    page.waitForFunction(
      () => !document.getElementById("end-message").classList.contains("hidden"),
      null,
      { timeout: 120000 },
    ).catch(() => {});

  // Shared assertions for either mode.
  const assertClean = async (label) => {
    const s = await snapshot();
    t(`${label}: painting tiles rendered`, s.paintingPill >= 1, `${s.paintingPill} tile(s) with Category:Chop Suey`);
    t(`${label}: no food-only tiles (wrong-case leak fixed)`, s.foodWithoutPainting === 0,
      `${s.foodWithoutPainting} tile(s) with Category:Chop suey but not Category:Chop Suey`);
    const allPaintings = s.cards.every((c) => c.pills.includes("Category:Chop Suey"));
    t(`${label}: every tile is really in the painting category`, allPaintings);
    const end = await page.evaluate(() => !document.getElementById("end-message").classList.contains("hidden"));
    t(`${label}: feed exhausted (did not loop the food twin)`, end);
  };

  await page.setViewportSize({ width: 1280, height: 720 });

  // Phase 1 — plain shuffle (the simpler leak path; always case-filtered).
  await step("shuffle: Category:Chop Suey renders only painting files, then ends", async () => {
    await page.goto(BASE + "/?sort=shuffle&cat=Category%3AChop%20Suey&size=m&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    await waitEnd();
    await assertClean("shuffle");
  });

  // Phase 2 — the user's exact repro: deep mode. The shuffle phase already
  // primed the API/localStorage caches, so the subtree walk resolves almost
  // instantly and the post-walk case-filtered pipeline is deterministic.
  await step("deep: Category:Chop Suey (plus subtree) renders only painting files, then ends", async () => {
    await page.goto(BASE + "/?sort=shuffle&view=min&cat=Category%3AChop%20Suey&deep=1&size=m&type=all" +
      "&path=Paintings%20by%20Edward%20Hopper/Chop%20Suey&_=" + Date.now());
    try {
      await page.waitForSelector(".group", { timeout: 90000 });
    } catch {
      t("deep: tiles rendered", false, "no .group appeared (cold deepcategory-zero / walk)");
      return;
    }
    await waitEnd();
    await assertClean("deep");
  });

  const passed = results.filter((r) => r.startsWith("PASS")).length;
  const summary = `Wrong-case-cat spec: ${passed} passed, ${failed} failed\n${results.join("\n")}`;
  console.log(summary);
  if (failed > 0) throw new Error(summary);
  return summary;
}