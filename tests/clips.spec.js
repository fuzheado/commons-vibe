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
  t("dropdown shows My Clips label", ((await page.locator("#vibe-select option").first().textContent()) || "").startsWith("My Clips"));
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

  // Cleanup: leave storage empty for other specs.
  await page.evaluate(() => localStorage.removeItem("vibe_clips"));

  if (failed) throw `${failed} failed\n${results.join("\n")}`;
  console.log(results.join("\n"));
  return `clips spec: all ${results.length} assertions pass`;
}
