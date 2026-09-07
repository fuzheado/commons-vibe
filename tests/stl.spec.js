async page => {
  // TDD spec for the 3D STL hover-to-spin viewer (run via:
  //   playwright-cli run-code --filename=tests/stl.spec.js
  // against a local server on :8123). Ordered behavioral assertions; the
  // final passing artifact is the video tour (tests/stl-tour.js), recorded
  // only after every assertion here passes.
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
  const stlReq = [];
  const onReq = (r) => { if (/\.stl(\?|$)/.test(r.url())) stlReq.push(r.url()); };
  page.on("request", onReq);
  const cam = () => page.evaluate(() => {
    const s = [...(window.__cvStl?.registry?.values() || [])][0];
    if (!s || !s.camera) return null;
    const p = s.camera.position;
    return { x: +p.x.toFixed(4), y: +p.y.toFixed(4), z: +p.z.toFixed(4) };
  });
  const dist = () => page.evaluate(() => {
    const s = [...(window.__cvStl?.registry?.values() || [])][0];
    return s ? s.camera.position.distanceTo(s.controls.target) : null;
  });
  const center = async (loc) => {
    // block:center keeps the tile clear of the sticky header — a tile at the
    // viewport top would swallow mouse.move into the header, never hovering.
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    const b = await loc.boundingBox();
    if (!b) throw new Error("no bounding box");
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
  };
  const leaveTile = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height + 60, { steps: 3 });
    await page.waitForTimeout(450);
  };
  const parkMouse = async () => {
    // Top header zone: no tile under the cursor while scrolling around.
    await page.mouse.move(640, 60);
    await page.waitForTimeout(300);
  };

  await page.goto(BASE + "/?sort=alpha&view=det&cat=Category%3ASTL%20files&size=m&_=" + Date.now());
  await page.waitForSelector(".group", { timeout: 60000 });
  // Pointer-event spy for post-mortem diagnostics (step 6 failures).
  await page.evaluate(() => {
    window.__dbg = [];
    const wire = () => {
      document.querySelectorAll("[data-stl]").forEach((b, i) => {
        if (i < 4 && !b.__spied) {
          b.__spied = true;
          ["pointerenter", "pointerleave"].forEach((t) =>
            b.addEventListener(t, () => window.__dbg.push(`${t.slice(7)}#${i}@${Math.round(performance.now())}`))
          );
        }
      });
    };
    wire();
    new MutationObserver(wire).observe(document.body, { childList: true, subtree: true });
  });

  await step("1. category loads with STL tiles + posters", async () => {
    const tiles = await page.locator(".group").count();
    t("tiles >= 12", tiles >= 12, `${tiles} tiles`);
    const boxes = await page.locator("[data-stl]").count();
    t("STL media boxes present", boxes >= 12, `${boxes} [data-stl] boxes`);
    const posters = await page.locator("[data-stl] img").count();
    t("server-rendered posters present", posters >= 12, `${posters} posters`);
  });

  await step("3. lazy loading: no STL bytes before any hover", async () => {
    await page.waitForTimeout(800);
    t("0 .stl network requests after load+idle", stlReq.length === 0, `${stlReq.length} reqs`);
  });

  await step("4. hover enables 3D (canvas + bytes)", async () => {
    const c = await center(page.locator("[data-stl]").first());
    await page.mouse.move(c.x, c.y, { steps: 3 });
    await page.locator("[data-stl] canvas").first().waitFor({ timeout: 25000 });
    t("WebGL canvas appears in tile", true);
    await page.waitForTimeout(600);
    t("STL bytes fetched on hover", stlReq.length >= 1, `${stlReq.length} reqs`);
    // stop auto-rotate with a 1px jiggle so camera assertions are deterministic
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    const c0 = await cam();
    t("camera state exposed for tests", !!c0, c0 ? JSON.stringify(c0) : "null");
  });

  await step("5a. horizontal drag rotates (yaw)", async () => {
    const c = await center(page.locator("[data-stl]").first());
    const c1 = await cam();
    await page.mouse.move(c.x, c.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(c.x + 110, c.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const c2 = await cam();
    t("camera moved horizontally", c1.x !== c2.x || c1.z !== c2.z, `${JSON.stringify(c1)} → ${JSON.stringify(c2)}`);
  });

  await step("5b. vertical drag pitches", async () => {
    const c = await center(page.locator("[data-stl]").first());
    const c1 = await cam();
    await page.mouse.move(c.x, c.y, { steps: 2 });
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 90, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const c2 = await cam();
    t("camera moved vertically", c1.y !== c2.y || c1.z !== c2.z, `${JSON.stringify(c1)} → ${JSON.stringify(c2)}`);
  });

  await step("5c. wheel zooms", async () => {
    const c = await center(page.locator("[data-stl]").first());
    await page.mouse.move(c.x, c.y, { steps: 2 });
    const d1 = await dist();
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(400);
    const d2 = await dist();
    t("dolly distance changed", d1 && d2 && Math.abs(d1 - d2) > d1 * 0.02, `${d1?.toFixed(2)} → ${d2?.toFixed(2)}`);
  });

  await step("7. dispose on leave", async () => {
    await leaveTile(page.locator("[data-stl]").first());
    const canvases = await page.locator("[data-stl] canvas").count();
    t("canvas removed after leave", canvases === 0, `${canvases} canvases`);
    const reg = await page.evaluate(() => window.__cvStl.registry.size);
    t("registry cleaned", reg === 0, `${reg} entries`);
  });

  await step("7b. bytes cached across activations", async () => {
    const before = stlReq.length;
    const c = await center(page.locator("[data-stl]").first());
    await page.mouse.move(c.x, c.y, { steps: 3 });
    await page.locator("[data-stl] canvas").first().waitFor({ timeout: 15000 });
    t("re-activation issues no new .stl fetch", stlReq.length === before, `${stlReq.length} total (was ${before})`);
    await leaveTile(page.locator("[data-stl]").first());
    await parkMouse();
  });

  await step("2. scroll stays responsive", async () => {
    let prev = await page.locator(".group").count();
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now();
      await page.mouse.wheel(0, 4500);
      await page.waitForFunction((p) => document.querySelectorAll(".group").length > p, prev, { timeout: 25000 });
      prev = await page.locator(".group").count();
      const dt = Date.now() - t0;
      t(`scroll ${i + 1}: next batch < 3000ms`, dt < 3000, `${prev} tiles, ${dt}ms`);
    }
    await parkMouse();
  });

  await step("6. several arbitrary STL files activate + dispose", async () => {
    // Choose 3 renderable tiles deterministically: read each DOM tile's file
    // title from its Commons link (tile order is the app's batched pageid
    // order, NOT reproducible by sorting), batch-query sizes for those exact
    // titles, and pick the first tiles under the byte cap — a few category
    // files are 40-100MB and intentionally keep their posters (cap behavior).
    const pickable = await page.evaluate(async () => {
      const titles = [...document.querySelectorAll("[data-stl]")]
        .slice(0, 12)
        .map((b) => {
          const a = b.closest(".group")?.querySelector("a.media-link");
          try {
            return a ? decodeURIComponent(a.href.split("/wiki/")[1]) : null;
          } catch {
            return null;
          }
        });
      const resp = await fetch(
        "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*" +
          "&prop=imageinfo&iiprop=size&titles=" +
          encodeURIComponent(titles.filter(Boolean).join("|")),
        { headers: { "Api-User-Agent": "CommonsVibe-STL-spec/1.0 (tests)" } }
      );
      const data = await resp.json();
      const sizeBy = new Map((data.query?.pages || []).map((p) => [p.title, p.imageinfo?.[0]?.size || 0]));
      return titles.map((t) => (t ? (sizeBy.get(t) ?? Infinity) <= 5e6 : false));
    });
    const n = await page.locator("[data-stl]").count();
    const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((i) => i < n && pickable[i]);
    if (indices.length < 2) throw new Error(`only ${indices.length} renderable tiles found`);
    for (const idx of indices.slice(0, 3)) {
      const loc = page.locator("[data-stl]").nth(idx);
      const c = await center(loc);
      await page.mouse.move(c.x, c.y, { steps: 4 });
      try {
        await loc.locator("canvas").waitFor({ timeout: 25000 });
      } catch (e) {
        const diag = await page.evaluate(() => ({
          dbg: (window.__dbg || []).slice(-8),
          reg: window.__cvStl.registry.size,
          canvases: document.querySelectorAll(".stl-canvas").length,
          box0: ((b) => ({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width) }))(document.querySelectorAll("[data-stl]")[0].getBoundingClientRect()),
          scrollY: Math.round(scrollY),
        }));
        t(`tile #${idx} activates 3D`, false, `timeout — diag ${JSON.stringify(diag)}`);
        continue;
      }
      t(`tile #${idx} activates 3D`, true);
      await leaveTile(loc);
      const canv = await page.locator("[data-stl] canvas").count();
      t(`tile #${idx} disposes on leave`, canv === 0, `${canv} canvases`);
    }
  });

  page.off("request", onReq);
  const passed = results.filter((r) => r.startsWith("PASS")).length;
  const summary = `STL spec: ${passed} passed, ${failed} failed\n${results.join("\n")}`;
  console.log(summary);
  if (failed > 0) throw new Error(summary);
  return summary;
}
