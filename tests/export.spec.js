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

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `export spec: all ${results.length} assertions pass`;
}
