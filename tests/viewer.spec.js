async page => {
  // TDD spec for the in-app media viewer (issue #23, Phase 1 prototype).
  //   playwright-cli run-code --filename=tests/viewer.spec.js
  // against a local server on :8123 (see tests/run.sh for the preconditions).
  //
  // The defining regression this guards: clicking a tile must NOT open a new
  // tab/page. Tiles stay real anchors, so Ctrl/Cmd-click and middle-click keep
  // their native new-tab behaviour — only an unmodified left-click opens the
  // viewer. Assertions are deliberately structural where Commons data could
  // churn (license/pill text varies by file), and exact where the app owns
  // the behaviour (viewer visibility, URL state, request counts).
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
  const CAT = "Category%3AFeatured_pictures_on_Wikimedia_Commons";

  // ── helpers ──────────────────────────────────────────────────────────────
  const state = () =>
    page.evaluate(() => {
      const modal = document.getElementById("viewer-modal");
      const rows = [...document.querySelectorAll("#viewer-details .viewer-row")];
      const media = document.querySelector("#viewer-media img, #viewer-media video, #viewer-media audio");
      return {
        open: !modal.classList.contains("hidden"),
        title: document.getElementById("viewer-title").textContent,
        rowLabels: rows.map((r) => r.querySelector(".viewer-label").textContent),
        license: (rows.find((r) => r.querySelector(".viewer-label").textContent === "License") || {})
          .querySelector?.(".viewer-value")?.textContent || "",
        pills: document.querySelectorAll("#viewer-details .cat-pill").length,
        attrib: (document.querySelector(".viewer-attrib") || {}).textContent || "",
        mediaTag: media ? media.tagName : "",
        mediaSrc: media ? media.getAttribute("src") || "" : "",
        commonsHref: document.getElementById("viewer-commons").href,
        file: new URLSearchParams(location.search).get("file"),
        prevDisabled: document.getElementById("viewer-prev").disabled,
        nextDisabled: document.getElementById("viewer-next").disabled,
      };
    });

  // Viewer metadata is the only api.php call carrying a widened extmetadata
  // filter — so this counts viewer fetches specifically.
  const metaReqs = () =>
    page.evaluate(() =>
      performance.getEntriesByType("resource").filter((r) => r.name.includes("iiextmetadatafilter=Artist")).length,
    );

  const openFirstTile = async () => {
    await page.waitForSelector("a.media-link", { timeout: 90000 });
    await page.evaluate(() => document.querySelector("a.media-link").click());
    await page.waitForFunction(() => !document.getElementById("viewer-modal").classList.contains("hidden"), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelectorAll("#viewer-details .viewer-row").length > 0, null, { timeout: 30000 });
  };

  await page.setViewportSize({ width: 1280, height: 720 });
  // Re-runnable in a shared browser session: drop any route a previous run left
  // behind (routes persist on the context and the first match wins), then block
  // outbound Commons *page* navigation only — never api.php — so a genuine
  // new-tab passthrough can be observed without loading an external page.
  await page.context().unrouteAll();
  await page.context().route("**://commons.wikimedia.org/wiki/**", (r) => r.abort());
  const pagesAtStart = page.context().pages().length;

  await page.goto(`${BASE}/?cat=${CAT}&_=${Date.now()}`);
  await page.waitForSelector("a.media-link", { timeout: 90000 });

  let s = null;

  // ── 1. the defining assertion: no new tab on a plain click ──────────────
  await step("plain click opens the viewer without opening a tab", async () => {
    const pagesBefore = page.context().pages().length;
    let popups = 0;
    const onPage = (p) => { if (p !== page) popups++; };
    page.context().on("page", onPage);
    await openFirstTile();
    await page.waitForTimeout(800); // window for any stray popup to appear
    page.context().off("page", onPage);
    s = await state();
    t("plain click: viewer is open", s.open === true);
    t("plain click: no new tab opened", page.context().pages().length === pagesBefore, `pages ${pagesBefore} → ${page.context().pages().length}`);
    t("plain click: no popup fired", popups === 0, `${popups} popup(s)`);
  });

  // ── 2. tiles stay real anchors (the no-toggle contract) ─────────────────
  await step("tiles remain real anchors to Commons", async () => {
    const anchor = await page.evaluate(() => {
      const a = document.querySelector(".group a.media-link");
      return { tag: a.tagName, target: a.getAttribute("target"), href: a.getAttribute("href") };
    });
    t("tile is still an <a>", anchor.tag === "A", anchor.tag);
    t("tile keeps target=_blank", anchor.target === "_blank", String(anchor.target));
    t("tile href still points at Commons", /^https:\/\/commons\.wikimedia\.org\/wiki\//.test(anchor.href), anchor.href.slice(0, 60));
  });

  // ── 3. modifier-click passthrough (the no-toggle contract) ─────────────
  await step("Ctrl/Cmd-click is NOT intercepted (native new-tab override)", async () => {
    await page.keyboard.press("Escape"); // start from the feed
    await page.waitForTimeout(400);
    const parentPages = page.context().pages().length;
    // Synthetic dispatch: proves what OUR handler does (does it preventDefault?)
    // without depending on real popup delivery, which browsers may block.
    const probe = await page.evaluate(() => {
      const a = document.querySelector(".group a.media-link");
      const fire = (init) => {
        const ev = new MouseEvent("click", Object.assign({ bubbles: true, cancelable: true }, init));
        a.dispatchEvent(ev);
        return ev.defaultPrevented;
      };
      const ctrlPrevented = fire({ ctrlKey: true });
      const viewerAfterCtrl = !document.getElementById("viewer-modal").classList.contains("hidden");
      const plainPrevented = fire({});
      return { ctrlPrevented, viewerAfterCtrl, plainPrevented };
    });
    await page.waitForTimeout(900); // a late async open, or the popup, surfaces here
    t("ctrl-click was NOT preventDefault'ed (native new-tab wins)", probe.ctrlPrevented === false);
    t("ctrl-click did not open the viewer", probe.viewerAfterCtrl === false);
    // Because we did NOT intercept it, the browser really did open a tab.
    const pagesAfterCtrl = page.context().pages().length;
    t("ctrl-click really opened a new tab (native passthrough)", pagesAfterCtrl >= parentPages + 1, `${parentPages} → ${pagesAfterCtrl}`);
    // Drop the stray tab so later page-count baselines stay meaningful.
    for (const p of page.context().pages()) {
      if (p !== page) await p.close().catch(() => {});
    }
    t("plain click IS intercepted (positive control)", probe.plainPrevented === true);
    s = await state();
    t("plain click opened the viewer", s.open === true);
  });

  // ── 4. viewer content ───────────────────────────────────────────────────
  await step("viewer renders media + Commons details", async () => {
    await page.waitForFunction(() => document.querySelectorAll("#viewer-details .viewer-row").length > 1, null, { timeout: 30000 });
    s = await state();
    t("title is populated", s.title.length > 3, s.title.slice(0, 48));
    t("detail rows rendered", s.rowLabels.length >= 5, `${s.rowLabels.length} rows: ${s.rowLabels.join("/")}`);
    t("description row present", s.rowLabels.includes("Description"));
    t("license row present", s.rowLabels.includes("License"), s.license.slice(0, 40));
    t("file facts row present", s.rowLabels.includes("File"));
    t("categories rendered as pills", s.pills >= 1, `${s.pills} pills`);
    t("attribution line present", s.attrib.startsWith("Credit:"), s.attrib.slice(0, 60));
    t("media element mounted", ["IMG", "VIDEO", "AUDIO"].includes(s.mediaTag), s.mediaTag);
    t("stage image is a viewer-grade ladder thumb", /\/(\d{3,4})px-/.test(s.mediaSrc), (s.mediaSrc.match(/\/(\d{3,4})px-/) || [])[0] || "n/a");
    t("escape hatch points at the Commons file page", s.commonsHref.includes("commons.wikimedia.org/wiki/"), s.commonsHref.slice(0, 60));
  });

  // ── 5. URL state ────────────────────────────────────────────────────────
  await step("viewer state is URL-driven", async () => {
    s = await state();
    t("file= param present while open", !!s.file && s.file.startsWith("File:"), String(s.file).slice(0, 50));
  });

  // ── 6. prev/next ────────────────────────────────────────────────────────
  await step("prev/next steps through the feed and updates file=", async () => {
    const before = await state();
    t("prev disabled on the first tile", before.prevDisabled === true);
    await page.evaluate(() => document.getElementById("viewer-next").click());
    await page.waitForFunction((prev) => {
      const t2 = document.getElementById("viewer-title").textContent;
      return t2 && t2 !== prev;
    }, before.title, { timeout: 30000 });
    const after = await state();
    t("next changed the file", after.title !== before.title);
    t("next updated file= in the URL", after.file && after.file !== before.file, String(after.file).slice(0, 50));
    t("prev is enabled after stepping", after.prevDisabled === false);
    const steps = page.context().pages().length;
    t("stepping opened no tabs", steps === pagesAtStart, `${steps} page(s), baseline ${pagesAtStart}`);
  });

  // ── 7. Esc closes + drops the URL param ─────────────────────────────────
  await step("Esc closes the viewer and drops file=", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    s = await state();
    t("viewer closed", s.open === false);
    const url = await page.evaluate(() => location.search);
    t("file= dropped from the URL", !url.includes("file="), url.slice(0, 80));
  });

  // ── 8. cache: reopening the SAME file costs no viewer request ───────────
  await step("reopening the same file makes no new viewer request", async () => {
    // Pin the file explicitly: masonry reflow can change DOM order, so
    // "the first tile" is not necessarily the tile we just viewed.
    await openFirstTile();
    const f = (await state()).file;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const before = await metaReqs();
    await page.evaluate((file) => {
      const card = [...document.querySelectorAll(".group")].find((c) => c.dataset.file === file);
      if (card) card.querySelector("a.media-link").click();
    }, f);
    await page.waitForFunction(() => !document.getElementById("viewer-modal").classList.contains("hidden"), null, { timeout: 30000 });
    await page.waitForTimeout(600);
    const after = await metaReqs();
    const s2 = await state();
    t("viewer reopened the same file", s2.file === f, `${String(s2.file).slice(0, 40)}`);
    t("no new widened-metadata request on reopen", after === before, `${before} → ${after}`);
    t("reopened viewer still has its details", s2.rowLabels.length >= 5, `${s2.rowLabels.length} rows`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  });

  // ── 9. Back closes; deep link boots open ────────────────────────────────
  await step("Back closes the viewer (popstate) and a deep link boots it open", async () => {
    await openFirstTile();
    const openFile = (await state()).file;
    await page.goBack();
    await page.waitForTimeout(700);
    s = await state();
    t("Back closed the viewer", s.open === false);
    t("Back did not change the feed category", page.url().includes("Featured_pictures"));
    // deep link
    await page.goto(`${BASE}/?cat=${CAT}&file=${encodeURIComponent(openFile)}&_=${Date.now()}`);
    await page.waitForFunction(() => !document.getElementById("viewer-modal").classList.contains("hidden"), null, { timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll("#viewer-details .viewer-row").length > 0, null, { timeout: 60000 }).catch(() => {});
    s = await state();
    t("deep link (?file=) boots with the viewer open", s.open === true, s.title.slice(0, 40));
    t("deep link shows the requested file", s.file === openFile, String(s.file).slice(0, 50));
  });

  const passed = results.filter((r) => r.startsWith("PASS")).length;
  const summary = `Viewer spec: ${passed} passed, ${failed} failed\n${results.join("\n")}`;
  console.log(summary);
  if (failed > 0) throw new Error(summary);
  return summary;
}
