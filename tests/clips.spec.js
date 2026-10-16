async page => {
  // TDD spec for the clip / personal-collection feature (v1.18; run via
  //   playwright-cli run-code --filename=tests/clips.spec.js
  // against a local server on :8123).
  //
  // Covers: tile clip toggle + persisted state, header chip count,
  // the clips feed (list mode, source 'clips'), ?clips=1 URL boot,
  // in-feed unclip (tile drops in place), and localStorage round-trip.
  // Uses Category:Chop Suey (2 files — small, fast, deterministic).
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const BASE = "http://127.0.0.1:8123";
  const TILE_URL = BASE + "/?cat=Category%3AChop%20Suey";

  const waitTiles = (n) =>
    page.waitForFunction(
      (min) => document.querySelectorAll(".group .clip-btn").length >= min,
      n,
      { timeout: 30000 },
    );

  // Fresh storage so runs are order-independent.
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  // ── 1. Tile clip toggle ────────────────────────────────────────────────
  await page.goto(TILE_URL, { waitUntil: "domcontentloaded" });
  await waitTiles(1);
  const firstBtn = page.locator(".group .clip-btn").first();
  await firstBtn.click();
  let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("vibe_clips") || "[]"));
  t("clip toggle writes vibe_clips", stored.length === 1, JSON.stringify(stored));
  t("stored title is File:-prefixed", /^File:/.test(stored[0] || ""), stored[0]);
  t("chip count shows 1", (await page.locator("#clips-count").textContent()).trim() === "1");
  t("clipped button turns blue", (await firstBtn.getAttribute("class")).includes("bg-blue-600"));
  t("chip visible after first clip", await page.locator("#clips-btn").isVisible());

  // Toggling the same tile again unclips it.
  await firstBtn.click();
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("vibe_clips") || "[]"));
  t("second toggle unclips (array back to empty)", stored.length === 0, JSON.stringify(stored));
  t("chip hidden again at zero", await page.locator("#clips-btn").isHidden());

  // Clip one file and keep it for the feed tests.
  await firstBtn.click();
  const clippedFile = await page.evaluate(() => JSON.parse(localStorage.getItem("vibe_clips"))[0]);

  // ── 2. Persistence across reload ───────────────────────────────────────
  await page.goto(TILE_URL, { waitUntil: "domcontentloaded" });
  await waitTiles(1);
  t("chip count survives reload", (await page.locator("#clips-count").textContent()).trim() === "1");
  t("tile button restored clipped state", (await page.locator(".group .clip-btn").first().getAttribute("class")).includes("bg-blue-600"));

  // ── 3. Clips feed via header chip ──────────────────────────────────────
  await page.locator("#clips-btn").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".group").length >= 1,
    null,
    { timeout: 30000 },
  );
  t("clips feed URL carries clips=1", page.url().includes("clips=1"), page.url());
  // v1.28: the source menu renders a Lists group after Categories, so the active
  // list is asserted via the SELECTED option (the mode is what matters here).
  const clipOpt = await page.evaluate(() => {
    const sel = document.getElementById("vibe-select");
    return { text: sel.selectedOptions[0].textContent.trim(), value: sel.selectedOptions[0].value };
  });
  t("dropdown selects the My Clips entry", clipOpt.text.startsWith("My Clips") && clipOpt.value === "clips", JSON.stringify(clipOpt));
  t("sort pill hidden in list mode", await page.locator("#sort-pill").isHidden());
  const feedTitle = await page.evaluate(() =>
    decodeURIComponent(((document.querySelector(".group a.media-link") || {}).href || "").split("/wiki/")[1] || ""));
  t("feed shows the clipped file", feedTitle === clippedFile, feedTitle);

  // ── 4. In-feed unclip drops the tile in place ─────────────────────────
  await page.locator(".group .clip-btn").first().click();
  await page.waitForTimeout(300);
  t("tile removed from clips feed", (await page.locator(".group").count()) === 0);
  t("End of Collection appears when feed empties", await page.locator("#end-message").isVisible());
  stored = await page.evaluate(() => JSON.parse(localStorage.getItem("vibe_clips") || "[]"));
  t("localStorage empty after unclip", stored.length === 0, JSON.stringify(stored));
  t("chip hidden after emptying feed", await page.locator("#clips-btn").isHidden());

  // ── 5. ?clips=1 boots directly into the feed ──────────────────────────
  await page.evaluate((f) => localStorage.setItem("vibe_clips", JSON.stringify([f])), clippedFile);
  await page.goto(BASE + "/?clips=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.querySelectorAll(".group").length >= 1,
    null,
    { timeout: 30000 },
  );
  t("?clips=1 boots the clips feed", (await page.locator(".group").count()) >= 1);
  t("booted feed shows the seeded clip",
    (await page.evaluate(() =>
      decodeURIComponent(((document.querySelector(".group a.media-link") || {}).href || "").split("/wiki/")[1] || ""))) === clippedFile);

  // ── 6. Collection management (v1.29) ─────────────────────────────────────
  // The collection had no way to be seen, edited or reset as a whole. The clips
  // feed now shows a manager bar; the modal edits it as text with validation.
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate((f) => localStorage.setItem("vibe_clips", JSON.stringify([f, "File:Example.jpg"])), clippedFile);
  await page.goto(BASE + "/?clips=1", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".group").length >= 2, null, { timeout: 40000 }).catch(() => {});
  const bar = await page.evaluate(() => ({
    visible: !document.getElementById("clips-bar").classList.contains("hidden"),
    count: document.getElementById("clips-bar-count").textContent,
  }));
  t("manage: the clips bar appears in the clips feed", bar.visible === true && /2 clips/.test(bar.count), JSON.stringify(bar));

  await page.locator("#clips-bar-edit").click();
  await page.waitForTimeout(500);
  const editor = await page.evaluate(() => ({
    open: !document.getElementById("clips-modal").classList.contains("hidden"),
    value: document.getElementById("clips-textarea").value,
  }));
  t("manage: the editor opens pre-filled with the collection", editor.open === true && editor.value.split("\n").length === 2, JSON.stringify(editor.value));

  // A bogus title must block the save entirely (all-or-nothing, like the category editor).
  await page.fill("#clips-textarea", `${clippedFile}\nFile:Not a real file xyzzy 98765.jpg`);
  await page.locator("#clips-save").click();
  await page.waitForFunction(() => !document.getElementById("clips-error").classList.contains("hidden"), null, { timeout: 30000 }).catch(() => {});
  const rejected = await page.evaluate(() => ({
    error: document.getElementById("clips-error-list").textContent,
    stillSaved: JSON.parse(localStorage.getItem("vibe_clips") || "[]").length,
    modalOpen: !document.getElementById("clips-modal").classList.contains("hidden"),
  }));
  t("manage: an unknown file is rejected with its name", /Not a real file xyzzy 98765/.test(rejected.error), rejected.error.slice(0, 80));
  t("manage: a rejected save changes nothing", rejected.stillSaved === 2 && rejected.modalOpen === true, `stored=${rejected.stillSaved}`);

  // Valid save: prefixing, de-duplication and typed order all hold.
  await page.fill("#clips-textarea", `Example.jpg\n${clippedFile}\n${clippedFile}`);
  await page.locator("#clips-save").click();
  await page.waitForFunction(() => document.getElementById("clips-modal").classList.contains("hidden"), null, { timeout: 40000 }).catch(() => {});
  // The save reloads the clips feed (resetAndFetch clears the grid first), so wait
  // for the feed's own state rather than reading tiles straight after the close.
  await page.waitForFunction(
    () => window.__cvState.list && window.__cvState.list.titles.length === 2 && document.querySelectorAll(".group").length === 2,
    null,
    { timeout: 40000 },
  ).catch(() => {});
  const saved = await page.evaluate(() => ({
    clips: window.__cvState.clips,
    chip: document.getElementById("clips-count").textContent,
    feedTitles: [...document.querySelectorAll(".group")].map((g) => g.dataset.file),
  }));
  t("manage: bare titles get the File: prefix, duplicates collapse",
    saved.clips.length === 2 && saved.clips[0] === "File:Example.jpg" && saved.clips[1] === clippedFile, JSON.stringify(saved.clips));
  t("manage: the chip count follows the saved list", saved.chip === "2", saved.chip);
  t("manage: the feed re-renders in the saved order", saved.feedTitles.length === 2 && saved.feedTitles[0] === "File:Example.jpg", JSON.stringify(saved.feedTitles));

  // Clear all: two-step (the second press does it), then the empty state.
  await page.locator("#clips-bar-clear").click();
  await page.waitForTimeout(300);
  const armed = await page.evaluate(() => document.getElementById("clips-bar-clear").textContent);
  t("manage: clear-all asks once before acting", /Really clear 2\?/.test(armed), armed);
  await page.locator("#clips-bar-clear").click();
  await page.waitForFunction(() => window.__cvState.clips.length === 0, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const cleared = await page.evaluate(() => ({
    clips: window.__cvState.clips.length,
    stored: localStorage.getItem("vibe_clips"),
    chipHidden: document.getElementById("clips-btn").classList.contains("hidden"),
    endShown: !document.getElementById("end-message").classList.contains("hidden"),
    barCount: document.getElementById("clips-bar-count").textContent,
  }));
  t("manage: clear-all empties the collection and storage", cleared.clips === 0 && cleared.stored === null, `stored=${cleared.stored}`);
  t("manage: the chip hides and the feed ends", cleared.chipHidden === true && cleared.endShown === true);
  t("manage: the (now empty) collection can be edited again", cleared.barCount === "0 clips");
  await page.locator("#clips-bar-edit").click();
  await page.waitForTimeout(400);
  const emptyEditor = await page.evaluate(() => document.getElementById("clips-textarea").value);
  t("manage: the empty editor invites a paste", emptyEditor === "", JSON.stringify(emptyEditor));
  await page.locator("#clips-cancel").click();

  // Cleanup: leave storage empty for other specs.
  await page.evaluate(() => localStorage.removeItem("vibe_clips"));

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `clips spec: all ${results.length} assertions pass`;
}
