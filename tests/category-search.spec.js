async page => {
  // TDD spec for the category type-ahead combobox (prototype).
  //   playwright-cli run-code --filename=tests/category-search.spec.js
  // against a local server on :8123 (see tests/run.sh for preconditions).
  //
  // What this guards:
  //   1. the input must not query per keystroke (debounce + minlength)
  //   2. suggestions must be enriched with file/subcat counts
  //   3. CASE TWINS must be visible — typing "chop suey" has to surface BOTH
  //      Category:Chop suey (the dish) and Category:Chop Suey (the Hopper
  //      painting). Prefix-only search hides the second one entirely, which is
  //      how the v1.14.1 wrong-case trap works at the INPUT stage.
  //   4. selecting a suggestion must insert the API's canonical title
  //   5. the old Enter-to-navigate path must still work when nothing is picked
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
  const FEED = "/?cat=Category%3AFeatured_pictures_on_Wikimedia_Commons";

  const rows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#search-suggest .cat-suggest-row")].map((r) => ({
        title: r.getAttribute("data-title"),
        name: r.querySelector(".cat-suggest-name").textContent,
        meta: r.querySelector(".cat-suggest-meta").textContent,
        selected: r.getAttribute("aria-selected") === "true",
      })),
    );
  const boxOpen = () => page.evaluate(() => !document.getElementById("search-suggest").classList.contains("hidden"));
  const aria = () => page.evaluate(() => ({
    expanded: document.getElementById("search-input").getAttribute("aria-expanded"),
    role: document.getElementById("search-input").getAttribute("role"),
    active: document.getElementById("search-input").getAttribute("aria-activedescendant"),
  }));
  // Suggestion-specific requests only (the feed's own api.php calls don't carry these).
  const suggestReqs = () =>
    page.evaluate(() =>
      performance.getEntriesByType("resource").filter((r) => /pssearch=|srsearch=/.test(r.name)).length,
    );
  const typeInto = async (text) => {
    await page.click("#search-input");
    await page.keyboard.type(text, { delay: 25 });
  };
  const waitSuggestions = async (timeout = 25000) => {
    await page.waitForFunction(
      () => document.querySelectorAll("#search-suggest .cat-suggest-row").length > 0,
      null,
      { timeout },
    );
    // counts arrive in a second paint (batched categoryinfo) — wait for one row to have meta
    await page.waitForFunction(
      () => [...document.querySelectorAll("#search-suggest .cat-suggest-meta")].some((m) => m.textContent.trim()),
      null,
      { timeout },
    ).catch(() => {});
  };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.context().unrouteAll();

  // ── 1. minlength: a single character must not query ──────────────────────
  await step("a single character fires no request and shows no list", async () => {
    await page.goto(BASE + FEED + "&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    const before = await suggestReqs();
    await typeInto("c");
    await page.waitForTimeout(1200);
    const after = await suggestReqs();
    t("no suggestion request for 1 character", after === before, `${before} → ${after}`);
    t("list stays hidden below minlength", (await boxOpen()) === false);
    await page.fill("#search-input", "");
  });

  // ── 2. debounce: a burst of keystrokes collapses into one settled query ──
  await step("typing a burst collapses into one query (no per-keystroke calls)", async () => {
    await page.goto(BASE + FEED + "&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    const before = await suggestReqs();
    await typeInto("hopper painting"); // 15 keystrokes at 25 ms
    await page.waitForTimeout(2500);
    const after = await suggestReqs();
    const fired = after - before;
    t("15 keystrokes fired at most 3 suggestion requests", fired <= 3, `${fired} request(s), 2 expected (prefix + fuzzy)`);
    t("suggestions still rendered", (await rows()).length >= 1);
  });

  // ── 3. fuzzy tier finds intent that prefix search cannot ────────────────
  await step("fuzzy tier resolves intent ('hopper painting')", async () => {
    const list = await rows();
    const hopper = list.filter((r) => /hopper/i.test(r.name));
    t("a Hopper category is suggested for 'hopper painting'", hopper.length >= 1, hopper.map((h) => h.name).slice(0, 3).join(" | "));
  });

  // ── 4. counts enrichment + container flagging ───────────────────────────
  await step("suggestions carry file/subcat counts", async () => {
    await page.fill("#search-input", "");
    await typeInto("Featured pictures");
    await waitSuggestions();
    const list = await rows();
    const withCounts = list.filter((r) => /\d+\s+(files?|subcats?)/.test(r.meta));
    t("rows are enriched with counts", withCounts.length >= 1, `${withCounts.length}/${list.length} rows have counts`);
    const containers = list.filter((r) => /no files/.test(r.meta));
    t("container categories are flagged as having no files", containers.length >= 1, containers[0] ? containers[0].meta : "none flagged");
    t("container flag suggests Deep mode", containers.some((c) => /Deep/.test(c.meta)) || containers.length === 0);
  });

  // ── 5. THE case-twin win ────────────────────────────────────────────────
  await step("'chop suey' surfaces BOTH case twins (the v1.14.1 input trap)", async () => {
    await page.goto(BASE + FEED + "&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    await typeInto("chop suey");
    await waitSuggestions();
    const list = await rows();
    const titles = list.map((r) => r.title);
    t("Category:Chop suey (the dish) is offered", titles.includes("Category:Chop suey"));
    t("Category:Chop Suey (the Hopper painting) is offered", titles.includes("Category:Chop Suey"), titles.slice(0, 6).join(" | "));
    const dish = list.find((r) => r.title === "Category:Chop suey");
    const painting = list.find((r) => r.title === "Category:Chop Suey");
    t("both twins show counts so they can be told apart",
      !!dish && !!painting && /files?/.test(dish.meta) && /files?/.test(painting.meta),
      `dish: ${dish && dish.meta} | painting: ${painting && painting.meta}`);
  });

  // ── 6. canonical title insertion (selection) ───────────────────────────
  await step("picking a suggestion inserts the canonical title", async () => {
    const list = await rows();
    const idx = list.findIndex((r) => r.title === "Category:Chop Suey");
    t("painting twin is in the list to pick", idx >= 0);
    await page.evaluate((i) => {
      document.querySelectorAll("#search-suggest .cat-suggest-row")[i]
        .dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    }, idx);
    await page.waitForTimeout(1200);
    const cat = await page.evaluate(() => new URLSearchParams(location.search).get("cat"));
    t("URL carries the exact canonical title", cat === "Category:Chop Suey", String(cat));
    t("selection closed the list", (await boxOpen()) === false);
    t("input was cleared", (await page.inputValue("#search-input")) === "");
    await page.waitForSelector(".group", { timeout: 60000 });
    t("feed loaded for the canonical title", (await page.evaluate(() => document.querySelectorAll(".group").length)) > 0);
  });

  // ── 7. keyboard: arrows move, Enter selects ─────────────────────────────
  await step("arrow keys move the active option and Enter picks it", async () => {
    await page.goto(BASE + FEED + "&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    await typeInto("stl files");
    await waitSuggestions();
    let a = await aria();
    t("input is a combobox with aria-expanded=true", a.role === "combobox" && a.expanded === "true", `${a.role}/${a.expanded}`);
    t("nothing is selected before arrowing", (await rows()).every((r) => !r.selected));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    let list = await rows();
    t("ArrowDown selects the first row", list[0].selected === true);
    a = await aria();
    t("aria-activedescendant tracks the active row", a.active === "cat-opt-0", String(a.active));
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(150);
    list = await rows();
    t("ArrowDown again moves to the second row", list[1].selected === true && list[0].selected === false);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    list = await rows();
    t("ArrowUp moves back", list[0].selected === true);
    const target = list[0].title;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    const cat = await page.evaluate(() => new URLSearchParams(location.search).get("cat"));
    t("Enter navigated to the active suggestion", cat === target, `${cat} vs ${target}`);
  });

  // ── 8. Escape closes without navigating ────────────────────────────────
  await step("Escape closes the list and leaves the feed alone", async () => {
    await page.goto(BASE + FEED + "&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    await typeInto("pictures of the year");
    await waitSuggestions();
    const catBefore = await page.evaluate(() => new URLSearchParams(location.search).get("cat"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    t("Escape hid the list", (await boxOpen()) === false);
    t("Escape did not navigate", (await page.evaluate(() => new URLSearchParams(location.search).get("cat"))) === catBefore);
    t("aria-expanded is false after close", (await aria()).expanded === "false");
  });

  // ── 9. the old path still works: Enter with nothing picked ─────────────
  await step("Enter with no selection keeps the exact-match behaviour", async () => {
    await page.goto(BASE + FEED + "&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    await page.fill("#search-input", "Category:Pictures of the Year");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    const cat = await page.evaluate(() => new URLSearchParams(location.search).get("cat"));
    t("exact typed title still navigates", /Pictures of the Year/.test(String(cat)), String(cat));
  });

  // ── 10. cache: repeating a query costs no new request ──────────────────
  await step("a repeated query is served from cache", async () => {
    await page.goto(BASE + FEED + "&_=" + Date.now());
    await page.waitForSelector(".group", { timeout: 90000 });
    await typeInto("hopper painting");
    await waitSuggestions();
    const before = await suggestReqs();
    await page.fill("#search-input", "");
    await typeInto("hopper painting");
    await page.waitForTimeout(2200);
    const after = await suggestReqs();
    t("repeat query fired no new suggestion request", after === before, `${before} → ${after}`);
  });

  const passed = results.filter((r) => r.startsWith("PASS")).length;
  const summary = `Category-search spec: ${passed} passed, ${failed} failed\n${results.join("\n")}`;
  console.log(summary);
  if (failed > 0) throw new Error(summary);
  return summary;
}
