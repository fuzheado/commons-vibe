async page => {
  // TDD spec for Lists v1.28 (LISTS-DESIGN.md §5): entering list references in the
  // Jump box, saved lists in the source menu, the list-editor lines, PagePile
  // creation from the export dialog, and the four list invariants that used to
  // leak category state (deep, path/crumbs, tree browser, alert()).
  //   playwright-cli run-code --filename=tests/lists.spec.js
  // Requires the local server on :8123.
  //
  // Fixture: PagePile 116948 (static, commonswiki, 2 files). Creation is tested
  // against the live API and DOES leave one small pile per run — deliberate, so
  // the publish path is covered end to end.
  const PILE = "116948";
  const BASE = "http://127.0.0.1:8123";
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const state = () => page.evaluate(() => ({
    url: location.search,
    tiles: document.querySelectorAll(".group").length,
    listSource: window.__cvState.list && window.__cvState.list.source,
    listTitles: window.__cvState.list ? window.__cvState.list.titles.length : null,
    deepMode: window.__cvState.deepMode,
    pathLen: window.__cvState.path.length,
    cfg: window.__cvState.config || "",
  }));
  const vis = (id) => page.evaluate((id) => {
    const el = document.getElementById(id);
    return !el ? "missing" : el.classList.contains("hidden") ? "hidden" : "VISIBLE";
  }, id);
  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll("#search-suggest .cat-suggest-row")].map((r) => r.textContent.replace(/\s+/g, " ").trim()));

  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); }); // a stray alert() must never block the spec — and must be countable
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);

  // ── 1. Jump-box entry (LISTS-DESIGN.md §1.1) ─────────────────────────────
  await page.fill("#search-input", "pile:" + PILE);
  await page.waitForTimeout(900);
  const row = (await rows())[0] || "";
  t("entry: prefixed pile shows an actionable row", /Open PagePile 116948 as a feed/.test(row), row);
  t("entry: row carries the pile's file count", /2 files/.test(row), row);

  await page.fill("#search-input", PILE);
  await page.waitForTimeout(900);
  const hint = (await rows())[0] || "";
  t("entry: a bare number is NOT a list — hint row instead", /Numeric IDs need a prefix/.test(hint), hint);

  await page.fill("#search-input", "https://pagepile.toolforge.org/api.php?id=" + PILE + "&action=get_data&format=html");
  await page.waitForTimeout(900);
  t("entry: pasted PagePile URL is recognised", /Open PagePile 116948/.test((await rows())[0] || ""), (await rows())[0] || "");

  // ── 2. Opening it: feed, URL, menu, invariants ───────────────────────────
  await page.fill("#search-input", "pile:" + PILE);
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  // Wait for THIS list's feed. A bare `.group >= 2` would already be satisfied by
  // the previous feed's tiles (the landing page renders some) and return instantly,
  // so the assertion below could run mid-load — that produced a false in-suite
  // failure on 2026-10-03.
  await page.waitForFunction(
    () => window.__cvState.list && window.__cvState.list.source === "pile" && window.__cvState.list.titles.length === 2 && document.querySelectorAll(".group").length >= 2,
    null,
    { timeout: 60000 },
  ).catch(() => {});
  await page.waitForTimeout(600);
  const opened = await state();
  t("open: list feed renders", opened.tiles === 2 && opened.listSource === "pile", `${opened.tiles} tiles, source=${opened.listSource}`);
  t("open: URL is ?pile=" + PILE, opened.url.includes("pile=" + PILE), opened.url);
  t("open: reference saved to the config", /^pile:116948$/m.test(opened.cfg.replace(/\r/g, "")), JSON.stringify(opened.cfg.split("\n").filter((l) => /pile:/.test(l))));
  const menu = await page.evaluate(() => {
    const g = [...document.querySelectorAll("#vibe-select optgroup")].find((x) => x.label === "Lists");
    return { groups: [...document.querySelectorAll("#vibe-select optgroup")].map((x) => x.label), lists: g ? [...g.children].map((o) => o.textContent.trim()) : [], selected: document.getElementById("vibe-select").selectedOptions[0].textContent.trim() };
  });
  t("open: source menu has a Lists group with it selected", menu.groups.includes("Lists") && menu.lists.includes("PagePile 116948") && menu.selected === "PagePile 116948", JSON.stringify(menu));
  t("open: tree browser hidden in list mode", (await vis("tree-btn")) === "hidden");
  t("open: deep chip hidden in list mode", (await vis("deep-chip")) === "hidden");
  t("open: count badge shows the list length", (await page.evaluate(() => document.getElementById("cat-count").textContent)) === "2");

  // ── 3. The invariants that used to leak (§2.2) ───────────────────────────
  await page.goto(BASE + "/?pile=" + PILE + "&deep=1", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const dg = await state();
  t("guard: deep=1 is dropped for a list feed", dg.deepMode === false && !dg.url.includes("deep=1"), `deepMode=${dg.deepMode} url=${dg.url}`);
  t("guard: deep chip + banner stay hidden", (await vis("deep-chip")) === "hidden" && (await vis("deep-banner")) === "hidden");

  await page.goto(BASE + "/?pile=" + PILE + "&path=Category:Foo/Category:Bar", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const pg = await state();
  t("guard: path= is dropped for a list feed", pg.pathLen === 0 && !pg.url.includes("path="), `pathLen=${pg.pathLen} url=${pg.url}`);
  t("guard: crumbs stay hidden over a list feed", (await vis("crumbs")) === "hidden");
  // A nonexistent pile must fail loudly but inline — the old code alerted().
  await page.goto(BASE + "/?pile=999999999", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const failedLoad = await page.evaluate(() => ({
    shown: !document.getElementById("load-error").classList.contains("hidden"),
    text: document.getElementById("load-error").textContent,
  }));
  t("guard: a failed list load reports inline", failedLoad.shown && /Couldn't load/.test(failedLoad.text), failedLoad.text.slice(0, 78));
  t("guard: no alert() for a failed list load", dialogs.length === 0, dialogs[0] || "none");

  // ── 4. List-editor lines (§5) ────────────────────────────────────────────
  await page.goto(BASE + "/?cat=Category%3AChop%20Suey", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".group", { timeout: 30000 });
  await page.locator("#edit-list-btn").click();
  await page.waitForTimeout(500);
  const baseCfg = await page.evaluate(() => document.getElementById("modal-textarea").value);
  await page.fill("#modal-textarea", baseCfg + "\npile:999999999 | bogus");
  await page.locator("#modal-save").click();
  await page.waitForTimeout(6000);
  const bad = await page.evaluate(() => ({ shown: !document.getElementById("modal-error").classList.contains("hidden"), text: document.getElementById("error-list").textContent }));
  t("editor: a nonexistent pile is rejected", bad.shown && /pile:999999999/.test(bad.text), bad.text.slice(0, 80));

  await page.fill("#modal-textarea", baseCfg + "\npile:" + PILE + " | My test pile");
  // The pile existence probe is a live request, so allow one retry (a transient
  // network failure legitimately shows the validation error).
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator("#modal-save").click();
    await page.waitForTimeout(6000);
    if (await page.evaluate(() => document.getElementById("edit-modal").classList.contains("hidden"))) break;
  }
  const good = await page.evaluate(() => {
    const g = [...document.querySelectorAll("#vibe-select optgroup")].find((x) => x.label === "Lists");
    return { modalClosed: document.getElementById("edit-modal").classList.contains("hidden"), lists: g ? [...g.children].map((o) => o.textContent.trim()) : [] };
  });
  t("editor: a valid pile line saves with its label", good.modalClosed && good.lists.includes("My test pile"), JSON.stringify(good.lists));
  // Never leave the editor open — a rejected save keeps it open by design, and the
  // overlay would block every later click in this spec (found 2026-10-03).
  if (!good.modalClosed) {
    await page.locator("#modal-cancel").click({ force: true });
    await page.waitForTimeout(400);
  }

  // ── 5. Create PagePile from the export dialog (#32) ──────────────────────
  await page.locator("#export-btn").click();
  await page.waitForTimeout(800);
  await page.locator("#export-pile").click();
  await page.waitForFunction(() => !document.getElementById("export-pile-result").classList.contains("hidden"), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(500);
  const created = await page.evaluate(() => ({
    id: document.getElementById("export-pile-id").textContent,
    count: document.getElementById("export-pile-count").textContent,
    view: document.getElementById("export-pile-view").getAttribute("href") || "",
    json: document.getElementById("export-pile-json").getAttribute("href") || "",
  }));
  t("publish: a pile is created with an id", /^\d+$/.test(created.id), created.id);
  t("publish: result panel links to the pile", created.view.includes("id=" + created.id) && created.json.includes("id=" + created.id), created.view);
  await page.locator("#export-pile-open").click();
  await page.waitForFunction(
    () => window.__cvState.list && window.__cvState.list.source === "pile" && window.__cvState.list.titles.length >= 1 && document.querySelectorAll(".group").length >= 2,
    null,
    { timeout: 60000 },
  ).catch(() => {});
  await page.waitForTimeout(600);
  const reopened = await state();
  t("publish: the new pile opens as a feed", reopened.url.includes("pile=" + created.id) && reopened.tiles >= 2, `${reopened.tiles} tiles, ${reopened.url}`);
  t("publish: the new pile joins the Lists menu", await page.evaluate(() => {
    const g = [...document.querySelectorAll("#vibe-select optgroup")].find((x) => x.label === "Lists");
    return !!g && [...g.children].some((o) => /^PagePile /.test(o.textContent.trim()));
  }));

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `lists spec: all ${results.length} assertions pass (created pile ${created.id})`;
}
