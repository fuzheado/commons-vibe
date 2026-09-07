async page => {
  // Showcase tour for the 3D STL viewer — recorded by tests/run.sh via
  // playwright-cli video-start/video-stop with chapter marks. Every scene
  // mirrors a spec assertion; the finished webm is the TDD final artifact.
  const BASE = "http://127.0.0.1:8123";
  const pause = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `tests/artifacts/${name}.png` });
  const center = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await pause(400);
    const b = await loc.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  // Pick renderable tiles (< 5MB) by reading each tile's file title from its
  // Commons link and batch-querying sizes — same technique as the spec.
  const pickTiles = async () => page.evaluate(async () => {
    const titles = [...document.querySelectorAll("[data-stl]")]
      .slice(0, 12)
      .map((b) => {
        const a = b.closest(".group")?.querySelector("a.media-link");
        try { return a ? decodeURIComponent(a.href.split("/wiki/")[1]) : null; } catch { return null; }
      });
    const resp = await fetch(
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*" +
        "&prop=imageinfo&iiprop=size&titles=" + encodeURIComponent(titles.filter(Boolean).join("|")),
      { headers: { "Api-User-Agent": "CommonsVibe-STL-tour/1.0 (tests)" } }
    );
    const data = await resp.json();
    const sizeBy = new Map((data.query?.pages || []).map((p) => [p.title, p.imageinfo?.[0]?.size || 0]));
    return titles.map((t) => (t ? (sizeBy.get(t) ?? Infinity) <= 5e6 : false));
  });

  // ── Scene 1: load the whole category ──
  await page.goto(BASE + "/?sort=alpha&view=det&cat=Category%3ASTL%20files&size=m&_=" + Date.now());
  await page.waitForSelector(".group", { timeout: 60000 });
  await pause(2500);
  await shot("tour-1-category-loaded");

  // ── Scene 2: scroll the wall — posters only, batches are snappy ──
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 3800);
    await pause(900);
  }
  await pause(1200);
  await shot("tour-2-scrolled-wall");

  // ── Scene 3: back to top — lazy posters, nothing fetched yet ──
  await page.mouse.wheel(0, -12000);
  await pause(1500);
  await shot("tour-3-lazy-posters");

  // ── Scene 4: hover activates 3D ──
  const flags = await pickTiles();
  const first = flags.indexOf(true);
  let c = await center(page.locator("[data-stl]").nth(first));
  await page.mouse.move(c.x, c.y, { steps: 6 });
  await page.locator("[data-stl] canvas").nth(first === 0 ? 0 : 0).waitFor({ timeout: 25000 }).catch(() => {});
  await page
    .locator("[data-stl]")
    .nth(first)
    .locator("canvas")
    .waitFor({ timeout: 25000 });
  await pause(1800); // auto-rotate showcase
  await shot("tour-4-hover-3d");

  // ── Scene 5: spin (yaw), pitch, zoom ──
  await page.mouse.down();
  await page.mouse.move(c.x - 160, c.y, { steps: 22 });
  await page.mouse.up();
  await pause(500);
  await page.mouse.move(c.x - 160, c.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(c.x - 160, c.y - 120, { steps: 20 });
  await page.mouse.up();
  await pause(400);
  await page.mouse.wheel(0, -700);
  await pause(800);
  await shot("tour-5a-zoomed");
  await page.mouse.wheel(0, 900);
  await pause(600);
  await page.mouse.move(c.x + 60, c.y, { steps: 2 });
  await page.mouse.down();
  await page.mouse.move(c.x + 220, c.y - 40, { steps: 24 });
  await page.mouse.up();
  await pause(700);
  await shot("tour-5b-orbited");

  // ── Scene 6: leave → poster returns; two more models ──
  await page.mouse.move(c.x, c.y - 350, { steps: 4 });
  await pause(700);
  const more = [flags.indexOf(true, first + 1), flags.indexOf(true, first + 2)].filter((i) => i >= 0);
  for (const idx of more) {
    const loc = page.locator("[data-stl]").nth(idx);
    c = await center(loc);
    await page.mouse.move(c.x, c.y, { steps: 6 });
    await loc.locator("canvas").waitFor({ timeout: 25000 });
    await pause(1200);
    await page.mouse.down();
    await page.mouse.move(c.x + 120, c.y + 60, { steps: 18 });
    await page.mouse.up();
    await pause(600);
    if (idx === more[0]) await shot("tour-6-second-model");
    await page.mouse.move(c.x, c.y - 350, { steps: 4 });
    await pause(500);
  }
  // ── Scene 6b: a big model (40MB+) — progress overlay, then spin ──
  const bigIdx = await page.evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-stl]")];
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i].closest(".group")?.querySelector("a.media-link");
      try { if (a && decodeURIComponent(a.href.split("/wiki/")[1]).includes("A STATUE")) return i; } catch { return -1; }
    }
    return -1;
  });
  if (bigIdx >= 0) {
    const loc = page.locator("[data-stl]").nth(bigIdx);
    c = await center(loc);
    await page.mouse.move(c.x, c.y, { steps: 6 });
    await pause(1200);
    await shot("tour-6b-large-progress");
    await loc.locator("canvas").waitFor({ timeout: 90000 });
    await pause(1500);
    await page.mouse.down();
    await page.mouse.move(c.x + 140, c.y + 40, { steps: 20 });
    await page.mouse.up();
    await pause(800);
    await shot("tour-6c-large-orbited");
    await page.mouse.move(c.x, c.y - 350, { steps: 4 });
    await pause(500);
  }

  await shot("tour-7-done");
  return "tour complete";
}
