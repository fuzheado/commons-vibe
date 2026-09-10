async page => {
  // TDD spec for the scroll-aware collapsing header (issue #17 — run via:
  //   playwright-cli run-code --filename=tests/header-collapse.spec.js
  // against a local server on :8123).
  //
  // The feature is touch-only (COARSE_POINTER gate in app.js), so this spec
  // creates its OWN touch-emulated context (hasTouch/isMobile → the
  // `(pointer: coarse)` media query matches) instead of touching the shared
  // browser session — the desktop STL suite needs the shared page untouched.
  // Runs at a phone viewport (390×844) where size=l tiles form a long single
  // column with real scroll room. Ordered behavioral assertions:
  //   - band stays put below the 100px threshold, collapses past it
  //   - collapse is transform-only (grid columns, URL, history untouched)
  //   - upward scroll and top-edge taps restore it; the tap is swallowed so
  //     the tile underneath is never activated
  //   - modals own their scroll context — collapse never fires behind one
  //   - infinite scroll keeps loading while the band is collapsed
  const browser = page.context().browser();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, // flips (pointer: coarse) — activates the app's touch gate
    // isMobile deliberately OFF: mobile emulation replaces wheel/mouse
    // behavior with touch gestures and scales the layout viewport (534px),
    // which breaks the deterministic scroll/click steps below.
    isMobile: false,
  });
  const pg = await ctx.newPage();

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
  const sett = (ms) => pg.waitForTimeout(ms);
  const scrollBy = (d) => pg.evaluate((dd) => window.scrollBy(0, dd), d);
  const collapsed = () => pg.evaluate(() =>
    document.querySelector("#app-header").classList.contains("cv-header-collapsed"));
  const scrollY = () => pg.evaluate(() => window.scrollY);
  const headerTransform = () => pg.evaluate(() =>
    getComputedStyle(document.querySelector("#app-header")).transform);
  const tileCount = () => pg.locator(".group").count();
  // Moves the page down PAST the threshold with real movement — and keeps the
  // sentinel fed so a batch can land if the page is still short.
  const scrollDownFar = async () => {
    for (let i = 0; i < 3; i++) {
      const before = await scrollY();
      await scrollBy(600);
      await sett(650);
      const after = await scrollY();
      if (after > 100 && after > before + 8) return true; // moved past threshold
    }
    return (await scrollY()) > 100; // already over the threshold (clamped)
  };
  const coarseFlag = await pg.evaluate(() => ({
    coarse: matchMedia("(pointer: coarse)").matches,
    touch: navigator.maxTouchPoints > 0,
  }));
  t("environment: touch-emulated (coarse pointer)", coarseFlag.coarse && coarseFlag.touch,
    JSON.stringify(coarseFlag));

  await pg.goto(BASE + "/?sort=alpha&view=det&cat=Category%3AFeatured%20pictures%20on%20Wikimedia%20Commons&size=l&_=" + Date.now());
  await pg.waitForSelector(".group", { timeout: 60000 });
  await sett(800);
  const colsAtLoad = await pg.evaluate(() => document.querySelector("#masonry-container").children.length);
  const historyLen = await pg.evaluate(() => history.length);
  const urlAtLoad = pg.url();

  await step("1. header visible at the top (scrollY 0)", async () => {
    const y = await scrollY();
    t("at top of page", y < 5, `scrollY ${y}`);
    t("not collapsed", !(await collapsed()));
  });

  await step("2. small scroll (under 100px) does not collapse", async () => {
    await pg.mouse.wheel(0, 60);
    await sett(500);
    const y = await scrollY();
    t("scrolled a little", y > 10 && y <= 110, `scrollY ${y}`);
    t("still expanded", !(await collapsed()));
  });

  await step("3. scroll past the threshold collapses the band", async () => {
    await scrollDownFar();
    const y = await scrollY();
    t("scrolled past 100", y > 100, `scrollY ${y}`);
    t("header collapsed", await collapsed());
    const tr = await headerTransform();
    t("visual transform applied", /matrix\(/.test(tr), tr);
  });

  await step("4. collapse is transform-only — grid, URL, history untouched", async () => {
    const cols = await pg.evaluate(() => document.querySelector("#masonry-container").children.length);
    t("masonry columns unchanged", cols === colsAtLoad, `${cols} columns`);
    t("URL unchanged (no history write)", pg.url() === urlAtLoad);
    const hl = await pg.evaluate(() => history.length);
    t("history length unchanged", hl === historyLen, `${historyLen} entries`);
  });

  await step("5. upward scroll restores the band", async () => {
    await scrollBy(-500);
    await sett(650);
    const y = await scrollY();
    t("header expanded again", !(await collapsed()), `scrollY ${y}`);
  });

  // The app self-fills only while the sentinel is within viewport+800, so a
  // cold page is one batch (~12 tiles). Walking to the bottom wakes the
  // sentinel: a second batch lands — and this also proves infinite scroll
  // keeps working while the header is collapsed.
  await step("5b. second batch loads while the header is collapsed (scroll room)", async () => {
    const tiles0 = await tileCount(); // baseline before the walk
    await scrollBy(2000);
    await sett(600);
    t("collapsed while below the fold", await collapsed());
    for (let i = 0; i < 20; i++) { // walk to the bottom (sentinel-waking)
      const before = await scrollY();
      await scrollBy(2000);
      await sett(350);
      if ((await scrollY()) <= before) break; // clamped at the bottom
    }
    for (let i = 0; i < 12; i++) {
      if ((await tileCount()) > tiles0) break;
      await sett(700);
    }
    const tiles1 = await tileCount();
    t("more tiles rendered (infinite scroll alive)", tiles1 > tiles0, `${tiles0} -> ${tiles1}`);
    await scrollBy(-100000); // back to the top, clean state for the tap tests
    await sett(700);
  });

  await step("6. collapse again, then a top-edge tap restores and swallows the tap", async () => {
    t("expanded before tap test", !(await collapsed()));
    await scrollDownFar();
    t("collapsed for tap test", await collapsed(), await scrollY().then((y) => `scrollY ${y}`));
    const popupP = pg.waitForEvent("popup", { timeout: 700 }).catch(() => null);
    await pg.mouse.click(300, 20); // inside the 48px top-edge zone
    const popup = await popupP;
    t("tap restored the header", !(await collapsed()));
    t("tap did not open the tile underneath", popup === null);
    t("URL still local", pg.url().startsWith(BASE), pg.url());
    if (popup) await popup.close().catch(() => {});
  });

  await step("7. a tap outside the top zone does not expand", async () => {
    await scrollDownFar();
    t("collapsed for outside-zone tap", await collapsed(), await scrollY().then((y) => `scrollY ${y}`));
    // x=10 is the page margin (main p-4) — no tile/header under it.
    await pg.mouse.click(10, 200);
    await sett(300);
    t("still collapsed", await collapsed());
  });

  await step("8. modal guard: collapse never fires behind an open modal", async () => {
    await scrollBy(-800); // restore to the top, then open the tree modal
    await sett(650);
    t("expanded before modal test", !(await collapsed()), await scrollY().then((y) => `scrollY ${y}`));
    await pg.click("#tree-btn");
    await sett(400);
    await scrollBy(800); // document scrolls behind the fixed overlay
    await sett(650);
    t("header not collapsed while modal open", !(await collapsed()), await scrollY().then((y) => `scrollY ${y}`));
    await pg.click("#tree-close");
    await sett(400);
  });

  await step("9. collapse resumes normally after the modal closes", async () => {
    await scrollDownFar();
    t("header collapsed after modal close", await collapsed(), await scrollY().then((y) => `scrollY ${y}`));
    await scrollBy(-800); // restore for a clean end state
    await sett(650);
    t("restored at end", !(await collapsed()));
  });

  await ctx.close();
  const passed = results.filter((r) => r.startsWith("PASS")).length;
  const summary = `Header-collapse spec: ${passed} passed, ${failed} failed\n${results.join("\n")}`;
  console.log(summary);
  if (failed > 0) throw new Error(summary);
  return summary;
}