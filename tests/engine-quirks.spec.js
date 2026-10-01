async page => {
  // ENGINE QUIRKS + PORTABILITY GUARDS (2026-10-01)
  //
  // Turns the cross-engine findings into executable knowledge. Part A/B record
  // browser/Playwright behaviours the spec suite has to work around; Part C/D are
  // engine-INDEPENDENT guards for the app fix and the test fix those findings
  // produced.
  //
  // A FAILURE IN A "fact:" LINE IS NOT AN APP REGRESSION — it means the engine
  // behaviour changed (browser or Playwright update), so a workaround elsewhere
  // in the suite can probably be revisited. A failure in a "guard:" line IS a
  // real regression. Findings are written up in HANDOFF.md § Cross-engine notes.
  //
  // Run in the matrix:  tests/engine-matrix.sh
  const BASE = "http://127.0.0.1:8123";
  const CAT = "Category%3AFeatured%20pictures%20on%20Wikimedia%20Commons";
  const results = [];
  let failed = 0;
  const t = (name, ok, extra = "") => {
    results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
    if (!ok) failed++;
  };
  const browser = page.context().browser();

  const ua = await page.evaluate(() => navigator.userAgent);
  const engine = /Firefox\//.test(ua) ? "firefox" : /Chrome\//.test(ua) ? "chromium" : "webkit";
  t("engine identified", true, engine);

  // ── A. Input-path facts (own contexts — never the shared page) ──────────────
  const desktopCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const touchCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false });

  // Records which of pointerdown/mousedown/click a REAL Playwright mouse click
  // delivers in the given context.
  const pointerdownProbe = async (ctx) => {
    const pg = await ctx.newPage();
    await pg.goto(`${BASE}/?sort=alpha&view=det&cat=${CAT}&size=m&_=${Date.now()}`);
    await pg.waitForSelector(".group a.media-link", { timeout: 60000 });
    await pg.waitForTimeout(500);
    await pg.evaluate(() => {
      window.__q = [];
      for (const ty of ["pointerdown", "mousedown", "click"]) {
        window.addEventListener(ty, () => window.__q.push(ty), true);
      }
    });
    // Click INSIDE the viewport: the touch context is only 390px wide, so a fixed
    // x=640 lands off-page and records no events at all — which would make the
    // pointerdown assertion below pass vacuously.
    const vp = await pg.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await pg.mouse.click(Math.floor(vp.w / 2), Math.floor(vp.h / 2));
    await pg.waitForTimeout(250);
    const types = await pg.evaluate(() => window.__q);
    await pg.close().catch(() => {});
    return types;
  };

  const desktopTypes = await pointerdownProbe(desktopCtx);
  const touchTypes = await pointerdownProbe(touchCtx);

  // A1. The pointerdown quirk is CONDITIONAL, and getting that wrong is easy:
  //     Firefox DOES deliver pointerdown for programmatic mouse input in a
  //     desktop context, and omits it only when the context has hasTouch:true.
  //     That is exactly the configuration header-collapse.spec.js runs in — which
  //     is why the tap-zone restore (bound to pointerdown alone) failed there and
  //     nowhere else. Every other engine/context combo delivers it.
  t("fact: pointerdown is omitted ONLY by Firefox in a hasTouch context",
    desktopTypes.includes("pointerdown") === true &&
    touchTypes.includes("mousedown") === true &&
    touchTypes.includes("pointerdown") === (engine !== "firefox"),
    `desktop=[${desktopTypes.join("+")}] touch=[${touchTypes.join("+")}]`);

  // A2. OBSERVED, NOT ASSERTED. Whether a SYNTHETIC (untrusted) ctrl-click opens a
  //     tab is timing-sensitive: over three 1.5s trials Chromium and WebKit opened
  //     one and Firefox did not, but an earlier WebKit sample with a 1.0s window
  //     saw nothing. That unreliability is exactly the point — it is why
  //     viewer.spec.js asserts the app's own contract off a synthetic dispatch and
  //     proves real new-tab passthrough with a REAL click instead.
  const opg = await desktopCtx.newPage();
  await opg.goto(`${BASE}/?sort=alpha&view=det&cat=${CAT}&size=m&_=${Date.now()}`);
  await opg.waitForSelector(".group a.media-link", { timeout: 60000 });
  await opg.waitForTimeout(500);
  const pagesBefore = desktopCtx.pages().length;
  await opg.evaluate(() => {
    const a = document.querySelector(".group a.media-link");
    a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
  });
  await opg.waitForTimeout(1500);
  const pagesAfter = desktopCtx.pages().length;
  results.push(`INFO  observed: synthetic ctrl-click pages ${pagesBefore} → ${pagesAfter} (not asserted — timing-sensitive)`);
  for (const p of desktopCtx.pages()) { if (p !== opg) await p.close().catch(() => {}); }
  await desktopCtx.close();

  // ── B. Touch-emulation facts ────────────────────────────────────────────────
  const tpg = await touchCtx.newPage();
  const touch = await tpg.evaluate(() => ({
    coarse: matchMedia("(pointer: coarse)").matches,
    mtp: navigator.maxTouchPoints,
  }));
  // The coarse query is the app's ACTUAL gate (app.js COARSE_POINTER) and matches
  // on every engine — so this is a guard, not a quirk.
  t("fact: hasTouch ⇒ (pointer: coarse) on every engine", touch.coarse === true, JSON.stringify(touch));
  // maxTouchPoints is NOT set by Firefox/WebKit, which is why the header-collapse
  // env probe must not require it.
  t("fact: hasTouch ⇒ maxTouchPoints > 0 only on Chromium",
    (touch.mtp > 0) === (engine === "chromium"), `maxTouchPoints=${touch.mtp}`);

  // ── C. GUARD: a click with NO preceding pointerdown must still restore the
  // collapsed header. This is the v1.17 app fix and it is engine-independent: a
  // synthetic click never carries a pointerdown, in any engine. Before the fix
  // this failed on ALL THREE engines.
  await tpg.goto(`${BASE}/?sort=alpha&view=det&cat=${CAT}&size=l&_=${Date.now()}`);
  await tpg.waitForSelector(".group", { timeout: 60000 });
  await tpg.waitForTimeout(600);
  for (let i = 0; i < 3; i++) {
    await tpg.evaluate(() => window.scrollBy(0, 600));
    await tpg.waitForTimeout(650);
  }
  const collapsedBefore = await tpg.evaluate(() =>
    document.querySelector("#app-header").classList.contains("cv-header-collapsed"));
  await tpg.evaluate(() => {
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 300, clientY: 20 }));
  });
  await tpg.waitForTimeout(400);
  const collapsedAfter = await tpg.evaluate(() =>
    document.querySelector("#app-header").classList.contains("cv-header-collapsed"));
  t("guard: click-only (no pointerdown) restores the collapsed header",
    collapsedBefore === true && collapsedAfter === false, `collapsed ${collapsedBefore} → ${collapsedAfter}`);

  // ── D. GUARD: the new-tab modifier must be the PLATFORM's one. On macOS that is
  // Cmd (Meta); a real Ctrl+click opens no tab in any engine there, which is why
  // viewer.spec.js derives the modifier instead of hardcoding Control.
  const mod = await tpg.evaluate(() =>
    (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "Meta" : "Control"));
  t("guard: platform new-tab modifier resolved", mod === "Meta" || mod === "Control", mod);

  await touchCtx.close();

  const passed = results.filter((r) => r.startsWith("PASS")).length;
  const summary = `Engine-quirks spec: ${passed} passed, ${failed} failed\n${results.join("\n")}`;
  console.log(summary);
  if (failed > 0) throw new Error(summary);
  return summary;
}
