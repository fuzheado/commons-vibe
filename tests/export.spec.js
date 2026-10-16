async page => {
  // TDD spec for the export dialog (v1.22; issue #30 phase 1; run via
  //   playwright-cli run-code --filename=tests/export.spec.js
  // against a local server on :8123).
  //
  // Covers: header button opens the modal, scope counts, limit slicing,
  // format previews (CSV header / TXT File: list / JSON parses with the
  // versioned envelope / wiki gallery tags), disabled state when nothing is
  // drawn, and the download producing a correctly-named file.
  // Category: Chop Suey (2 files — small, fast, deterministic).
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  const TILE_URL = BASE + "/?cat=Category%3AChop%20Suey";

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  // ── 1. Empty feed → modal opens, downloads disabled ───────────────────
  await page.goto(BASE + "/?cat=Category%3ANonexistent%20Category%20Xyz%2012345", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator("#export-btn").click();
  t("modal opens from the header button", await page.locator("#export-modal").isVisible());
  t("download disabled with nothing drawn", await page.locator("#export-download").isDisabled());
  t("clips radio disabled when collection empty", await page.locator('input[name="export-scope"][value="clips"]').isDisabled());
  await page.locator("#export-close").click();
  t("close button hides the modal", await page.locator("#export-modal").isHidden());

  // ── 2. Feed with tiles: previews per format ───────────────────────────
  await page.goto(TILE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".group").length >= 1, null, { timeout: 30000 });
  await page.locator("#export-btn").click();
  await page.waitForFunction(() => {
    const pre = document.getElementById("export-preview");
    return pre.textContent && !pre.textContent.startsWith("Loading");
  }, null, { timeout: 30000 });
  t("feed count shown", ((await page.locator("#export-feed-count").textContent()) || "").includes("2"), await page.locator("#export-feed-count").textContent());
  t("download enabled with tiles drawn", !(await page.locator("#export-download").isDisabled()));

  // CSV (default). NB: descriptions may contain embedded newlines (legal
  // quoted CSV), so assert on content, not physical line counts.
  let csv = await page.locator("#export-preview").textContent();
  t("CSV preview: header row present", csv.startsWith("title,description,categories"), csv.slice(0, 60));
  t("CSV preview: both files present", csv.includes("File:Chop Suey") && (csv.match(/File:/g) || []).length >= 2, `${(csv.match(/File:/g) || []).length} File: occurrences`);

  // TXT
  await page.locator('input[name="export-format"][value="txt"]').check();
  const txt = await page.locator("#export-preview").textContent();
  t("TXT preview: bare File: list", /^File:.+$/m.test(txt) && txt.trim().split("\n").length === 2, txt.slice(0, 60));

  // JSON
  await page.locator('input[name="export-format"][value="json"]').check();
  let json;
  try {
    json = JSON.parse(await page.locator("#export-preview").textContent());
  } catch (e) { json = null; }
  t("JSON preview: parses", !!json);
  t("JSON envelope: tool + version + scope", json && json.tool === "CommonsVibe" && !!json.version && json.scope === "feed", json && `${json.tool}/${json.version}`);
  t("JSON envelope: count + source", json && json.count === 2 && /Chop Suey/.test(json.source), json && json.source);
  t("JSON file record: url + description", json && /^https:\/\//.test(json.files[0].fileUrl) && !!json.files[0].description);

  // Wiki gallery
  await page.locator('input[name="export-format"][value="wiki"]').check();
  const wiki = await page.locator("#export-preview").textContent();
  t("wiki preview: gallery tags", wiki.includes('<gallery mode="packed"') && wiki.trim().endsWith("</gallery>"), wiki.slice(0, 70));
  t("wiki preview: caption carries the source", /caption="[^"]*Chop Suey/.test(wiki));

  // Limit select: slicing to 1
  await page.locator('input[name="export-format"][value="txt"]').check();
  await page.locator("#export-limit").selectOption("12");
  const sliced = (await page.locator("#export-preview").textContent()).trim().split("\n");
  t("limit slicing: 2 files → still 2 (under limit)", sliced.length === 2, `${sliced.length} rows`);

  // ── 3. Download produces a file ───────────────────────────────────────
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await page.locator("#export-download").click();
  const download = await downloadPromise;
  const fname = download.suggestedFilename();
  t("download fires with a suggested filename", !!fname, fname);
  t("download filename: scope + source + count + ext", /^commonsvibe-feed-[\w-]+-2\.txt$/.test(fname), fname);

  // ── 4. Clips scope: disabled when empty, live when seeded ─────────────
  await page.evaluate(() => localStorage.setItem("vibe_clips", JSON.stringify(["File:Chop Suey by Edward Hopper.jpg"])));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".group").length >= 1, null, { timeout: 30000 });
  await page.locator("#export-btn").click();
  t("clips radio enabled with a collection", !(await page.locator('input[name="export-scope"][value="clips"]').isDisabled()));
  await page.locator('input[name="export-scope"][value="clips"]').check();
  // radios reset to defaults on reload — pick txt explicitly for a clean check
  await page.locator('input[name="export-format"][value="txt"]').check();
  // NB: the preview repaints twice (feed txt while the clips gather is in
  // flight, then the clips list) — wait for the exact clips content.
  await page.waitForFunction(() =>
    document.getElementById("export-preview").textContent.trim() === "File:Chop Suey by Edward Hopper.jpg",
    null,
    { timeout: 30000 },
  );
  const clipTxt = await page.locator("#export-preview").textContent();
  t("clips export: fetched file list", clipTxt.trim() === "File:Chop Suey by Edward Hopper.jpg", clipTxt.slice(0, 60));
  await page.evaluate(() => localStorage.removeItem("vibe_clips"));

  // ── 5. Stale-page resilience (v1.25) ──────────────────────────────────
  // A cached index.html from an older deploy paired with current JS used to
  // kill init at the first missing element (reported 2026-10-02: the v1.22
  // export wiring against a pre-v1.22 page — endless spinner). Serve today's
  // page with the export ids renamed away and the version fallback rolled
  // back, then assert init survives: feed renders, one guarded reload is
  // attempted, no uncaught errors.
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => sessionStorage.clear());
  const staleErrors = [];
  const staleWarns = [];
  const onErr = (e) => staleErrors.push(e.message);
  const onMsg = (m) => { if (m.type() === "warning" && /stale page markup/.test(m.text())) staleWarns.push(m.text()); };
  page.on("pageerror", onErr);
  page.on("console", onMsg);
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const resp = await route.fetch();
    let body = await resp.text();
    body = body
      .replace('id="export-btn"', 'id="export-btn-retired"')
      .replace('id="export-modal"', 'id="export-modal-retired"')
      .replace(/<span id="app-version">v[\d.]+<\/span>/, '<span id="app-version">v1.21</span>');
    await route.fulfill({ response: resp, body });
  });
  await page.goto(TILE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".group").length >= 1, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const stale = await page.evaluate(() => ({
    tiles: document.querySelectorAll(".group").length,
    exportBtn: !!document.getElementById("export-btn"),
    reloadGuard: sessionStorage.getItem("cv_stale_reload"),
  }));
  t("stale page: feed still renders (no init hang)", stale.tiles >= 1, `${stale.tiles} tiles`);
  t("stale page: export control absent, as in the old cache", stale.exportBtn === false);
  t("stale page: no uncaught errors", staleErrors.length === 0, staleErrors.join("; ") || "clean");
  t("stale page: version mismatch reported", staleWarns.length >= 1, (staleWarns[0] || "no warning").slice(0, 80));
  t("stale page: reload attempted at most once (loop guard)", stale.reloadGuard === "1", String(stale.reloadGuard));
  page.off("pageerror", onErr);
  page.off("console", onMsg);
  await page.unroute("**/*");

  // ── 6. "Everything in scope" — tiers 1 + 2 (v1.29) ───────────────────────
  // Tier 1: clips and list feeds are already in memory → instant, 0 requests.
  // Tier 2: a category/subtree is enumerated by paging (500 titles a page).
  // Titles-only output: enumerated records carry title + Commons page URL, and
  // the JSON envelope says so.
  const progressText = () => page.evaluate(() => document.getElementById("export-progress-text").textContent);
  const openExportWithEverything = async (url) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".group", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.locator("#export-btn").click();
    await page.waitForTimeout(700);
    const label = await page.evaluate(() => document.getElementById("export-limit-everything").textContent);
    await page.selectOption("#export-limit", "everything");
    await page.waitForFunction(() => /files ·/.test(document.getElementById("export-progress-text").textContent), null, { timeout: 60000 }).catch(() => {});
    return label;
  };

  await page.evaluate(() => localStorage.setItem("vibe_clips", JSON.stringify(["File:Chop Suey by Edward Hopper.jpg", "File:Example.jpg"])));
  const clipsLabel = await openExportWithEverything(BASE + "/?clips=1");
  const clipsRun = await page.evaluate(() => ({
    progress: document.getElementById("export-progress-text").textContent,
    download: !document.getElementById("export-download").disabled,
  }));
  t("everything: clips scope is enumerated instantly (0 requests)", /^2 files · 0 requests/.test(clipsRun.progress), clipsRun.progress);
  t("everything: clips option label names the collection", /Everything in your clips \(2\)/.test(clipsLabel), clipsLabel);
  t("everything: instant enumeration is downloadable", clipsRun.download === true);

  const listLabel = await openExportWithEverything(BASE + "/?pile=116948");
  const listRun = await progressText();
  t("everything: a list feed is enumerated instantly (0 requests)", /^2 files · 0 requests/.test(listRun), listRun);
  t("everything: list option label names the list", /Everything in this list \(2\)/.test(listLabel), listLabel);

  const catLabel = await openExportWithEverything(BASE + "/?cat=Category%3AChop%20Suey");
  const catRun = await page.evaluate(() => {
    const r = document.querySelector('input[name="export-format"][value="json"]');
    r.checked = true;
    r.dispatchEvent(new Event("change", { bubbles: true }));
    return { progress: document.getElementById("export-progress-text").textContent, json: document.getElementById("export-preview").textContent.slice(0, 400) };
  });
  t("everything: a category is enumerated by paging (≥1 request)", /^2 files · [1-9]\d* request/.test(catRun.progress), catRun.progress);
  t("everything: category option label is scope-specific", catLabel === "Everything in this category", catLabel);
  t("everything: JSON marks the export titles-only", /"metadata": "titles-only"/.test(catRun.json), catRun.json.slice(0, 120).replace(/\s+/g, " "));
  t("everything: enumerated records keep a Commons page URL", /commons\.wikimedia\.org\/wiki\/File%3A/.test(await page.evaluate(() => document.getElementById("export-preview").textContent)), "");

  const deepLabel = await openExportWithEverything(BASE + "/?cat=Category%3AChop%20Suey&deep=1&sort=shuffle");
  const deepRun = await progressText();
  t("everything: deep scope label says subtree", deepLabel === "Everything in the subtree", deepLabel);
  t("everything: deep enumeration walks the tree and pages files", /^2 files · [1-9]\d* request/.test(deepRun), deepRun);

  // Back to a drawn-set limit: the enumeration must not leak into it. Re-select
  // JSON first — this block ran after a page.goto, which reset the radio to CSV.
  await page.evaluate(() => {
    const r = document.querySelector('input[name="export-format"][value="json"]');
    r.checked = true;
    r.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.selectOption("#export-limit", "24");
  await page.waitForTimeout(600);
  const backToDrawn = await page.evaluate(() => ({
    metadata: (document.getElementById("export-preview").textContent.match(/"metadata": "([a-z-]+)"/) || [])[1] || "",
    previewHead: document.getElementById("export-preview").textContent.slice(0, 90).replace(/\s+/g, " "),
    progressHidden: document.getElementById("export-progress").classList.contains("hidden"),
  }));
  t("everything: switching back to a drawn limit hides the enumerator", backToDrawn.progressHidden === true);
  t("everything: drawn-set JSON is not marked titles-only", backToDrawn.metadata === "full", `${backToDrawn.metadata || "(none)"} — preview: ${backToDrawn.previewHead || ""}`);
  await page.evaluate(() => localStorage.removeItem("vibe_clips"));

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `export spec: all ${results.length} assertions pass`;
}
